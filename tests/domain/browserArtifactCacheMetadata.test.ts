import { expect, test } from 'bun:test';
import { browserArtifactCacheFailureAction } from '../../src/domain/browserArtifactCache.ts';

test('現行schemaで読めないcached metadataはaliasを削除する', () => {
	expect(
		browserArtifactCacheFailureAction(
			'metadata',
			new Error('metadata schema differs'),
		),
	).toBe('remove-alias');
});

test('cached metadata読込の中断はaliasを変更しない', () => {
	expect(
		browserArtifactCacheFailureAction(
			'metadata',
			new DOMException('aborted', 'AbortError'),
		),
	).toBe('abort');
});
