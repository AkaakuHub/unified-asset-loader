import { describe, expect, test } from 'bun:test';
import { runArtifactLoadStep } from 'unified-asset-loader/application/artifactLoadWorkflow';
import type { ArtifactLoadEntryEvent } from 'unified-asset-loader/domain/artifactLoadEntryState';
import { reduceArtifactLoadEntryEvent } from 'unified-asset-loader/domain/artifactLoadEntryState';
import { contentArtifactLoadProgress } from 'unified-asset-loader/domain/contentArtifactLoadProgress';

const descriptor = {
	identity: 'stage-skill-effect:effect-1',
	assetType: 'Particle effect',
	label: 'effect-1',
} as const;

describe('Artifact読込進捗', () => {
	test('artifactごとの進捗と構築段階を独立して保持する', () => {
		const sourceProgress = contentArtifactLoadProgress({
			stage: 'transfer',
			stageCompleted: true,
			transferredBytes: 10,
			totalBytes: 10,
		});
		const buildProgress = contentArtifactLoadProgress({
			stage: 'scene-build',
			stageCompleted: false,
			transferredBytes: 10,
			totalBytes: 10,
		});
		let loads = reduceArtifactLoadEntryEvent(new Map(), {
			type: 'started',
			...descriptor,
		});
		loads = reduceArtifactLoadEntryEvent(loads, {
			type: 'progress',
			...descriptor,
			progress: sourceProgress,
		});
		loads = reduceArtifactLoadEntryEvent(loads, {
			type: 'progress',
			...descriptor,
			progress: buildProgress,
		});
		loads = reduceArtifactLoadEntryEvent(loads, {
			type: 'completed',
			...descriptor,
		});

		expect(loads.get(descriptor.identity)).toEqual({
			...descriptor,
			progress: buildProgress,
			progressHistory: [sourceProgress, buildProgress],
			ready: true,
			error: null,
		});
	});

	test('別artifactの同時進捗で既存artifactを上書きしない', () => {
		const first = reduceArtifactLoadEntryEvent(new Map(), {
			type: 'started',
			...descriptor,
		});
		const second = reduceArtifactLoadEntryEvent(first, {
			type: 'started',
			identity: 'content-assets-search:image_sticker:20',
			assetType: 'Scene asset',
			label: 'image_sticker',
		});

		expect([...second.keys()]).toEqual([
			'stage-skill-effect:effect-1',
			'content-assets-search:image_sticker:20',
		]);
	});

	test('共通workflowが開始・実進捗・完了を同じentryへ通知する', async () => {
		const events: ArtifactLoadEntryEvent[] = [];
		const progress = contentArtifactLoadProgress({
			stage: 'metadata',
			stageCompleted: true,
		});
		const value = await runArtifactLoadStep(
			descriptor,
			(event) => events.push(event),
			async (reportProgress) => {
				reportProgress(progress);
				return 'loaded';
			},
		);

		expect(value).toBe('loaded');
		expect(events).toEqual([
			{ type: 'started', ...descriptor },
			{ type: 'progress', ...descriptor, progress },
			{ type: 'completed', ...descriptor },
		]);
	});
});
