import {
	BrowserWorkerFailure,
	observeBrowserWorkerFailure,
	retryBrowserWorkerRead,
} from '../application/scheduling/browserWorkerFailure.ts';
import { WeightedTaskScheduler } from '../application/scheduling/weightedTaskScheduler.ts';
import { browserArtifactFileOperationWeight } from '../domain/browserArtifactFileOperationWeight.ts';
import {
	type BrowserArtifactReference,
	browserArtifactKey,
} from '../domain/browserArtifactReference.ts';
import { browserArtifactRuntimeCapacity } from './browserArtifactRuntimeCapacity.ts';

type Artifact = Readonly<{ artifactKey: string; size: number }>;
type ArtifactChunk = Readonly<{ index: number; bytes: Uint8Array }>;
type Inspection = Readonly<{
	missingIndexes: readonly number[];
	complete: boolean;
}>;
type WorkerResult = Inspection | Readonly<{ binary: ArrayBuffer }> | null;

type Request =
	| Readonly<{ id: number; operation: 'inspect'; artifact: Artifact }>
	| Readonly<{ id: number; operation: 'read'; artifact: Artifact }>
	| Readonly<{
			id: number;
			operation: 'write';
			artifact: Artifact;
			chunks: readonly Readonly<{ index: number; bytes: ArrayBuffer }>[];
	  }>;

type Response =
	| Readonly<{
			id: number;
			ok: true;
			result: WorkerResult;
	  }>
	| Readonly<{ id: number; ok: false; name: string; message: string }>;

type PendingRequest = Readonly<{
	request: Request;
	transfer: readonly Transferable[];
	resolve(value: WorkerResult): void;
	reject(cause: Error): void;
}>;

let scheduler: WeightedTaskScheduler | null = null;
const workers: Worker[] = [];
const idleWorkers: Worker[] = [];
const activeRequests = new Map<Worker, PendingRequest>();
let nextId = 0;

export async function inspectBrowserArtifactFile(
	artifact: BrowserArtifactReference,
): Promise<Inspection> {
	const result = await retryBrowserWorkerRead(
		async () =>
			await request(
				{
					id: nextRequestId(),
					operation: 'inspect',
					artifact: artifactFileIdentity(artifact),
				},
				browserArtifactFileOperationWeight({ kind: 'inspect' }),
				[],
			),
	);
	if (!isInspection(result))
		throw new Error('Browser artifact OPFS inspection response is invalid');
	return result;
}

export async function readBrowserArtifactFile(
	artifact: BrowserArtifactReference,
): Promise<
	| Readonly<{ kind: 'partial'; missingIndexes: readonly number[] }>
	| Readonly<{ kind: 'complete'; binary: Uint8Array }>
> {
	const result = await retryBrowserWorkerRead(
		async () =>
			await request(
				{
					id: nextRequestId(),
					operation: 'read',
					artifact: artifactFileIdentity(artifact),
				},
				browserArtifactFileOperationWeight({ kind: 'read' }),
				[],
			),
	);
	if (isBinary(result))
		return { kind: 'complete', binary: new Uint8Array(result.binary) };
	if (isInspection(result) && !result.complete)
		return { kind: 'partial', missingIndexes: result.missingIndexes };
	throw new Error('Browser artifact OPFS read response is invalid');
}

export async function writeBrowserArtifactFileChunks(
	artifact: BrowserArtifactReference,
	chunks: readonly ArtifactChunk[],
): Promise<void> {
	const transferred = chunks.map(({ index, bytes }) => ({
		index,
		bytes: transferableBuffer(bytes),
	}));
	const buffers = transferred.map(({ bytes }) => bytes);
	const result = await request(
		{
			id: nextRequestId(),
			operation: 'write',
			artifact: artifactFileIdentity(artifact),
			chunks: transferred,
		},
		browserArtifactFileOperationWeight({
			kind: 'write',
			byteLength: chunks.reduce((sum, { bytes }) => sum + bytes.byteLength, 0),
		}),
		buffers,
	);
	if (result !== null)
		throw new Error('Browser artifact OPFS write response is invalid');
}

function request(
	operation: Request,
	weight: number,
	transfer: readonly Transferable[],
): Promise<WorkerResult> {
	return artifactFileScheduler().schedule(
		weight,
		async () =>
			await new Promise<WorkerResult>((resolve, reject) => {
				const pending: PendingRequest = {
					request: operation,
					transfer,
					resolve,
					reject,
				};
				const worker = takeWorker();
				activeRequests.set(worker, pending);
				try {
					worker.postMessage(operation, { transfer: [...transfer] });
				} catch (cause) {
					removeFailedWorker(
						worker,
						new BrowserWorkerFailure(
							'Browser artifact file Worker request failed',
							{ cause },
						),
					);
				}
			}),
	);
}

function takeWorker(): Worker {
	const idle = idleWorkers.pop();
	if (idle !== undefined) return idle;
	if (workers.length >= browserArtifactRuntimeCapacity().fileParallelism)
		throw new Error('Browser artifact OPFS worker scheduler is inconsistent');
	const worker = createWorker();
	workers.push(worker);
	return worker;
}

function artifactFileScheduler(): WeightedTaskScheduler {
	if (scheduler !== null) return scheduler;
	const capacity = browserArtifactRuntimeCapacity();
	scheduler = new WeightedTaskScheduler(
		capacity.fileParallelism,
		capacity.maximumActiveBytes,
	);
	return scheduler;
}

function createWorker(): Worker {
	const worker = new Worker(
		new URL('./browserArtifactFile.worker.ts', import.meta.url),
		{ type: 'module' },
	);
	worker.addEventListener('message', (event: MessageEvent<Response>) => {
		const pending = activeRequests.get(worker);
		if (pending === undefined || pending.request.id !== event.data.id) return;
		activeRequests.delete(worker);
		if (event.data.ok) pending.resolve(event.data.result);
		else
			pending.reject(
				event.data.name === 'Error'
					? new Error(event.data.message)
					: new DOMException(event.data.message, event.data.name),
			);
		idleWorkers.push(worker);
	});
	observeBrowserWorkerFailure(
		worker,
		'Browser artifact file Worker',
		(failure) => removeFailedWorker(worker, failure),
	);
	return worker;
}

function removeFailedWorker(worker: Worker, failure: Error): void {
	const pending = activeRequests.get(worker);
	if (pending !== undefined) {
		activeRequests.delete(worker);
		pending.reject(failure);
	}
	const workerIndex = workers.indexOf(worker);
	if (workerIndex >= 0) workers.splice(workerIndex, 1);
	const idleWorkerIndex = idleWorkers.indexOf(worker);
	if (idleWorkerIndex >= 0) idleWorkers.splice(idleWorkerIndex, 1);
}

function nextRequestId(): number {
	const id = nextId;
	nextId += 1;
	return id;
}

function artifactFileIdentity(reference: BrowserArtifactReference): Artifact {
	return { artifactKey: browserArtifactKey(reference), size: reference.size };
}

function transferableBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength &&
		bytes.buffer instanceof ArrayBuffer
		? bytes.buffer
		: Uint8Array.from(bytes).buffer;
}

function isInspection(value: WorkerResult): value is Inspection {
	return (
		typeof value === 'object' &&
		value !== null &&
		'missingIndexes' in value &&
		Array.isArray(value.missingIndexes) &&
		'complete' in value &&
		typeof value.complete === 'boolean'
	);
}

function isBinary(
	value: WorkerResult,
): value is Readonly<{ binary: ArrayBuffer }> {
	return (
		typeof value === 'object' &&
		value !== null &&
		'binary' in value &&
		value.binary instanceof ArrayBuffer
	);
}
