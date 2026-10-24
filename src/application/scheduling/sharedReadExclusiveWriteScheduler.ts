export class SharedReadExclusiveWriteScheduler {
	readonly #activeReads = new Set<Promise<void>>();
	#writes: Promise<void> = Promise.resolve();

	scheduleRead<Result>(read: () => Promise<Result>): Promise<Result> {
		const result = this.#writes.then(read);
		const completion = result.then(
			() => undefined,
			() => undefined,
		);
		this.#activeReads.add(completion);
		void completion.finally(() => this.#activeReads.delete(completion));
		return result;
	}

	scheduleWrite<Result>(write: () => Promise<Result>): Promise<Result> {
		const precedingWrites = this.#writes;
		const precedingReads = Promise.all([...this.#activeReads]);
		const result = Promise.all([precedingWrites, precedingReads]).then(write);
		this.#writes = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}
