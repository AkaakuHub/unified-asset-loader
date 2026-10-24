import { expect, test } from 'bun:test';
import { browserArtifactFileOperationWeight } from '../../src/domain/browserArtifactFileOperationWeight.ts';

test('保存済みbinary読込はartifact容量に関係なく1worker枠を使う', () => {
	expect(browserArtifactFileOperationWeight({ kind: 'inspect' })).toBe(1);
	expect(browserArtifactFileOperationWeight({ kind: 'read' })).toBe(1);
});

test('未保存chunk書込は保持する実byte数をweightにする', () => {
	expect(
		browserArtifactFileOperationWeight({ kind: 'write', byteLength: 0 }),
	).toBe(1);
	expect(
		browserArtifactFileOperationWeight({
			kind: 'write',
			byteLength: 4_194_304,
		}),
	).toBe(4_194_304);
});

test('不正な書込byte数を拒否する', () => {
	expect(() =>
		browserArtifactFileOperationWeight({ kind: 'write', byteLength: -1 }),
	).toThrow();
});
