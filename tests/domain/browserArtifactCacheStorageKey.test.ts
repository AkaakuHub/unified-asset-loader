import { expect, test } from 'bun:test';
import { browserArtifactAliasStorageKey } from '../../src/domain/browserArtifactCacheStorageKey.ts';

test('aliasから同じOPFS保存keyを直接決定する', () => {
	const alias = 'quest-live-stage-skill-effect:スペシャル/10314021';
	const key = browserArtifactAliasStorageKey(alias);

	expect(browserArtifactAliasStorageKey(alias)).toBe(key);
	expect(key).not.toContain('/');
	expect(key).toEndWith('.json');
});

test('異なるaliasを同じOPFS保存keyへ変換しない', () => {
	expect(browserArtifactAliasStorageKey('stage:ios')).not.toBe(
		browserArtifactAliasStorageKey('stage/android'),
	);
});

test('空aliasのOPFS保存keyを作らない', () => {
	expect(() => browserArtifactAliasStorageKey('')).toThrow();
});
