import { expect, test } from 'bun:test';
import {
	createBrowserArtifactCollectionEntries,
	reduceBrowserArtifactCollection,
} from '../../src/domain/browserArtifactCollectionState.ts';
import { contentArtifactLoadProgress } from '../../src/domain/contentArtifactLoadProgress.ts';

test('artifactごとの最新進捗と段階履歴を共通collectionで保持する', () => {
	const request = contentArtifactLoadProgress({
		stage: 'request',
		stageCompleted: true,
	});
	const firstTransfer = contentArtifactLoadProgress({
		stage: 'transfer',
		stageCompleted: false,
		totalBytes: 10,
		transferredBytes: 4,
	});
	const lastTransfer = contentArtifactLoadProgress({
		stage: 'transfer',
		stageCompleted: true,
		totalBytes: 10,
		transferredBytes: 10,
	});
	let entries = createBrowserArtifactCollectionEntries<Uint8Array>(['scene']);
	for (const progress of [request, firstTransfer, lastTransfer]) {
		entries = reduceBrowserArtifactCollection(entries, {
			type: 'progress',
			identity: 'scene',
			progress,
		});
	}
	expect(entries.get('scene')?.progress).toEqual(lastTransfer);
	expect(entries.get('scene')?.progressHistory).toEqual([
		request,
		lastTransfer,
	]);
});

test('一件の失敗で未完了artifactだけを失敗させる', () => {
	let entries = createBrowserArtifactCollectionEntries<Uint8Array>([
		'scene',
		'font',
		'texture',
	]);
	entries = reduceBrowserArtifactCollection(entries, {
		type: 'completed',
		identity: 'scene',
		value: new Uint8Array([1]),
	});
	entries = reduceBrowserArtifactCollection(entries, {
		type: 'failed',
		identity: 'font',
		message: 'font failed',
	});
	entries = reduceBrowserArtifactCollection(entries, {
		type: 'fail-pending',
		message: 'collection aborted',
	});
	expect(entries.get('scene')?.error).toBeNull();
	expect(entries.get('font')?.error).toBe('font failed');
	expect(entries.get('texture')?.error).toBe('collection aborted');
});
