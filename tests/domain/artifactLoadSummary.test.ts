import { expect, test } from 'bun:test';
import { resolveArtifactLoadSummary } from 'unified-asset-loader/domain/artifactLoadSummary';
import { contentArtifactLoadProgress } from 'unified-asset-loader/domain/contentArtifactLoadProgress';

test('artifactの準備状態をstage投影なしで集計する', () => {
	const summary = resolveArtifactLoadSummary([
		entry('ready', true, null),
		entry('loading', false, null),
		entry('failed', false, 'decode failed'),
	]);

	expect(summary).toEqual({
		ready: 1,
		succeeded: 1,
		failed: 1,
		processing: 1,
		total: 3,
		completed: false,
		networkReceivedBytes: 0,
		preparedBytes: 0,
		totalBytes: 0,
		completedArtifacts: 0,
		totalArtifacts: 0,
		progressPercent: 33,
		details: [
			{
				identity: 'ready',
				assetType: '3D model',
				label: 'ready',
				status: 'complete',
				stage: 'complete',
				networkReceivedBytes: 0,
				transferredBytes: 0,
				totalBytes: 0,
				progressPercent: 100,
				completedArtifacts: 0,
				totalArtifacts: 0,
				activeArtifactLabel: null,
				error: null,
				phases: [],
			},
			{
				identity: 'loading',
				assetType: '3D model',
				label: 'loading',
				status: 'waiting',
				stage: 'waiting',
				networkReceivedBytes: 0,
				transferredBytes: 0,
				totalBytes: 0,
				progressPercent: 0,
				completedArtifacts: 0,
				totalArtifacts: 0,
				activeArtifactLabel: null,
				error: null,
				phases: [],
			},
			{
				identity: 'failed',
				assetType: '3D model',
				label: 'failed',
				status: 'failed',
				stage: 'prepare',
				networkReceivedBytes: 0,
				transferredBytes: 0,
				totalBytes: 0,
				progressPercent: 0,
				completedArtifacts: 0,
				totalArtifacts: 0,
				activeArtifactLabel: null,
				error: 'decode failed',
				phases: [],
			},
		],
		failures: [
			{
				identity: 'failed',
				assetType: '3D model',
				label: 'failed',
				stage: 'prepare',
				reason: 'decode failed',
			},
		],
	});
});

test('全artifactがreadyの場合だけ完了する', () => {
	const summary = resolveArtifactLoadSummary([
		entry('body', true, null),
		entry('face', true, null),
	]);

	expect(summary.completed).toBe(true);
	expect(summary.processing).toBe(0);
	expect(summary.failed).toBe(0);
});

test('共通loaderが通知した実工程と転送量を詳細へ保持する', () => {
	const progress = contentArtifactLoadProgress({
		stage: 'transfer',
		stageCompleted: false,
		transferredBytes: 1_048_576,
		totalBytes: 4_194_304,
		completedArtifacts: 1,
		totalArtifacts: 3,
		activeArtifactLabel: 'texture',
	});
	const summary = resolveArtifactLoadSummary([
		{ ...entry('body', false, null), progress },
	]);

	expect(summary.details).toEqual([
		{
			identity: 'body',
			assetType: '3D model',
			label: 'body',
			status: 'processing',
			stage: 'transfer',
			networkReceivedBytes: 0,
			transferredBytes: 1_048_576,
			totalBytes: 4_194_304,
			progressPercent: 53,
			completedArtifacts: 1,
			totalArtifacts: 3,
			activeArtifactLabel: 'texture',
			error: null,
			phases: [],
		},
	]);
});

test('同じidentityに異なる表示情報を割り当てない', () => {
	expect(() =>
		resolveArtifactLoadSummary([
			entry('body', false, null),
			{ ...entry('body', false, null), label: 'face' },
		]),
	).toThrow('Artifact load entry identity is ambiguous');
});

test('asset runtimeの実際に通知された各工程を独立したphaseにする', () => {
	const sourceProgress = sourceProgressSample();
	const sceneProgress = sceneProgressSample();
	const summary = resolveArtifactLoadSummary([
		{
			identity: 'scene:example',
			assetType: '3D model',
			label: 'example-scene',
			progress: sceneProgress,
			progressHistory: [sourceProgress, sceneProgress],
			ready: false,
			error: null,
		},
	]);
	expect(summary.details[0]?.phases).toEqual([
		{
			label: 'decode',
			status: 'complete',
			stage: 'complete',
			networkReceivedBytes: 0,
			transferredBytes: 59_244_544,
			totalBytes: 59_244_544,
			completedArtifacts: 272,
			totalArtifacts: 272,
			error: null,
		},
		{
			label: 'scene-build',
			status: 'processing',
			stage: 'processing',
			networkReceivedBytes: 0,
			transferredBytes: 59_244_544,
			totalBytes: 59_244_544,
			completedArtifacts: 272,
			totalArtifacts: 272,
			error: null,
		},
	]);
});

test('後続工程の0で実際の通信量を消さず全体進捗へ反映する', () => {
	const transfer = contentArtifactLoadProgress({
		stage: 'transfer',
		stageCompleted: false,
		networkReceivedBytes: 4,
		totalBytes: 10,
	});
	const validate = contentArtifactLoadProgress({
		stage: 'validate',
		stageCompleted: false,
	});
	const summary = resolveArtifactLoadSummary([
		{
			...entry('source', false, null),
			progress: validate,
			progressHistory: [transfer, validate],
		},
	]);

	expect(summary.networkReceivedBytes).toBe(4);
	expect(summary.totalBytes).toBe(10);
	expect(summary.progressPercent).toBe(62);
	expect(summary.details[0]?.networkReceivedBytes).toBe(4);
	expect(summary.details[0]?.progressPercent).toBe(62);
});

test('全byteを受信済みでも後続工程が残る場合は100%にしない', () => {
	const progress = contentArtifactLoadProgress({
		stage: 'metadata',
		stageCompleted: true,
		networkReceivedBytes: 10,
		totalBytes: 10,
	});
	const summary = resolveArtifactLoadSummary([
		{ ...entry('source', false, null), progress },
	]);

	expect(summary.networkReceivedBytes).toBe(10);
	expect(summary.totalBytes).toBe(10);
	expect(summary.progressPercent).toBe(50);
	expect(summary.details[0]?.progressPercent).toBe(50);
});

test('共通loaderの8工程を圧縮せず通知順で保持する', () => {
	const stages = [
		'cache-check',
		'queue',
		'request',
		'metadata',
		'transfer',
		'validate',
		'decode',
		'scene-build',
	] as const;
	const summary = resolveArtifactLoadSummary([
		{
			...entry('stage', false, null),
			progress: contentArtifactLoadProgress({
				stage: 'scene-build',
				stageCompleted: false,
			}),
			progressHistory: stages.map((stage, index) =>
				contentArtifactLoadProgress({
					stage,
					stageCompleted: index < stages.length - 1,
				}),
			),
		},
	]);

	expect(
		summary.details[0]?.phases.map(({ label, status }) => ({ label, status })),
	).toEqual([
		{ label: 'cache-check', status: 'complete' },
		{ label: 'queue', status: 'complete' },
		{ label: 'request', status: 'complete' },
		{ label: 'metadata', status: 'complete' },
		{ label: 'transfer', status: 'complete' },
		{ label: 'validate', status: 'complete' },
		{ label: 'decode', status: 'complete' },
		{ label: 'scene-build', status: 'processing' },
	]);
});

test('失敗を最後に通知された工程へだけ割り当てる', () => {
	const sourceProgress = sourceProgressSample();
	const sceneProgress = sceneProgressSample();
	const summary = resolveArtifactLoadSummary([
		{
			identity: 'scene:example',
			assetType: '3D model',
			label: 'example-scene',
			progress: sceneProgress,
			progressHistory: [sourceProgress, sceneProgress],
			ready: false,
			error: 'Unsupported preview Material shader',
		},
	]);
	expect(
		summary.details[0]?.phases.map(({ status, error }) => ({ status, error })),
	).toEqual([
		{ status: 'complete', error: null },
		{ status: 'failed', error: 'Unsupported preview Material shader' },
	]);
});

function sourceProgressSample() {
	return contentArtifactLoadProgress({
		stage: 'decode',
		stageCompleted: true,
		completedArtifacts: 272,
		totalArtifacts: 272,
		transferredBytes: 59_244_544,
		totalBytes: 59_244_544,
	});
}

function sceneProgressSample() {
	return contentArtifactLoadProgress({
		stage: 'scene-build',
		stageCompleted: false,
		completedArtifacts: 272,
		totalArtifacts: 272,
		transferredBytes: 59_244_544,
		totalBytes: 59_244_544,
	});
}

function entry(identity: string, ready: boolean, error: string | null) {
	return {
		identity,
		assetType: '3D model',
		label: identity,
		progress: null,
		ready,
		error,
	};
}
