import { describe, expect, test } from 'bun:test';
import { createBrowserArtifactInspectionCoordinator } from '../../src/domain/browserArtifactInspectionCoordinator.ts';

describe('createBrowserArtifactInspectionCoordinator', () => {
	test('binary materializationはbinary検査を1回だけ行う', async () => {
		const calls: boolean[] = [];
		const coordinator = createBrowserArtifactInspectionCoordinator(
			async (_alias, assembleBinary) => {
				calls.push(assembleBinary);
				return 'complete';
			},
		);

		await coordinator.inspectForMaterialization(
			'artifact',
			'binary',
			new AbortController().signal,
		);

		expect(calls).toEqual([true]);
	});

	test('異なるartifactのbinaryを互いに待たず復元する', async () => {
		const releases = new Map<string, () => void>();
		const started: string[] = [];
		const coordinator = createBrowserArtifactInspectionCoordinator(
			async (alias, assembleBinary) => {
				expect(assembleBinary).toBe(true);
				started.push(alias);
				await new Promise<void>((resolve) => releases.set(alias, resolve));
				return alias;
			},
		);
		const signal = new AbortController().signal;
		const first = coordinator.inspectBinary('first', signal);
		const second = coordinator.inspectBinary('second', signal);
		await Promise.resolve();
		expect(started).toEqual(['first', 'second']);
		releases.get('first')?.();
		releases.get('second')?.();
		expect(await Promise.all([first, second])).toEqual(['first', 'second']);
	});
});
