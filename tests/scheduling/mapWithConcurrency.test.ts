import { expect, test } from 'bun:test';
import { mapWithConcurrency } from '../../src/application/scheduling/mapWithConcurrency.ts';

test('同時実行数を制限し、入力順で結果を返す', async () => {
	let active = 0;
	let maximumActive = 0;
	const results = await mapWithConcurrency(
		[0, 1, 2, 3, 4, 5, 6, 7],
		3,
		async (value) => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await new Promise<void>((resolve) =>
				setTimeout(resolve, 4 - (value % 4)),
			);
			active -= 1;
			return value * 2;
		},
	);

	expect(maximumActive).toBe(3);
	expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
});

test('同時実行数が正の整数ではない場合に拒否する', async () => {
	await expect(mapWithConcurrency([], 0, async () => null)).rejects.toThrow(
		'Task concurrency must be a positive integer',
	);
});

test('失敗後に新しいtaskを始めず、実行中のtaskを待つ', async () => {
	const release = Promise.withResolvers<void>();
	const started: number[] = [];
	let mappingSettled = false;
	const mapping = mapWithConcurrency([0, 1, 2], 2, async (value) => {
		started.push(value);
		if (value === 0) throw new Error('read failed');
		if (value === 1) await release.promise;
		return value;
	});
	const rejectedMapping = mapping.catch((cause: unknown) => {
		mappingSettled = true;
		throw cause;
	});

	await Promise.resolve();
	expect(started).toEqual([0, 1]);
	expect(mappingSettled).toBe(false);
	release.resolve();
	await expect(rejectedMapping).rejects.toThrow('read failed');
	expect(mappingSettled).toBe(true);
	expect(started).toEqual([0, 1]);
});
