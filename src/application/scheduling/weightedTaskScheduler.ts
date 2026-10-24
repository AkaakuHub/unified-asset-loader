type WeightedScheduledTask = Readonly<{
	weight: number;
	run(): void;
}>;

export class WeightedTaskScheduler {
	readonly #queue: WeightedScheduledTask[] = [];
	#active = 0;
	#activeWeight = 0;

	constructor(
		private readonly maximumConcurrent: number | null,
		private readonly maximumActiveWeight: number,
	) {
		if (
			maximumConcurrent !== null &&
			(!Number.isSafeInteger(maximumConcurrent) || maximumConcurrent < 1)
		)
			throw new Error('Task concurrency must be a positive integer');
		if (!Number.isSafeInteger(maximumActiveWeight) || maximumActiveWeight < 1)
			throw new Error('Task active weight must be a positive integer');
	}

	schedule<Result>(
		weight: number,
		task: () => Promise<Result>,
	): Promise<Result> {
		if (!Number.isSafeInteger(weight) || weight < 1)
			return Promise.reject(
				new Error('Task weight must be a positive integer'),
			);
		return new Promise<Result>((resolve, reject) => {
			this.#queue.push({
				weight,
				run: () => {
					this.#active += 1;
					this.#activeWeight += weight;
					void Promise.resolve()
						.then(task)
						.then(resolve, reject)
						.finally(() => {
							this.#active -= 1;
							this.#activeWeight -= weight;
							this.#startQueued();
						});
				},
			});
			this.#startQueued();
		});
	}

	#startQueued(): void {
		while (
			(this.maximumConcurrent === null ||
				this.#active < this.maximumConcurrent) &&
			this.#queue.length > 0
		) {
			const nextIndex =
				this.#active === 0
					? 0
					: this.#queue.findIndex(
							({ weight }) =>
								this.#activeWeight + weight <= this.maximumActiveWeight,
						);
			if (nextIndex < 0) return;
			const [next] = this.#queue.splice(nextIndex, 1);
			if (next === undefined)
				throw new Error('Task scheduler queue is inconsistent');
			next.run();
		}
	}
}
