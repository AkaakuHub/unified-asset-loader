import { describe, expect, test } from 'bun:test';
import {
	browserArtifactFileCompletionByteLength,
	createBrowserArtifactFileCompletion,
	markBrowserArtifactFileChunksComplete,
	parseBrowserArtifactFileCompletion,
} from '../../src/domain/browserArtifactFileCompletion.ts';

describe('browser artifact file completion', () => {
	test('chunk完了状態をbit単位で保持する', () => {
		const completion = createBrowserArtifactFileCompletion(10);
		markBrowserArtifactFileChunksComplete(10, completion, [0, 7, 8, 9]);

		expect(browserArtifactFileCompletionByteLength(10)).toBe(2);
		expect(parseBrowserArtifactFileCompletion(10, completion)).toEqual({
			missingIndexes: [1, 2, 3, 4, 5, 6],
			complete: false,
		});
	});

	test('全chunk完了を判定する', () => {
		const completion = createBrowserArtifactFileCompletion(3);
		markBrowserArtifactFileChunksComplete(3, completion, [0, 1, 2]);

		expect(parseBrowserArtifactFileCompletion(3, completion)).toEqual({
			missingIndexes: [],
			complete: true,
		});
	});

	test('重複または範囲外のchunkを拒否する', () => {
		const completion = createBrowserArtifactFileCompletion(2);
		expect(() =>
			markBrowserArtifactFileChunksComplete(2, completion, [0, 0]),
		).toThrow('Artifact completion chunk indexes are invalid');
		expect(() =>
			markBrowserArtifactFileChunksComplete(2, completion, [2]),
		).toThrow('Artifact completion chunk indexes are invalid');
	});
});
