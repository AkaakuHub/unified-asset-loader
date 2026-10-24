import { assertBrowserWorkerCrossOriginIsolated } from '../application/scheduling/browserWorkerFailure.ts';
import { mapWithConcurrency } from '../application/scheduling/mapWithConcurrency.ts';
import { SharedReadExclusiveWriteScheduler } from '../application/scheduling/sharedReadExclusiveWriteScheduler.ts';
import {
	type BrowserArtifactCachedAlias,
	type BrowserArtifactCachedArtifact,
	type BrowserArtifactEvictionInventory,
	mergeBrowserArtifactCachedArtifact,
	parseBrowserArtifactCachedAlias,
	parseBrowserArtifactCachedArtifact,
	removeBrowserArtifactFromEvictionInventory,
	selectOldestAvailableBrowserArtifact,
} from '../domain/browserArtifactCacheRecord.ts';
import { browserArtifactAliasStorageKey } from '../domain/browserArtifactCacheStorageKey.ts';
import { unknownErrorMessage } from '../domain/unknownErrorMessage.ts';
import type {
	BrowserArtifactMetadataEntry,
	BrowserArtifactMetadataRequest,
	BrowserArtifactMetadataResponse,
	BrowserArtifactMetadataResult,
} from './browserArtifactMetadataProtocol.ts';
import {
	browserArtifactAliasDirectoryName,
	browserArtifactBinaryFileName,
	browserArtifactCompletionFileName,
	browserArtifactManifestDirectoryName,
	browserArtifactMetadataDirectoryName,
	browserArtifactOpfsDirectoryName,
} from './browserArtifactOpfs.ts';
import { browserArtifactRuntimeCapacity } from './browserArtifactRuntimeCapacity.ts';

assertBrowserWorkerCrossOriginIsolated('Browser artifact metadata Worker');

type BrowserArtifactSyncAccessHandle = Readonly<{
	write(buffer: ArrayBufferView, options?: { at: number }): number;
	truncate(newSize: number): void;
	flush(): void;
	close(): void;
}>;
type SyncAccessFileHandle = FileSystemFileHandle &
	Readonly<{
		createSyncAccessHandle(): Promise<BrowserArtifactSyncAccessHandle>;
	}>;
type CacheDirectories = Readonly<{
	root: FileSystemDirectoryHandle;
	aliases: FileSystemDirectoryHandle;
	artifacts: FileSystemDirectoryHandle;
}>;

let directoriesPromise: Promise<CacheDirectories> | null = null;
let evictionInventory: BrowserArtifactEvictionInventory | null = null;
const requestScheduler = new SharedReadExclusiveWriteScheduler();

self.addEventListener(
	'message',
	(event: MessageEvent<BrowserArtifactMetadataRequest>) => {
		const request = event.data;
		const respondToRequest = () => respond(request);
		if (request.operation === 'read' || request.operation === 'read-prefix')
			void requestScheduler.scheduleRead(respondToRequest);
		else void requestScheduler.scheduleWrite(respondToRequest);
	},
);

async function respond(request: BrowserArtifactMetadataRequest): Promise<void> {
	try {
		const result = await handleRequest(request);
		if (isMetadataMutation(request)) evictionInventory = null;
		const response: BrowserArtifactMetadataResponse = {
			id: request.id,
			ok: true,
			result,
		};
		self.postMessage(response);
	} catch (cause) {
		if (request.operation === 'evict-oldest') evictionInventory = null;
		const response: BrowserArtifactMetadataResponse = {
			id: request.id,
			ok: false,
			name: cause instanceof Error ? cause.name : 'Error',
			message: unknownErrorMessage(cause),
		};
		self.postMessage(response);
	}
}

async function handleRequest(
	request: BrowserArtifactMetadataRequest,
): Promise<BrowserArtifactMetadataResult> {
	const directories = await openDirectories();
	if (request.operation === 'read')
		return await readMetadataEntry(directories, request.alias);
	if (request.operation === 'read-prefix') {
		const aliases = await readAllAliases(directories);
		return await mapWithConcurrency(
			aliases.filter(({ alias }) => alias.startsWith(request.prefix)),
			browserArtifactRuntimeCapacity().fileParallelism,
			(alias) => readMetadataEntryForAlias(directories, alias),
		);
	}
	if (request.operation === 'put-metadata')
		return await putMetadataAlias(directories, request.alias, request.metadata);
	if (request.operation === 'put-artifact')
		return await putArtifactAlias(
			directories,
			request.alias,
			request.metadata,
			request.artifact,
		);
	if (request.operation === 'delete-aliases')
		return await deleteAliases(
			directories,
			request.aliases,
			new Set(request.protectedArtifactKeys),
		);
	if (request.operation === 'delete-prefixes') {
		const aliases = await readAllAliases(directories);
		return await deleteAliases(
			directories,
			aliases
				.filter(({ alias }) =>
					request.prefixes.some((prefix) => alias.startsWith(prefix)),
				)
				.map(({ alias }) => alias),
			new Set(request.protectedArtifactKeys),
			aliases,
		);
	}
	if (request.operation === 'invalidate') {
		await removeArtifact(directories, request.artifactKey);
		return { removedArtifactKeys: [request.artifactKey] };
	}
	if (request.operation === 'finish-eviction') {
		evictionInventory = null;
		return null;
	}
	return await evictOldestArtifact(
		directories,
		new Set(request.unavailableArtifactKeys),
		request.protectedAliases,
	);
}

function isMetadataMutation(request: BrowserArtifactMetadataRequest): boolean {
	return (
		request.operation === 'put-metadata' ||
		request.operation === 'put-artifact' ||
		request.operation === 'delete-aliases' ||
		request.operation === 'delete-prefixes' ||
		request.operation === 'invalidate'
	);
}

async function putMetadataAlias(
	directories: CacheDirectories,
	alias: string,
	metadata: unknown,
): Promise<null> {
	await persistAlias(directories, {
		alias,
		artifactKey: null,
		metadata,
		lastAccessedAt: Date.now(),
	});
	return null;
}

async function putArtifactAlias(
	directories: CacheDirectories,
	alias: string,
	metadata: unknown,
	artifact: BrowserArtifactCachedArtifact,
): Promise<null> {
	const existingArtifact = await readArtifact(
		directories,
		artifact.artifactKey,
	);
	const storedArtifact =
		existingArtifact === null
			? artifact
			: mergeBrowserArtifactCachedArtifact(existingArtifact, artifact);
	if (existingArtifact === null || storedArtifact !== existingArtifact)
		await persistArtifact(directories, storedArtifact);
	await persistAlias(directories, {
		alias,
		artifactKey: artifact.artifactKey,
		metadata,
		lastAccessedAt: artifact.lastAccessedAt,
	});
	return null;
}

async function deleteAliases(
	directories: CacheDirectories,
	deletedAliases: readonly string[],
	protectedArtifactKeys: ReadonlySet<string>,
	loadedAliases?: readonly BrowserArtifactCachedAlias[],
): Promise<Readonly<{ removedArtifactKeys: readonly string[] }>> {
	const aliases =
		loadedAliases ??
		(
			await mapWithConcurrency(
				[...new Set(deletedAliases)],
				browserArtifactRuntimeCapacity().fileParallelism,
				(alias) => readAlias(directories, alias),
			)
		).filter((alias): alias is BrowserArtifactCachedAlias => alias !== null);
	const deletedAliasSet = new Set(deletedAliases);
	const deleted = aliases.filter(({ alias }) => deletedAliasSet.has(alias));
	await Promise.all(
		deleted.map(({ alias }) => removeAlias(directories, alias)),
	);
	const remainingAliases =
		loadedAliases === undefined
			? await readAllAliases(directories)
			: aliases.filter(({ alias }) => !deletedAliasSet.has(alias));
	const candidateArtifactKeys = new Set(
		deleted.flatMap(({ artifactKey }) =>
			artifactKey === null ? [] : [artifactKey],
		),
	);
	const removedArtifactKeys: string[] = [];
	for (const artifactKey of candidateArtifactKeys) {
		if (
			protectedArtifactKeys.has(artifactKey) ||
			artifactReferenceCount(remainingAliases, artifactKey) > 0
		)
			continue;
		await removeArtifact(directories, artifactKey, remainingAliases);
		removedArtifactKeys.push(artifactKey);
	}
	return { removedArtifactKeys };
}

async function evictOldestArtifact(
	directories: CacheDirectories,
	unavailableArtifactKeys: Set<string>,
	protectedAliases: readonly string[],
): Promise<
	Readonly<{ stored: boolean; removedArtifactKeys: readonly string[] }>
> {
	const inventory =
		evictionInventory ?? (await readEvictionInventory(directories));
	evictionInventory = inventory;
	const aliasesByName = new Map(
		inventory.aliases.map((alias) => [alias.alias, alias]),
	);
	for (const protectedAlias of protectedAliases) {
		const artifactKey = aliasesByName.get(protectedAlias)?.artifactKey;
		if (artifactKey !== null && artifactKey !== undefined)
			unavailableArtifactKeys.add(artifactKey);
	}
	const oldest = selectOldestAvailableBrowserArtifact(
		inventory.artifacts,
		unavailableArtifactKeys,
		new Set(),
	);
	if (oldest === null) return { stored: false, removedArtifactKeys: [] };
	await removeArtifact(directories, oldest.artifactKey, inventory.aliases);
	evictionInventory = removeBrowserArtifactFromEvictionInventory(
		inventory,
		oldest.artifactKey,
	);
	return { stored: true, removedArtifactKeys: [oldest.artifactKey] };
}

async function readEvictionInventory(
	directories: CacheDirectories,
): Promise<BrowserArtifactEvictionInventory> {
	const capacity = browserArtifactRuntimeCapacity().fileParallelism;
	let aliases: readonly BrowserArtifactCachedAlias[];
	let artifacts: readonly BrowserArtifactCachedArtifact[];
	if (capacity === 1) {
		aliases = await readAllAliases(directories, 1);
		artifacts = await readAllArtifacts(directories, 1);
	} else {
		[aliases, artifacts] = await Promise.all([
			readAllAliases(directories, Math.ceil(capacity / 2)),
			readAllArtifacts(directories, Math.floor(capacity / 2)),
		]);
	}
	return {
		aliases: aliases.map(({ alias, artifactKey }) => ({ alias, artifactKey })),
		artifacts: artifacts.map(({ artifactKey, lastAccessedAt }) => ({
			artifactKey,
			lastAccessedAt,
		})),
	};
}

async function removeArtifact(
	directories: CacheDirectories,
	artifactKey: string,
	loadedAliases?: readonly Pick<
		BrowserArtifactCachedAlias,
		'alias' | 'artifactKey'
	>[],
): Promise<void> {
	const aliases = loadedAliases ?? (await readAllAliases(directories));
	await Promise.all(
		aliases
			.filter((alias) => alias.artifactKey === artifactKey)
			.map(({ alias }) => removeAlias(directories, alias)),
	);
	await Promise.all([
		removeFile(directories.artifacts, artifactFileName(artifactKey)),
		removeFile(directories.root, browserArtifactBinaryFileName(artifactKey)),
		removeFile(
			directories.root,
			browserArtifactCompletionFileName(artifactKey),
		),
	]);
}

function artifactReferenceCount(
	aliases: readonly BrowserArtifactCachedAlias[],
	artifactKey: string,
	excludedAlias?: string,
): number {
	let count = 0;
	for (const alias of aliases) {
		if (alias.alias !== excludedAlias && alias.artifactKey === artifactKey)
			count += 1;
	}
	return count;
}

async function openDirectories(): Promise<CacheDirectories> {
	if (directoriesPromise !== null) return directoriesPromise;
	directoriesPromise = initializeDirectories();
	return directoriesPromise;
}

async function initializeDirectories(): Promise<CacheDirectories> {
	const storageRoot = await navigator.storage.getDirectory();
	const root = await storageRoot.getDirectoryHandle(
		browserArtifactOpfsDirectoryName,
		{ create: true },
	);
	const metadata = await root.getDirectoryHandle(
		browserArtifactMetadataDirectoryName,
		{ create: true },
	);
	const [aliases, artifacts] = await Promise.all([
		metadata.getDirectoryHandle(browserArtifactAliasDirectoryName, {
			create: true,
		}),
		metadata.getDirectoryHandle(browserArtifactManifestDirectoryName, {
			create: true,
		}),
	]);
	return { root, aliases, artifacts };
}

async function readMetadataEntry(
	directories: CacheDirectories,
	aliasName: string,
): Promise<BrowserArtifactMetadataEntry | null> {
	const alias = await readAlias(directories, aliasName);
	return alias === null
		? null
		: await readMetadataEntryForAlias(directories, alias);
}

async function readMetadataEntryForAlias(
	directories: CacheDirectories,
	alias: BrowserArtifactCachedAlias,
): Promise<BrowserArtifactMetadataEntry> {
	return {
		alias,
		artifact:
			alias.artifactKey === null
				? null
				: await readArtifact(directories, alias.artifactKey),
	};
}

async function readAlias(
	directories: CacheDirectories,
	alias: string,
): Promise<BrowserArtifactCachedAlias | null> {
	const file = await findFile(
		directories.aliases,
		browserArtifactAliasStorageKey(alias),
	);
	if (file === null) return null;
	const parsed = parseBrowserArtifactCachedAlias(
		JSON.parse(await file.getFile().then((value) => value.text())),
	);
	if (parsed === null || parsed.alias !== alias)
		throw new Error('Browser artifact OPFS alias record is invalid');
	return parsed;
}

async function readArtifact(
	directories: CacheDirectories,
	artifactKey: string,
): Promise<BrowserArtifactCachedArtifact | null> {
	const file = await findFile(
		directories.artifacts,
		artifactFileName(artifactKey),
	);
	if (file === null) return null;
	const parsed = parseBrowserArtifactCachedArtifact(
		JSON.parse(await file.getFile().then((value) => value.text())),
	);
	if (parsed === null || parsed.artifactKey !== artifactKey)
		throw new Error('Browser artifact OPFS manifest is invalid');
	return parsed;
}

async function readAllAliases(
	directories: CacheDirectories,
	maximumConcurrent = browserArtifactRuntimeCapacity().fileParallelism,
): Promise<readonly BrowserArtifactCachedAlias[]> {
	return await readDirectoryJsonFiles(
		directories.aliases,
		maximumConcurrent,
		'Browser artifact OPFS alias entry is invalid',
		readAliasFile,
	);
}

async function readAliasFile(
	name: string,
	handle: FileSystemFileHandle,
): Promise<BrowserArtifactCachedAlias> {
	const alias = parseBrowserArtifactCachedAlias(
		JSON.parse(await handle.getFile().then((file) => file.text())),
	);
	if (alias === null || name !== browserArtifactAliasStorageKey(alias.alias))
		throw new Error('Browser artifact OPFS alias record is invalid');
	return alias;
}

async function readAllArtifacts(
	directories: CacheDirectories,
	maximumConcurrent = browserArtifactRuntimeCapacity().fileParallelism,
): Promise<readonly BrowserArtifactCachedArtifact[]> {
	return await readDirectoryJsonFiles(
		directories.artifacts,
		maximumConcurrent,
		'Browser artifact OPFS manifest entry is invalid',
		readArtifactFile,
	);
}

async function readDirectoryJsonFiles<Result>(
	directory: FileSystemDirectoryHandle,
	maximumConcurrent: number,
	invalidEntryMessage: string,
	readFile: (name: string, handle: FileSystemFileHandle) => Promise<Result>,
): Promise<readonly Result[]> {
	const files: Array<readonly [string, FileSystemFileHandle]> = [];
	for await (const [name, handle] of directory.entries()) {
		if (handle.kind !== 'file' || !name.endsWith('.json'))
			throw new Error(invalidEntryMessage);
		files.push([name, handle]);
	}
	return await mapWithConcurrency(files, maximumConcurrent, ([name, handle]) =>
		readFile(name, handle),
	);
}

async function readArtifactFile(
	name: string,
	handle: FileSystemFileHandle,
): Promise<BrowserArtifactCachedArtifact> {
	const artifact = parseBrowserArtifactCachedArtifact(
		JSON.parse(await handle.getFile().then((file) => file.text())),
	);
	if (artifact === null || name !== artifactFileName(artifact.artifactKey))
		throw new Error('Browser artifact OPFS manifest is invalid');
	return artifact;
}

async function persistAlias(
	directories: CacheDirectories,
	alias: BrowserArtifactCachedAlias,
): Promise<void> {
	await writeJson(
		directories.aliases,
		browserArtifactAliasStorageKey(alias.alias),
		alias,
	);
}

async function persistArtifact(
	directories: CacheDirectories,
	artifact: BrowserArtifactCachedArtifact,
): Promise<void> {
	await writeJson(
		directories.artifacts,
		artifactFileName(artifact.artifactKey),
		artifact,
	);
}

async function writeJson(
	directory: FileSystemDirectoryHandle,
	name: string,
	value: unknown,
): Promise<void> {
	const serialized = JSON.stringify(value);
	if (serialized === undefined)
		throw new Error('Browser artifact OPFS metadata is not serializable');
	const bytes = new TextEncoder().encode(serialized);
	const file = await directory.getFileHandle(name, { create: true });
	const access = await createSyncAccessHandle(file);
	try {
		access.truncate(0);
		const written = access.write(bytes);
		if (written !== bytes.byteLength)
			throw new Error('Browser artifact OPFS metadata write was partial');
		access.flush();
	} finally {
		access.close();
	}
}

async function createSyncAccessHandle(
	handle: FileSystemFileHandle,
): Promise<BrowserArtifactSyncAccessHandle> {
	if (!supportsSyncAccess(handle))
		throw new Error('Browser artifact OPFS sync access is unavailable');
	return await handle.createSyncAccessHandle();
}

function supportsSyncAccess(
	handle: FileSystemFileHandle,
): handle is SyncAccessFileHandle {
	return (
		'createSyncAccessHandle' in handle &&
		typeof handle.createSyncAccessHandle === 'function'
	);
}

async function findFile(
	directory: FileSystemDirectoryHandle,
	name: string,
): Promise<FileSystemFileHandle | null> {
	try {
		return await directory.getFileHandle(name);
	} catch (cause) {
		if (cause instanceof DOMException && cause.name === 'NotFoundError')
			return null;
		throw cause;
	}
}

async function removeFile(
	directory: FileSystemDirectoryHandle,
	name: string,
): Promise<void> {
	try {
		await directory.removeEntry(name);
	} catch (cause) {
		if (!(cause instanceof DOMException) || cause.name !== 'NotFoundError')
			throw cause;
	}
}

async function removeAlias(
	directories: CacheDirectories,
	alias: string,
): Promise<void> {
	await removeFile(directories.aliases, browserArtifactAliasStorageKey(alias));
}

function artifactFileName(artifactKey: string): string {
	return `${encodeURIComponent(artifactKey)}.json`;
}
