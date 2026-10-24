import { describe, expect, test } from 'bun:test';
import { WeightedTaskScheduler } from '../../src/application/scheduling/weightedTaskScheduler.ts';

describe('WeightedTaskScheduler', () => {
	test('同時実行数と合計weightの両方を超えない', async () => {
		const scheduler = new WeightedTaskScheduler(3, 10);
		const releases: Array<() => void> = [];
		const started: number[] = [];
		const run = (weight: number) =>
			scheduler.schedule(weight, async () => {
				started.push(weight);
				await new Promise<void>((resolve) => releases.push(resolve));
			});

		const first = run(6);
		const second = run(5);
		const third = run(4);
		await Promise.resolve();
		expect(started).toEqual([6, 4]);
		releases.shift()?.();
		await first;
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(started).toEqual([6, 4, 5]);
		for (const release of releases.splice(0)) release();
		await Promise.all([first, second, third]);
	});

	test('先頭taskがweight待ちでも後続の実行可能taskを止めない', async () => {
		const scheduler = new WeightedTaskScheduler(3, 10);
		const firstRelease = Promise.withResolvers<void>();
		const started: string[] = [];
		const first = scheduler.schedule(8, async () => {
			started.push('first');
			await firstRelease.promise;
		});
		const blocked = scheduler.schedule(4, async () => {
			started.push('blocked');
		});
		const fitting = scheduler.schedule(2, async () => {
			started.push('fitting');
		});

		await Promise.resolve();
		expect(started).toEqual(['first', 'fitting']);
		firstRelease.resolve();
		await Promise.all([first, blocked, fitting]);
		expect(started).toEqual(['first', 'fitting', 'blocked']);
	});

	test('上限より大きな単一taskも単独で実行する', async () => {
		const scheduler = new WeightedTaskScheduler(2, 10);
		await expect(scheduler.schedule(20, async () => 'done')).resolves.toBe(
			'done',
		);
	});

	test('同時実行数を制限しない場合も合計weightだけを超えない', async () => {
		const scheduler = new WeightedTaskScheduler(null, 10);
		const release = Promise.withResolvers<void>();
		const started: number[] = [];
		const run = (weight: number) =>
			scheduler.schedule(weight, async () => {
				started.push(weight);
				await release.promise;
			});

		const first = run(6);
		const second = run(4);
		const blocked = run(1);
		await Promise.resolve();
		expect(started).toEqual([6, 4]);
		release.resolve();
		await Promise.all([first, second, blocked]);
		expect(started).toEqual([6, 4, 1]);
	});
});
