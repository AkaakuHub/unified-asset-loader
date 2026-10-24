import {
	type ContentArtifactLoadProgress,
	contentArtifactLoadPercent,
	contentArtifactLoadStages,
} from './contentArtifactLoadProgress.ts';

export type ArtifactLoadSummaryEntry = Readonly<{
	identity: string;
	assetType: string;
	label: string;
	progress: ContentArtifactLoadProgress | null;
	progressHistory?: readonly ContentArtifactLoadProgress[];
	ready: boolean;
	error: string | null;
}>;

export type ArtifactLoadDetail = Readonly<{
	identity: string;
	assetType: string;
	label: string;
	status: 'waiting' | 'processing' | 'complete' | 'failed';
	stage: string;
	networkReceivedBytes: number;
	transferredBytes: number;
	totalBytes: number;
	progressPercent: number;
	completedArtifacts: number;
	totalArtifacts: number;
	activeArtifactLabel: string | null;
	error: string | null;
	phases: readonly ArtifactLoadPhase[];
}>;

export type ArtifactLoadPhase = Readonly<{
	label: string;
	status: 'waiting' | 'processing' | 'complete' | 'failed';
	stage: string;
	networkReceivedBytes: number;
	transferredBytes: number;
	totalBytes: number;
	completedArtifacts: number;
	totalArtifacts: number;
	error: string | null;
}>;

export type ArtifactLoadSummary = Readonly<{
	ready: number;
	succeeded: number;
	failed: number;
	processing: number;
	total: number;
	completed: boolean;
	networkReceivedBytes: number;
	preparedBytes: number;
	totalBytes: number;
	completedArtifacts: number;
	totalArtifacts: number;
	progressPercent: number;
	details: readonly ArtifactLoadDetail[];
	failures: readonly Readonly<{
		identity: string;
		assetType: string;
		label: string;
		stage: string;
		reason: string;
	}>[];
}>;

export function resolveArtifactLoadSummary(
	entries: readonly ArtifactLoadSummaryEntry[],
): ArtifactLoadSummary {
	const unique = new Map<string, ArtifactLoadSummaryEntry>();
	for (const entry of entries) {
		const existing = unique.get(entry.identity);
		if (
			existing !== undefined &&
			(existing.label !== entry.label || existing.assetType !== entry.assetType)
		) {
			throw new Error('Artifact load entry identity is ambiguous');
		}
		unique.set(entry.identity, entry);
	}
	const values = [...unique.values()];
	const failures = values.flatMap((entry) =>
		entry.error === null
			? []
			: [
					{
						identity: entry.identity,
						assetType: entry.assetType,
						label: entry.label,
						stage: progressStage(entry),
						reason: entry.error,
					},
				],
	);
	const succeeded = values.filter(isArtifactReady).length;
	const processing = values.filter(
		(entry) => !isArtifactReady(entry) && entry.error === null,
	).length;
	const details = values.map(resolveArtifactLoadDetail);
	const networkReceivedBytes = sumDetails(
		details,
		(detail) => detail.networkReceivedBytes,
	);
	const preparedBytes = sumDetails(
		details,
		(detail) => detail.transferredBytes,
	);
	const totalBytes = sumDetails(details, (detail) => detail.totalBytes);
	const completedArtifacts = sumDetails(
		details,
		(detail) => detail.completedArtifacts,
	);
	const totalArtifacts = sumDetails(details, (detail) => detail.totalArtifacts);
	const completed =
		values.length > 0 && processing === 0 && failures.length === 0;
	return {
		ready: succeeded,
		succeeded,
		failed: failures.length,
		processing,
		total: values.length,
		completed,
		networkReceivedBytes,
		preparedBytes,
		totalBytes,
		completedArtifacts,
		totalArtifacts,
		progressPercent: resolveProgressPercent(completed, details),
		details,
		failures,
	};
}

function progressStage(entry: ArtifactLoadSummaryEntry): string {
	if (entry.progress !== null) return entry.progress.stage;
	return 'prepare';
}

function resolveArtifactLoadDetail(
	entry: ArtifactLoadSummaryEntry,
): ArtifactLoadDetail {
	const progress = entry.progress;
	const phases = resolveArtifactLoadPhases(entry);
	const metrics = resolveProgressMetrics(entry);
	return {
		identity: entry.identity,
		assetType: entry.assetType,
		label: entry.label,
		status:
			entry.error !== null
				? 'failed'
				: isArtifactReady(entry)
					? 'complete'
					: progress === null
						? 'waiting'
						: 'processing',
		stage:
			entry.error !== null
				? progressStage(entry)
				: isArtifactReady(entry)
					? 'complete'
					: progress === null
						? 'waiting'
						: progress.stage,
		networkReceivedBytes: metrics.networkReceivedBytes,
		transferredBytes: metrics.transferredBytes,
		totalBytes: metrics.totalBytes,
		progressPercent: resolveDetailProgressPercent(entry),
		completedArtifacts: metrics.completedArtifacts,
		totalArtifacts: metrics.totalArtifacts,
		activeArtifactLabel: progress?.activeArtifactLabel ?? null,
		error: entry.error,
		phases,
	};
}

function resolveArtifactLoadPhases(
	entry: ArtifactLoadSummaryEntry,
): readonly ArtifactLoadPhase[] {
	if (entry.progressHistory === undefined) return [];
	const progressByStage = new Map(
		entry.progressHistory.map((progress) => [progress.stage, progress]),
	);
	const observed = contentArtifactLoadStages.flatMap((stage) => {
		const progress = progressByStage.get(stage);
		return progress === undefined ? [] : [progress];
	});
	const failedStage = entry.error === null ? null : observed.at(-1)?.stage;
	return observed.map((progress, index) =>
		resolvePhase(
			progress.stage,
			progress,
			entry.ready || progress.stageCompleted || index < observed.length - 1,
			progress.stage === failedStage ? entry.error : null,
		),
	);
}

function resolvePhase(
	label: string,
	progress: ContentArtifactLoadProgress | undefined,
	complete: boolean,
	error: string | null,
): ArtifactLoadPhase {
	return {
		label,
		status:
			error !== null
				? 'failed'
				: complete
					? 'complete'
					: progress === undefined
						? 'waiting'
						: 'processing',
		stage:
			error !== null
				? 'failed'
				: complete
					? 'complete'
					: progress === undefined
						? 'waiting'
						: 'processing',
		networkReceivedBytes: progress?.networkReceivedBytes ?? 0,
		transferredBytes: progress?.transferredBytes ?? 0,
		totalBytes: progress?.totalBytes ?? 0,
		completedArtifacts: progress?.completedArtifacts ?? 0,
		totalArtifacts: progress?.totalArtifacts ?? 0,
		error,
	};
}

function resolveProgressMetrics(entry: ArtifactLoadSummaryEntry): Readonly<{
	networkReceivedBytes: number;
	transferredBytes: number;
	totalBytes: number;
	completedArtifacts: number;
	totalArtifacts: number;
}> {
	const samples = [
		...(entry.progressHistory ?? []),
		...(entry.progress === null ? [] : [entry.progress]),
	];
	return {
		networkReceivedBytes: maximum(samples, 'networkReceivedBytes'),
		transferredBytes: maximum(samples, 'transferredBytes'),
		totalBytes: maximum(samples, 'totalBytes'),
		completedArtifacts: isArtifactReady(entry)
			? maximum(samples, 'totalArtifacts')
			: maximum(samples, 'completedArtifacts'),
		totalArtifacts: maximum(samples, 'totalArtifacts'),
	};
}

function maximum(
	samples: readonly ContentArtifactLoadProgress[],
	key:
		| 'networkReceivedBytes'
		| 'transferredBytes'
		| 'totalBytes'
		| 'completedArtifacts'
		| 'totalArtifacts',
): number {
	return samples.reduce(
		(result, progress) => Math.max(result, progress[key]),
		0,
	);
}

function sumDetails(
	details: readonly ArtifactLoadDetail[],
	value: (detail: ArtifactLoadDetail) => number,
): number {
	return details.reduce((total, detail) => total + value(detail), 0);
}

function resolveProgressPercent(
	completed: boolean,
	details: readonly ArtifactLoadDetail[],
): number {
	if (completed) return 100;
	if (details.length === 0) return 0;
	return Math.floor(
		details.reduce((total, detail) => total + detail.progressPercent, 0) /
			details.length,
	);
}

function resolveDetailProgressPercent(entry: ArtifactLoadSummaryEntry): number {
	if (isArtifactReady(entry)) return 100;
	return entry.progress === null
		? 0
		: contentArtifactLoadPercent(entry.progress);
}

function isArtifactReady(entry: ArtifactLoadSummaryEntry): boolean {
	return entry.ready && entry.error === null;
}
