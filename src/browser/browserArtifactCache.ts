import type { BrowserArtifactCacheInspection } from '../application/assetLoaderPorts.ts';
import { createBrowserArtifactAliasInvalidation } from '../domain/browserArtifactAliasInvalidation.ts';
import {
	browserArtifactCacheMaximumBytes,
	browserArtifactChunkLength,
} from '../domain/browserArtifactCache.ts';
import { deleteBrowserAndServerArtifactCache } from '../domain/browserArtifactCacheDeletion.ts';
import type {
	BrowserArtifactCachedAlias,
	BrowserArtifactCachedArtifact,
} from '../domain/browserArtifactCacheRecord.ts';
import {
	type BrowserArtifactReference,
	browserArtifactKey,
	isBrowserArtifactReference,
} from '../domain/browserArtifactReference.ts';
import type { ContentAddressedArtifactReference } from '../domain/contentAddressedArtifact.ts';
import {
	inspectBrowserArtifactFile,
	readBrowserArtifactFile,
	writeBrowserArtifactFileChunks,
} from './browserArtifactFile.ts';
import {
	deleteBrowserArtifactMetadataAliases,
	deleteBrowserArtifactMetadataPrefixes,
	evictOldestBrowserArtifactMetadata,
	finishBrowserArtifactEviction,
	invalidateBrowserArtifactMetadata,
	readBrowserArtifactMetadata,
	readBrowserArtifactMetadataByPrefix,
	writeBrowserArtifactManifest,
	writeBrowserArtifactMetadata,
} from './browserArtifactMetadata.ts';

const protectedAliases = new Set<string>();
const protectedArtifacts = new Map<string, number>();
const aliasInvalidation = createBrowserArtifactAliasInvalidation();
const artifactBinaryReferences = new Map<string, WeakRef<Uint8Array>>();
type ArtifactBinaryRead =
	| Readonly<{ kind: 'partial'; missingIndexes: readonly number[] }>
	| Readonly<{ kind: 'complete'; binary: Uint8Array }>;
const artifactBinaryReads = new Map<string, Promise<ArtifactBinaryRead>>();
let activeArtifactCacheWrites = 0;
let evictionInventoryNeedsReset = false;

export async function inspectBrowserArtifactCache(
	alias: string,
	assembleBinary = true,
): Promise<BrowserArtifactCacheInspection> {
	assertAlias(alias);
	if (aliasInvalidation.isInvalidated(alias)) return { kind: 'miss' };
	protectedAliases.add(alias);
	let artifactKey: string | null = null;
	try {
		const entry = await readBrowserArtifactMetadata(alias);
		if (entry === null) return { kind: 'miss' };
		if (entry.alias.artifactKey === null)
			return { kind: 'metadata', metadata: entry.alias.metadata };
		artifactKey = entry.alias.artifactKey;
		protectArtifact(artifactKey);
		if (entry.artifact === null || entry.artifact.artifactKey !== artifactKey) {
			await invalidateBrowserArtifact(artifactKey);
			return { kind: 'miss' };
		}
		const reference = artifactReference(entry.artifact);
		if (!assembleBinary) {
			const file = await inspectBrowserArtifactFile(reference);
			return file.complete
				? { kind: 'ready', metadata: entry.alias.metadata, reference }
				: {
						kind: 'partial',
						metadata: entry.alias.metadata,
						reference,
						missingIndexes: file.missingIndexes,
					};
		}
		const read = await readSharedArtifactBinary(reference);
		return read.kind === 'partial'
			? {
					kind: 'partial',
					metadata: entry.alias.metadata,
					reference,
					missingIndexes: read.missingIndexes,
				}
			: {
					kind: 'complete',
					metadata: entry.alias.metadata,
					reference,
					binary: read.binary,
				};
	} finally {
		protectedAliases.delete(alias);
		if (artifactKey !== null) unprotectArtifact(artifactKey);
	}
}

export async function initializeBrowserArtifactMetadataCache(
	alias: string,
	metadata: unknown,
): Promise<void> {
	assertAlias(alias);
	await aliasInvalidation.run([alias], async () => {
		if (
			!(await writeWhileEvictingBrowserArtifacts(async () =>
				writeBrowserArtifactMetadata({ alias, metadata }),
			))
		)
			throw new Error('Browser artifact cache capacity is exhausted');
	});
}

export async function initializeBrowserArtifactCache(
	alias: string,
	metadata: unknown,
	reference: BrowserArtifactReference,
): Promise<boolean> {
	assertAlias(alias);
	assertArtifactReference(reference);
	if (reference.size > browserArtifactCacheMaximumBytes) return false;
	const artifactKey = browserArtifactKey(reference);
	protectArtifact(artifactKey);
	try {
		return await writeWhileEvictingBrowserArtifacts(
			async () =>
				await writeBrowserArtifactManifest({
					alias,
					metadata,
					artifact: {
						artifactKey,
						reference,
						storage: 'opfs',
						lastAccessedAt: Date.now(),
					},
				}),
		);
	} finally {
		unprotectArtifact(artifactKey);
	}
}

export async function writeBrowserArtifactChunks(
	reference: BrowserArtifactReference,
	chunks: readonly Readonly<{ index: number; bytes: Uint8Array }>[],
): Promise<void> {
	assertArtifactReference(reference);
	if (
		chunks.some(
			({ index, bytes }) =>
				bytes.byteLength !== browserArtifactChunkLength(reference.size, index),
		)
	)
		throw new Error('Browser artifact chunk length differs');
	const artifactKey = browserArtifactKey(reference);
	protectArtifact(artifactKey);
	try {
		if (
			!(await writeWhileEvictingBrowserArtifacts(async () =>
				writeBrowserArtifactFileChunks(reference, chunks),
			))
		)
			throw new Error('Browser artifact cache quota is exhausted');
	} finally {
		unprotectArtifact(artifactKey);
	}
}

export async function deleteBrowserArtifactAlias(alias: string): Promise<void> {
	await deleteBrowserArtifactAliases([alias]);
}

export async function readBrowserArtifactCachedAliasesByPrefix(
	prefix: string,
): Promise<readonly BrowserArtifactCachedAlias[]> {
	assertAlias(prefix);
	return readBrowserArtifactMetadataByPrefix(prefix);
}

export async function deleteBrowserArtifactAliases(
	aliases: readonly string[],
): Promise<void> {
	for (const alias of aliases) assertAlias(alias);
	if (aliases.length === 0) return;
	await aliasInvalidation.run(aliases, async () => {
		const removedArtifactKeys = await deleteBrowserArtifactMetadataAliases({
			aliases,
			protectedArtifactKeys: [...protectedArtifacts.keys()],
		});
		forgetArtifactBinaries(removedArtifactKeys);
	});
}

export async function deleteBrowserArtifactsByAliasPrefixes(
	prefixes: readonly string[],
): Promise<void> {
	for (const prefix of prefixes) assertAlias(prefix);
	if (prefixes.length === 0)
		throw new Error('Browser artifact cache deletion prefixes are empty');
	const affectedAliases = (
		await Promise.all(prefixes.map(readBrowserArtifactMetadataByPrefix))
	).flatMap((entries) => entries.map(({ alias }) => alias));
	if (affectedAliases.length === 0) return;
	await aliasInvalidation.run(affectedAliases, async () => {
		const removedArtifactKeys = await deleteBrowserArtifactMetadataPrefixes({
			prefixes,
			protectedArtifactKeys: [...protectedArtifacts.keys()],
		});
		forgetArtifactBinaries(removedArtifactKeys);
	});
}

export async function deleteBrowserAndServerArtifactCacheEntry(input: {
	aliases: readonly string[];
	reference: ContentAddressedArtifactReference;
	removeServerEntry: () => Promise<void>;
}): Promise<void> {
	for (const alias of input.aliases) assertAlias(alias);
	assertArtifactReference(input.reference);
	await deleteBrowserAndServerArtifactCache(
		input.aliases,
		aliasInvalidation,
		() => invalidateBrowserArtifact(browserArtifactKey(input.reference)),
		input.removeServerEntry,
	);
}

function readSharedArtifactBinary(
	reference: BrowserArtifactReference,
): Promise<ArtifactBinaryRead> {
	const artifactKey = browserArtifactKey(reference);
	const retained = artifactBinaryReferences.get(artifactKey)?.deref();
	if (retained !== undefined && retained.byteLength === reference.size)
		return Promise.resolve({ kind: 'complete', binary: retained });
	const existing = artifactBinaryReads.get(artifactKey);
	if (existing !== undefined) return existing;
	const reading: Promise<ArtifactBinaryRead> =
		readBrowserArtifactFile(reference);
	artifactBinaryReads.set(artifactKey, reading);
	void reading.then(
		(result) => {
			if (result.kind === 'complete')
				artifactBinaryReferences.set(artifactKey, new WeakRef(result.binary));
			removeArtifactBinaryRead(artifactKey, reading);
		},
		() => removeArtifactBinaryRead(artifactKey, reading),
	);
	return reading;
}

function removeArtifactBinaryRead(
	artifactKey: string,
	reading: Promise<ArtifactBinaryRead>,
): void {
	if (artifactBinaryReads.get(artifactKey) === reading)
		artifactBinaryReads.delete(artifactKey);
}

async function invalidateBrowserArtifact(artifactKey: string): Promise<void> {
	forgetArtifactBinaries(await invalidateBrowserArtifactMetadata(artifactKey));
}

function forgetArtifactBinaries(artifactKeys: readonly string[]): void {
	for (const artifactKey of artifactKeys)
		artifactBinaryReferences.delete(artifactKey);
}

function artifactReference(
	artifact: BrowserArtifactCachedArtifact,
): BrowserArtifactReference {
	return artifact.reference;
}

function assertAlias(alias: string): void {
	if (alias.length === 0) throw new Error('Browser artifact alias is empty');
}

function assertArtifactReference(reference: BrowserArtifactReference): void {
	if (!isBrowserArtifactReference(reference))
		throw new Error('Browser artifact reference is invalid');
}

function protectArtifact(artifactKey: string): void {
	protectedArtifacts.set(
		artifactKey,
		(protectedArtifacts.get(artifactKey) ?? 0) + 1,
	);
}

function unprotectArtifact(artifactKey: string): void {
	const count = protectedArtifacts.get(artifactKey);
	if (count === undefined) throw new Error('Browser artifact is not protected');
	if (count === 1) protectedArtifacts.delete(artifactKey);
	else protectedArtifacts.set(artifactKey, count - 1);
}

function isQuotaExceeded(cause: unknown): boolean {
	return cause instanceof DOMException && cause.name === 'QuotaExceededError';
}

async function writeWhileEvictingBrowserArtifacts(
	write: () => Promise<void>,
): Promise<boolean> {
	activeArtifactCacheWrites += 1;
	try {
		for (;;) {
			try {
				await write();
				return true;
			} catch (cause) {
				if (!isQuotaExceeded(cause)) throw cause;
				const evicted = await evictOldestBrowserArtifactMetadata({
					unavailableArtifactKeys: [...protectedArtifacts.keys()],
					protectedAliases: [...protectedAliases],
				});
				evictionInventoryNeedsReset = true;
				forgetArtifactBinaries(evicted.removedArtifactKeys);
				if (!evicted.stored) return false;
			}
		}
	} finally {
		activeArtifactCacheWrites -= 1;
		if (activeArtifactCacheWrites === 0 && evictionInventoryNeedsReset) {
			evictionInventoryNeedsReset = false;
			await finishBrowserArtifactEviction();
		}
	}
}
