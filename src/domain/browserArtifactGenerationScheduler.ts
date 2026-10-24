export type BrowserArtifactGenerationPriority =
	| 'critical'
	| 'standard'
	| 'background';

type ScheduledBrowserArtifactGeneration = Readonly<{
	priority: BrowserArtifactGenerationPriority;
	signal: AbortSignal;
	start(): void;
	cancel(): void;
}>;

export class BrowserArtifactGenerationScheduler {
	readonly #maximumConcurrent: number;
	readonly #queue: ScheduledBrowserArtifactGeneration[] = [];
	#active = 0;
	#activeBackground = 0;

	constructor(maximumConcurrent: number) {
		if (!Number.isSafeInteger(maximumConcurrent) || maximumConcurrent < 1) {
			throw new Error(
				'Browser artifact generation concurrency must be positive',
			);
		}
		this.#maximumConcurrent = maximumConcurrent;
	}

	schedule<Result>(
		signal: AbortSignal,
		priority: BrowserArtifactGenerationPriority,
		generate: () => Promise<Result>,
	): Promise<Result> {
		if (signal.aborted) return Promise.reject(signal.reason);
		return new Promise<Result>((resolve, reject) => {
			let started = false;
			const abort = () => {
				if (started) return;
				const index = this.#queue.indexOf(scheduled);
				if (index >= 0) this.#queue.splice(index, 1);
				reject(signal.reason);
			};
			const scheduled: ScheduledBrowserArtifactGeneration = {
				priority,
				signal,
				start: () => {
					started = true;
					signal.removeEventListener('abort', abort);
					this.#active += 1;
					if (priority === 'background') this.#activeBackground += 1;
					const generation = signal.aborted
						? Promise.reject<Result>(signal.reason)
						: Promise.resolve().then(generate);
					const abortGeneration = () => reject(signal.reason);
					signal.addEventListener('abort', abortGeneration, { once: true });
					void generation
						.then(
							(value) => {
								signal.removeEventListener('abort', abortGeneration);
								resolve(value);
							},
							(cause) => {
								signal.removeEventListener('abort', abortGeneration);
								reject(cause);
							},
						)
						.finally(() => {
							this.#active -= 1;
							if (priority === 'background') this.#activeBackground -= 1;
							this.#startQueued();
						});
				},
				cancel: abort,
			};
			signal.addEventListener('abort', abort, { once: true });
			this.#queue.push(scheduled);
			this.#startQueued();
		});
	}

	#startQueued(): void {
		while (this.#active < this.#maximumConcurrent && this.#queue.length > 0) {
			const nextIndex = this.#nextIndex();
			if (nextIndex === null) return;
			const [scheduled] = this.#queue.splice(nextIndex, 1);
			if (scheduled === undefined) {
				throw new Error('Browser artifact generation queue is inconsistent');
			}
			if (scheduled.signal.aborted) scheduled.cancel();
			else scheduled.start();
		}
	}

	#nextIndex(): number | null {
		const priorities: readonly BrowserArtifactGenerationPriority[] = [
			'critical',
			'standard',
		];
		for (const priority of priorities) {
			const index = this.#queue.findIndex(
				(scheduled) => scheduled.priority === priority,
			);
			if (index >= 0) return index;
		}
		const maximumBackground = Math.max(1, this.#maximumConcurrent - 1);
		if (this.#activeBackground >= maximumBackground) return null;
		const backgroundIndex = this.#queue.findIndex(
			(scheduled) => scheduled.priority === 'background',
		);
		if (backgroundIndex >= 0) return backgroundIndex;
		throw new Error('Browser artifact generation queue priority is invalid');
	}
}
