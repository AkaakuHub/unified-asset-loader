export class BrowserWorkerFailure extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'BrowserWorkerFailure';
	}
}

export function assertBrowserWorkerCrossOriginIsolated(
	workerName: string,
	isolated: boolean = globalThis.crossOriginIsolated,
): void {
	if (!isolated)
		throw new Error(
			`${workerName} requires a cross-origin isolated context with COOP: same-origin and COEP: require-corp`,
		);
}

type BrowserWorkerErrorEvent = Readonly<{
	error?: unknown;
	message?: unknown;
	filename?: unknown;
	lineno?: unknown;
	colno?: unknown;
}>;

export function browserWorkerFailure(
	workerName: string,
	event: BrowserWorkerErrorEvent,
): BrowserWorkerFailure {
	const cause: unknown = event.error;
	const message = workerErrorMessage(event, cause);
	const location = workerErrorLocation(event);
	return new BrowserWorkerFailure(
		`${workerName} failed: ${message}${location}`,
		cause === undefined ? undefined : { cause },
	);
}

export async function retryBrowserWorkerRead<Result>(
	read: () => Promise<Result>,
): Promise<Result> {
	try {
		return await read();
	} catch (cause) {
		if (!(cause instanceof BrowserWorkerFailure)) throw cause;
		return await read();
	}
}

export function observeBrowserWorkerFailure(
	worker: Worker,
	workerName: string,
	onFailure: (failure: BrowserWorkerFailure) => void,
): void {
	let failed = false;
	const fail = (failure: BrowserWorkerFailure) => {
		if (failed) return;
		failed = true;
		worker.terminate();
		onFailure(failure);
	};
	worker.addEventListener('error', (event: ErrorEvent) => {
		fail(browserWorkerFailure(workerName, event));
	});
	worker.addEventListener('messageerror', () => {
		fail(
			new BrowserWorkerFailure(`${workerName} response could not be decoded`),
		);
	});
}

function workerErrorMessage(
	event: BrowserWorkerErrorEvent,
	cause: unknown,
): string {
	if (cause instanceof Error && cause.message.length > 0) return cause.message;
	if (typeof event.message === 'string' && event.message.length > 0)
		return event.message;
	return 'module execution failed without an error message';
}

function workerErrorLocation(event: BrowserWorkerErrorEvent): string {
	if (typeof event.filename !== 'string' || event.filename.length === 0)
		return '';
	const line =
		typeof event.lineno === 'number' && event.lineno > 0
			? `:${event.lineno}`
			: '';
	const column =
		typeof event.colno === 'number' && event.colno > 0 ? `:${event.colno}` : '';
	return ` (${event.filename}${line}${column})`;
}
