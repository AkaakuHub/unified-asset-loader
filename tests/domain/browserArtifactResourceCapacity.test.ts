import { describe, expect, test } from 'bun:test';
import {
	browserArtifactParallelism,
	browserArtifactResourceCapacity,
	browserArtifactResponseActiveBytes,
	browserArtifactTransferActiveBytes,
} from '../../src/domain/browserArtifactResourceCapacity.ts';

describe('browser artifact resource capacity', () => {
	test('CPU数とchunk batchの最大保持量から処理容量を決定する', () => {
		expect(browserArtifactParallelism(1)).toBe(1);
		expect(browserArtifactParallelism(4)).toBe(4);
		expect(browserArtifactParallelism(32)).toBe(32);
		expect(
			browserArtifactResourceCapacity({
				hardwareConcurrency: 16,
				deviceMemoryGibibytes: undefined,
				platform: 'MacIntel',
			}),
		).toEqual({
			parallelism: 16,
			fileParallelism: 8,
			scenePreparationParallelism: 8,
			sourcePreparationParallelism: 100,
			rangeParallelism: 4,
			maximumConcurrentTransfers: 100,
			maximumActiveBytes: 16 * 4 * 4 * 1024 * 1024,
		});
	});

	test('deviceMemoryが使える場合だけ低memory端末の同時保持量を抑える', () => {
		expect(
			browserArtifactResourceCapacity({
				hardwareConcurrency: 8,
				deviceMemoryGibibytes: 0.5,
				platform: 'MacIntel',
			}),
		).toEqual({
			parallelism: 8,
			fileParallelism: 4,
			scenePreparationParallelism: 4,
			sourcePreparationParallelism: 100,
			rangeParallelism: 3,
			maximumConcurrentTransfers: 100,
			maximumActiveBytes: 64 * 1024 * 1024,
		});
	});

	test('iPhoneはsceneとsourceを1件ずつ準備する', () => {
		expect(
			browserArtifactResourceCapacity({
				hardwareConcurrency: 8,
				deviceMemoryGibibytes: undefined,
				platform: 'iPhone',
			}),
		).toMatchObject({
			scenePreparationParallelism: 1,
			sourcePreparationParallelism: 1,
		});
	});
});

test('artifact全容量ではなく同時取得するrange batchだけを保持量にする', () => {
	expect(browserArtifactTransferActiveBytes(8_000, 4, 4_000)).toBe(8_000);
	expect(browserArtifactTransferActiveBytes(80_000, 4, 4_000)).toBe(16_000);
});

test('フルレスポンスは実サイズを同時保持量にする', () => {
	expect(browserArtifactResponseActiveBytes(80_000)).toBe(80_000);
});
