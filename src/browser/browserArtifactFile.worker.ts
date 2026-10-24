import { assertBrowserWorkerCrossOriginIsolated } from '../application/scheduling/browserWorkerFailure.ts';
import {
	browserArtifactChunkCount,
	browserArtifactChunkLength,
} from '../domain/browserArtifactCache.ts';
import {
	createBrowserArtifactFileCompletion,
	markBrowserArtifactFileChunksComplete,
	parseBrowserArtifactFileCompletion,
} from '../domain/browserArtifactFileCompletion.ts';
import { contentAddressedArtifactChunkSize } from '../domain/contentAddressedArtifact.ts';
import { unknownErrorMessage } from '../domain/unknownErrorMessage.ts';
import {
	browserArtifactBinaryFileName,
	browserArtifactCompletionFileName,
	browserArtifactOpfsDirectoryName,
} from './browserArtifactOpfs.ts';

assertBrowserWorkerCrossOriginIsolated('Browser artifact file Worker');

type Artifact = Readonly<{ artifactKey: string; size: number }>;
type ArtifactChunk = Readonly<{ index: number; bytes: ArrayBuffer }>;
type BrowserArtifactSyncAccessHandle = Readonly<{
	getSize(): number;
	read(buffer: ArrayBufferView, options?: { at: number }): number;
	write(buffer: ArrayBufferView, options?: { at: number }): number;
	truncate(newSize: number): void;
	flush(): void;
	close(): void;
}>;
type SyncAccessFileHandle = FileSystemFileHandle &
	Readonly<{
		createSyncAccessHandle(): Promise<BrowserArtifactSyncAccessHandle>;
	}>;

type Request =
	| Readonly<{ id: number; operation: 'inspect'; artifact: Artifact }>
	| Readonly<{ id: number; operation: 'read'; artifact: Artifact }>
	| Readonly<{
			id: number;
			operation: 'write';
			artifact: Artifact;
			chunks: readonly ArtifactChunk[];
	  }>;

type Inspection = Readonly<{
	missingIndexes: readonly number[];
	complete: boolean;
}>;
type WorkerResult = Inspection | Readonly<{ binary: ArrayBuffer }> | null;

type Response =
	| Readonly<{
			id: number;
			ok: true;
			result: WorkerResult;
	  }>
	| Readonly<{ id: number; ok: false; name: string; message: string }>;

let directoryPromise: Promise<FileSystemDirectoryHandle> | null = null;

self.addEventListener('message', (event: MessageEvent<Request>) => {
	void handleRequest(event.data).then(
		(result) => {
			const response: Response = { id: event.data.id, ok: true, result };
			if (result !== null && 'binary' in result) {
				const binary = result.binary;
				self.postMessage(response, { transfer: [binary] });
			} else self.postMessage(response);
		},
		(cause: unknown) => {
			const response: Response = {
				id: event.data.id,
				ok: false,
				name: cause instanceof Error ? cause.name : 'Error',
				message: unknownErrorMessage(cause),
			};
			self.postMessage(response);
		},
	);
});

async function handleRequest(request: Request): Promise<WorkerResult> {
	if (request.operation === 'inspect') return await inspect(request.artifact);
	if (request.operation === 'read') return await read(request.artifact);
	if (request.operation === 'write') {
		await write(request.artifact, request.chunks);
		return null;
	}
	throw new Error('Browser artifact OPFS operation is invalid');
}

async function inspect(artifact: Artifact): Promise<Inspection> {
	return (await inspectFile(artifact)).inspection;
}

async function inspectFile(artifact: Artifact): Promise<
	Readonly<{
		inspection: Inspection;
		binaryHandle: FileSystemFileHandle | null;
	}>
> {
	const chunkCount = browserArtifactChunkCount(artifact.size);
	const directory = await openDirectory();
	const [binaryHandle, completionHandle] = await Promise.all([
		findFile(directory, browserArtifactBinaryFileName(artifact.artifactKey)),
		findFile(
			directory,
			browserArtifactCompletionFileName(artifact.artifactKey),
		),
	]);
	if (binaryHandle === null || completionHandle === null)
		return { inspection: missingAll(chunkCount), binaryHandle: null };
	const [binaryFile, completionFile] = await Promise.all([
		binaryHandle.getFile(),
		completionHandle.getFile(),
	]);
	let completion: ReturnType<typeof parseBrowserArtifactFileCompletion>;
	try {
		completion = parseBrowserArtifactFileCompletion(
			chunkCount,
			new Uint8Array(await completionFile.arrayBuffer()),
		);
	} catch {
		return { inspection: missingAll(chunkCount), binaryHandle: null };
	}
	if (completion.complete && binaryFile.size !== artifact.size)
		return { inspection: missingAll(chunkCount), binaryHandle: null };
	return { inspection: completion, binaryHandle };
}

async function read(artifact: Artifact): Promise<WorkerResult> {
	const inspected = await inspectFile(artifact);
	if (!inspected.inspection.complete) return inspected.inspection;
	if (inspected.binaryHandle === null)
		throw new Error('Browser artifact OPFS complete file is absent');
	const access = await createSyncAccessHandle(inspected.binaryHandle);
	try {
		if (access.getSize() !== artifact.size)
			throw new Error('Browser artifact OPFS file length differs');
		const binary = new ArrayBuffer(artifact.size);
		const readBytes = access.read(new Uint8Array(binary));
		if (readBytes !== artifact.size)
			throw new Error('Browser artifact OPFS file read was partial');
		return { binary };
	} finally {
		access.close();
	}
}

async function write(
	artifact: Artifact,
	chunks: readonly ArtifactChunk[],
): Promise<void> {
	const chunkCount = browserArtifactChunkCount(artifact.size);
	const indexes = chunks.map(({ index }) => index);
	if (new Set(indexes).size !== indexes.length)
		throw new Error('Browser artifact OPFS chunk indexes are duplicated');
	for (const chunk of chunks) {
		if (
			!Number.isSafeInteger(chunk.index) ||
			chunk.index < 0 ||
			chunk.index >= chunkCount ||
			chunk.bytes.byteLength !==
				browserArtifactChunkLength(artifact.size, chunk.index)
		)
			throw new Error('Browser artifact OPFS chunk identity differs');
	}
	const directory = await openDirectory();
	const binaryHandle = await directory.getFileHandle(
		browserArtifactBinaryFileName(artifact.artifactKey),
		{ create: true },
	);
	const completionHandle = await directory.getFileHandle(
		browserArtifactCompletionFileName(artifact.artifactKey),
		{ create: true },
	);
	const binaryAccess = await createSyncAccessHandle(binaryHandle);
	const completionAccess = await createSyncAccessHandle(completionHandle);
	try {
		const completion = createBrowserArtifactFileCompletion(chunkCount);
		if (
			completionAccess.getSize() === completion.byteLength &&
			binaryAccess.getSize() <= artifact.size
		) {
			const readBytes = completionAccess.read(completion);
			if (readBytes !== completion.byteLength)
				throw new Error('Browser artifact OPFS completion read was partial');
		} else {
			binaryAccess.truncate(0);
			completionAccess.truncate(0);
		}
		for (const chunk of chunks) {
			const bytes = new Uint8Array(chunk.bytes);
			const written = binaryAccess.write(bytes, {
				at: chunk.index * contentAddressedArtifactChunkSize,
			});
			if (written !== bytes.byteLength)
				throw new Error('Browser artifact OPFS chunk write was partial');
		}
		markBrowserArtifactFileChunksComplete(chunkCount, completion, indexes);
		if (parseBrowserArtifactFileCompletion(chunkCount, completion).complete)
			binaryAccess.truncate(artifact.size);
		completionAccess.truncate(0);
		const completionWritten = completionAccess.write(completion);
		if (completionWritten !== completion.byteLength)
			throw new Error('Browser artifact OPFS completion write was partial');
		binaryAccess.flush();
		completionAccess.flush();
	} finally {
		binaryAccess.close();
		completionAccess.close();
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

function missingAll(chunkCount: number): Inspection {
	return {
		missingIndexes: Array.from({ length: chunkCount }, (_, index) => index),
		complete: chunkCount === 0,
	};
}

async function openDirectory(): Promise<FileSystemDirectoryHandle> {
	if (directoryPromise !== null) return directoryPromise;
	directoryPromise = navigator.storage.getDirectory().then((root) =>
		root.getDirectoryHandle(browserArtifactOpfsDirectoryName, {
			create: true,
		}),
	);
	return directoryPromise;
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
