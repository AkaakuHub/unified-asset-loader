import {
	BrowserWorkerFailure,
	observeBrowserWorkerFailure,
	retryBrowserWorkerRead,
} from '../application/scheduling/browserWorkerFailure.ts';
import {
	type BrowserArtifactCachedAlias,
	type BrowserArtifactCachedArtifact,
	parseBrowserArtifactCachedAlias,
	parseBrowserArtifactCachedArtifact,
} from '../domain/browserArtifactCacheRecord.ts';
import type {
	BrowserArtifactMetadataRequest,
	BrowserArtifactMetadataResponse,
	BrowserArtifactMetadataResult,
} from './browserArtifactMetadataProtocol.ts';

type PendingRequest = Readonly<{
	resolve(value: BrowserArtifactMetadataResult): void;
	reject(cause: Error): void;
}>;

let worker: Worker | null = null;
let nextId = 0;
const pendingRequests = new Map<number, PendingRequest>();

export async function readBrowserArtifactMetadata(
	alias: string,
): Promise<Readonly<{
	alias: BrowserArtifactCachedAlias;
	artifact: BrowserArtifactCachedArtifact | null;
}> | null> {
	const result = await retryBrowserWorkerRead(
		async () =>
			await request({
				id: nextRequestId(),
				operation: 'read',
				alias,
			}),
	);
	if (result === null) return null;
	return parseMetadataEntry(result);
}

export async function readBrowserArtifactMetadataByPrefix(
	prefix: string,
): Promise<readonly BrowserArtifactCachedAlias[]> {
	const result = await retryBrowserWorkerRead(
		async () =>
			await request({
				id: nextRequestId(),
				operation: 'read-prefix',
				prefix,
			}),
	);
	if (!Array.isArray(result))
		throw new Error('Browser artifact OPFS alias list response is invalid');
	return result.map((value) => parseMetadataEntry(value).alias);
}

export async function writeBrowserArtifactMetadata(input: {
	alias: string;
	metadata: unknown;
}): Promise<void> {
	const result = await request({
		id: nextRequestId(),
		operation: 'put-metadata',
		...input,
	});
	if (result !== null)
		throw new Error('Browser artifact OPFS metadata response is invalid');
}

export async function writeBrowserArtifactManifest(input: {
	alias: string;
	metadata: unknown;
	artifact: BrowserArtifactCachedArtifact;
}): Promise<void> {
	const result = await request({
		id: nextRequestId(),
		operation: 'put-artifact',
		...input,
	});
	if (result !== null)
		throw new Error('Browser artifact OPFS manifest response is invalid');
}

export async function deleteBrowserArtifactMetadataAliases(input: {
	aliases: readonly string[];
	protectedArtifactKeys: readonly string[];
}): Promise<readonly string[]> {
	return removedArtifactKeys(
		await request({
			id: nextRequestId(),
			operation: 'delete-aliases',
			...input,
		}),
	);
}

export async function deleteBrowserArtifactMetadataPrefixes(input: {
	prefixes: readonly string[];
	protectedArtifactKeys: readonly string[];
}): Promise<readonly string[]> {
	return removedArtifactKeys(
		await request({
			id: nextRequestId(),
			operation: 'delete-prefixes',
			...input,
		}),
	);
}

export async function invalidateBrowserArtifactMetadata(
	artifactKey: string,
): Promise<readonly string[]> {
	return removedArtifactKeys(
		await request({
			id: nextRequestId(),
			operation: 'invalidate',
			artifactKey,
		}),
	);
}

export async function evictOldestBrowserArtifactMetadata(input: {
	unavailableArtifactKeys: readonly string[];
	protectedAliases: readonly string[];
}): Promise<
	Readonly<{ stored: boolean; removedArtifactKeys: readonly string[] }>
> {
	return storageResult(
		await request({
			id: nextRequestId(),
			operation: 'evict-oldest',
			...input,
		}),
	);
}

export async function finishBrowserArtifactEviction(): Promise<void> {
	const result = await request({
		id: nextRequestId(),
		operation: 'finish-eviction',
	});
	if (result !== null)
		throw new Error('Browser artifact OPFS eviction completion is invalid');
}

function request(
	message: BrowserArtifactMetadataRequest,
): Promise<BrowserArtifactMetadataResult> {
	return new Promise((resolve, reject) => {
		pendingRequests.set(message.id, { resolve, reject });
		try {
			metadataWorker().postMessage(message);
		} catch (cause) {
			pendingRequests.delete(message.id);
			reject(
				new BrowserWorkerFailure(
					'Browser artifact metadata Worker request failed',
					{ cause },
				),
			);
		}
	});
}

function metadataWorker(): Worker {
	if (worker !== null) return worker;
	const createdWorker = new Worker(
		new URL('./browserArtifactMetadata.worker.ts', import.meta.url),
		{ type: 'module' },
	);
	worker = createdWorker;
	createdWorker.addEventListener(
		'message',
		(event: MessageEvent<BrowserArtifactMetadataResponse>) => {
			const pending = pendingRequests.get(event.data.id);
			if (pending === undefined) return;
			pendingRequests.delete(event.data.id);
			if (event.data.ok) pending.resolve(event.data.result);
			else
				pending.reject(
					event.data.name === 'Error'
						? new Error(event.data.message)
						: new DOMException(event.data.message, event.data.name),
				);
		},
	);
	observeBrowserWorkerFailure(
		createdWorker,
		'Browser artifact metadata Worker',
		(failure) => {
			for (const pending of pendingRequests.values()) pending.reject(failure);
			pendingRequests.clear();
			if (worker === createdWorker) worker = null;
		},
	);
	return createdWorker;
}

function removedArtifactKeys(
	result: BrowserArtifactMetadataResult,
): readonly string[] {
	if (!isRemovalResult(result))
		throw new Error('Browser artifact OPFS removal response is invalid');
	return parseArtifactKeyList(result.removedArtifactKeys);
}

function storageResult(
	result: BrowserArtifactMetadataResult,
): Readonly<{ stored: boolean; removedArtifactKeys: readonly string[] }> {
	if (!isStorageResult(result))
		throw new Error('Browser artifact OPFS storage response is invalid');
	return {
		stored: result.stored,
		removedArtifactKeys: parseArtifactKeyList(result.removedArtifactKeys),
	};
}

function isRemovalResult(
	value: unknown,
): value is Readonly<{ removedArtifactKeys: readonly unknown[] }> {
	return (
		isRecord(value) &&
		'removedArtifactKeys' in value &&
		Array.isArray(value.removedArtifactKeys)
	);
}

function isStorageResult(value: unknown): value is Readonly<{
	stored: boolean;
	removedArtifactKeys: readonly unknown[];
}> {
	return (
		isRemovalResult(value) &&
		'stored' in value &&
		typeof value.stored === 'boolean'
	);
}

function parseMetadataEntry(value: unknown): Readonly<{
	alias: BrowserArtifactCachedAlias;
	artifact: BrowserArtifactCachedArtifact | null;
}> {
	if (!isRecord(value) || !('alias' in value) || !('artifact' in value))
		throw new Error('Browser artifact OPFS alias response is invalid');
	const alias = parseBrowserArtifactCachedAlias(value.alias);
	const artifact =
		value.artifact === null
			? null
			: parseBrowserArtifactCachedArtifact(value.artifact);
	if (alias === null || (value.artifact !== null && artifact === null))
		throw new Error('Browser artifact OPFS cache entry is invalid');
	return { alias, artifact };
}

function parseArtifactKeyList(values: readonly unknown[]): readonly string[] {
	if (!values.every((value): value is string => typeof value === 'string'))
		throw new Error('Browser artifact OPFS key list is invalid');
	return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function nextRequestId(): number {
	const id = nextId;
	nextId += 1;
	return id;
}
