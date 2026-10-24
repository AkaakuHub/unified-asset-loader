export const contentArtifactLoadStages = [
	'cache-check',
	'queue',
	'request',
	'metadata',
	'transfer',
	'validate',
	'decode',
	'scene-build',
] as const;

export type ContentArtifactLoadProgress = Readonly<{
	stage: (typeof contentArtifactLoadStages)[number];
	stageCompleted: boolean;
	current: number;
	total: number;
	networkReceivedBytes: number;
	transferredBytes: number;
	totalBytes: number;
	completedArtifacts: number;
	totalArtifacts: number;
	activeArtifactLabel: string | null;
}>;

export function contentArtifactLoadProgress(input: {
	stage: ContentArtifactLoadProgress['stage'];
	stageCompleted: boolean;
	networkReceivedBytes?: number;
	transferredBytes?: number;
	totalBytes?: number;
	completedArtifacts?: number;
	totalArtifacts?: number;
	activeArtifactLabel?: string | null;
}): ContentArtifactLoadProgress {
	const stageIndex = contentArtifactLoadStages.indexOf(input.stage);
	const totalBytes = input.totalBytes ?? 0;
	const networkReceivedBytes = input.networkReceivedBytes ?? 0;
	const transferredBytes = input.transferredBytes ?? 0;
	const totalArtifacts = input.totalArtifacts ?? 1;
	const completedArtifacts = input.completedArtifacts ?? 0;
	if (
		networkReceivedBytes < 0 ||
		networkReceivedBytes > totalBytes ||
		transferredBytes < 0 ||
		transferredBytes > totalBytes ||
		completedArtifacts < 0 ||
		completedArtifacts > totalArtifacts
	)
		throw new Error('Content artifact load progress is invalid');
	return {
		stage: input.stage,
		stageCompleted: input.stageCompleted,
		current: stageIndex + 1,
		total: contentArtifactLoadStages.length,
		networkReceivedBytes,
		transferredBytes,
		totalBytes,
		completedArtifacts,
		totalArtifacts,
		activeArtifactLabel: input.activeArtifactLabel ?? null,
	};
}

export function contentArtifactLoadFraction(
	progress: ContentArtifactLoadProgress,
): number {
	const stageFraction =
		progress.stage === 'transfer'
			? progress.totalBytes === 0
				? 0
				: Math.max(progress.networkReceivedBytes, progress.transferredBytes) /
					progress.totalBytes
			: progress.stageCompleted
				? 1
				: 0;
	return (progress.current - 1 + stageFraction) / progress.total;
}

export function contentArtifactLoadPercent(
	progress: ContentArtifactLoadProgress,
): number {
	return Math.min(100, Math.floor(contentArtifactLoadFraction(progress) * 100));
}

export function updateContentArtifactLoadProgressHistory(
	history: readonly ContentArtifactLoadProgress[],
	progress: ContentArtifactLoadProgress,
): readonly ContentArtifactLoadProgress[] {
	const byStage = new Map(history.map((entry) => [entry.stage, entry]));
	byStage.set(progress.stage, progress);
	return [...byStage.values()];
}
