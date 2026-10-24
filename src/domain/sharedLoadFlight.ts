export type SharedLoadFlight<Progress, Result> = Readonly<{
	completion: Promise<Result>;
	readonly aborted: boolean;
	subscribe(
		signal: AbortSignal,
		reportProgress: (progress: Progress) => void,
	): Promise<Result>;
}>;

export function createSharedLoadFlight<Progress, Result>(
	start: (
		signal: AbortSignal,
		reportProgress: (progress: Progress) => void,
	) => Promise<Result>,
): SharedLoadFlight<Progress, Result> {
	const abortController = new AbortController();
	const subscribers = new Map<symbol, (progress: Progress) => void>();
	let latestProgress: Readonly<{ value: Progress }> | null = null;
	let settled = false;
	const completion = start(abortController.signal, (progress) => {
		latestProgress = { value: progress };
		for (const subscriber of subscribers.values()) subscriber(progress);
	}).finally(() => {
		settled = true;
	});
	return {
		completion,
		get aborted() {
			return abortController.signal.aborted;
		},
		async subscribe(signal, reportProgress) {
			const subscriber = Symbol();
			subscribers.set(subscriber, reportProgress);
			if (latestProgress !== null) reportProgress(latestProgress.value);
			try {
				return await promiseWithAbortSignal(completion, signal);
			} finally {
				subscribers.delete(subscriber);
				if (subscribers.size === 0 && !settled) abortController.abort();
			}
		},
	};
}

export function getOrCreateSharedLoadFlight<Progress, Result>(
	existing: SharedLoadFlight<Progress, Result> | undefined,
	create: () => SharedLoadFlight<Progress, Result>,
): SharedLoadFlight<Progress, Result> {
	return existing === undefined || existing.aborted ? create() : existing;
}

function promiseWithAbortSignal<Result>(
	promise: Promise<Result>,
	signal: AbortSignal,
): Promise<Result> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((resolvePromise, rejectPromise) => {
		const abort = (): void => rejectPromise(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		void promise
			.then(resolvePromise, rejectPromise)
			.finally(() => signal.removeEventListener('abort', abort));
	});
}
