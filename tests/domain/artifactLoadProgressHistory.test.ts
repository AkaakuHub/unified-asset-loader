import { expect, test } from 'bun:test';
import { resolveArtifactLoadSummary } from '../../src/domain/artifactLoadSummary.ts';
import { contentArtifactLoadProgress } from '../../src/domain/contentArtifactLoadProgress.ts';

test('revisiting transfer after validation does not move overall progress backwards', () => {
	const validated = contentArtifactLoadProgress({
		stage: 'validate',
		stageCompleted: true,
	});
	const storing = contentArtifactLoadProgress({
		stage: 'transfer',
		stageCompleted: false,
		totalBytes: 10,
		transferredBytes: 5,
	});
	const summary = resolveArtifactLoadSummary([
		{
			identity: 'texture',
			assetType: 'texture',
			label: 'texture',
			ready: false,
			error: null,
			progress: storing,
			progressHistory: [validated, storing],
		},
	]);
	expect(summary.progressPercent).toBe(75);
	expect(summary.details[0]?.stage).toBe('transfer');
	expect(summary.preparedBytes).toBe(5);
	expect(summary.completed).toBe(false);
});
