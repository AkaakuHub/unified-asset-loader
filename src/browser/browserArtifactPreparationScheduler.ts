import { WeightedTaskScheduler } from '../application/scheduling/weightedTaskScheduler.ts';
import type { BrowserArtifactResourceCapacity } from '../domain/browserArtifactResourceCapacity.ts';
import { browserArtifactRuntimeCapacity } from './browserArtifactRuntimeCapacity.ts';

export type BrowserArtifactPreparationScheduler = <Result>(
	weight: number,
	prepare: () => Promise<Result>,
) => Promise<Result>;

export function createBrowserArtifactPreparationScheduler(
	capacity: Pick<
		BrowserArtifactResourceCapacity,
		'scenePreparationParallelism' | 'maximumActiveBytes'
	>,
): BrowserArtifactPreparationScheduler {
	const scheduler = new WeightedTaskScheduler(
		capacity.scenePreparationParallelism,
		capacity.maximumActiveBytes,
	);
	return (weight, prepare) => scheduler.schedule(weight, prepare);
}

let runtimeScheduler: BrowserArtifactPreparationScheduler | null = null;

export function scheduleBrowserArtifactPreparation<Result>(
	weight: number,
	prepare: () => Promise<Result>,
): Promise<Result> {
	runtimeScheduler ??= createBrowserArtifactPreparationScheduler(
		browserArtifactRuntimeCapacity(),
	);
	return runtimeScheduler(weight, prepare);
}
