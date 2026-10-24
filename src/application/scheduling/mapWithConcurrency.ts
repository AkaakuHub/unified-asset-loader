export async function mapWithConcurrency<Item, Result>(
	items: readonly Item[],
	maximumConcurrent: number,
	operation: (item: Item) => Promise<Result>,
): Promise<readonly Result[]> {
	if (!Number.isSafeInteger(maximumConcurrent) || maximumConcurrent < 1)
		throw new Error('Task concurrency must be a positive integer');
	const results: Result[] = [];
	const iterator = items.entries();
	let stopped = false;
	let failure: unknown;
	let hasFailure = false;
	const worker = async (): Promise<void> => {
		while (!stopped) {
			const next = iterator.next();
			if (next.done) return;
			const [index, item] = next.value;
			try {
				results[index] = await operation(item);
			} catch (cause) {
				if (!hasFailure) {
					failure = cause;
					hasFailure = true;
				}
				stopped = true;
				throw cause;
			}
		}
	};
	await Promise.allSettled(
		Array.from({ length: Math.min(maximumConcurrent, items.length) }, () =>
			worker(),
		),
	);
	if (hasFailure) throw failure;
	return results;
}
