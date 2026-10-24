import { expect, test } from 'bun:test';
import {
	mergeBrowserArtifactCachedArtifact,
	parseBrowserArtifactCachedAlias,
	parseBrowserArtifactCachedArtifact,
	removeBrowserArtifactFromEvictionInventory,
} from '../../src/domain/browserArtifactCacheRecord.ts';
import { browserArtifactKey } from '../../src/domain/browserArtifactReference.ts';

test('binaryを持たないalias recordを受理する', () => {
	const record = {
		alias: 'quest-live-stage-composition:103103',
		artifactKey: null,
		metadata: { musicId: 103103 },
		lastAccessedAt: 1,
	};
	expect(parseBrowserArtifactCachedAlias(record)).toEqual(record);
});

test('content-addressed参照を共通cache manifestとして復元する', () => {
	const sha256 = '1'.repeat(64);
	const reference = {
		sha256,
		size: 1,
		url: `/assets/${sha256}`,
	} as const;
	const manifest = {
		artifactKey: browserArtifactKey(reference),
		reference,
		storage: 'opfs',
		lastAccessedAt: 1,
	} as const;
	expect(parseBrowserArtifactCachedArtifact(manifest)).toEqual(manifest);
});

test('source catalog identityを本文hashなしでcache manifestとして復元する', () => {
	const reference = {
		assetPath: 'ios/ab/abcdefghijklmnopqrstuvwxyz',
		checksum: '14722267798951802867',
		size: 19162,
		url: null,
	} as const;
	const manifest = {
		artifactKey: browserArtifactKey(reference),
		reference,
		storage: 'opfs',
		lastAccessedAt: 2,
	} as const;
	expect(parseBrowserArtifactCachedArtifact(manifest)).toEqual(manifest);
	expect(
		parseBrowserArtifactCachedArtifact({
			...manifest,
			artifactKey: 'catalog:different',
		}),
	).toBeNull();
});

test('同じ参照のmanifestだけを統合する', () => {
	const sha256 = '2'.repeat(64);
	const reference = {
		sha256,
		size: 6548,
		url: `/assets/${sha256}`,
	} as const;
	const existing = {
		artifactKey: browserArtifactKey(reference),
		reference,
		storage: 'opfs',
		lastAccessedAt: 1,
	} as const;
	expect(
		mergeBrowserArtifactCachedArtifact(existing, {
			...existing,
			lastAccessedAt: 2,
		}),
	).toBe(existing);
});

test('退避済みartifactのaliasとmanifestを在庫から除く', () => {
	const inventory = {
		aliases: [
			{ alias: 'archive:a', artifactKey: 'catalog:a' },
			{ alias: 'archive:b', artifactKey: 'catalog:b' },
			{ alias: 'metadata', artifactKey: null },
		],
		artifacts: [
			{ artifactKey: 'catalog:a', lastAccessedAt: 1 },
			{ artifactKey: 'catalog:b', lastAccessedAt: 2 },
		],
	} as const;

	expect(
		removeBrowserArtifactFromEvictionInventory(inventory, 'catalog:a'),
	).toEqual({
		aliases: [
			{ alias: 'archive:b', artifactKey: 'catalog:b' },
			{ alias: 'metadata', artifactKey: null },
		],
		artifacts: [{ artifactKey: 'catalog:b', lastAccessedAt: 2 }],
	});
});
