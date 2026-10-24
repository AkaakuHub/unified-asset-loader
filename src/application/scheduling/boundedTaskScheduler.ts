type ScheduledTask = Readonly<{
	run(): void;
}>;

export class BoundedTaskScheduler {
	readonly #maximumConcurrent: number;
	readonly #queue: ScheduledTask[] = [];
	#active = 0;

	constructor(maximumConcurrent: number) {
		if (!Number.isSafeInteger(maximumConcurrent) || maximumConcurrent < 1) {
			throw new Error('Task concurrency must be a positive integer');
		}
		this.#maximumConcurrent = maximumConcurrent;
	}

	schedule<Result>(task: () => Promise<Result>): Promise<Result> {
		return new Promise<Result>((resolve, reject) => {
			this.#queue.push({
				run: () => {
					this.#active += 1;
					void Promise.resolve()
						.then(task)
						.then(resolve, reject)
						.finally(() => {
							this.#active -= 1;
							this.#startQueued();
						});
				},
			});
			this.#startQueued();
		});
	}

	#startQueued(): void {
		while (this.#active < this.#maximumConcurrent && this.#queue.length > 0) {
			const next = this.#queue.shift();
			if (next === undefined) {
				throw new Error('Task scheduler queue is inconsistent');
			}
			next.run();
		}
	}
}
