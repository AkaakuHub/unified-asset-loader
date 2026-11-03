import type { ContentArtifactLoadProgress } from '../domain/contentArtifactLoadProgress.ts';

export type ArtifactLoadStageLabels = Readonly<
	Record<
		| ContentArtifactLoadProgress['stage']
		| 'prepare'
		| 'waiting'
		| 'complete'
		| 'failed'
		| 'processing',
		string
	>
> &
	Readonly<Record<string, string>>;

export function formatArtifactLoadLabel(
	label: string,
	labels: ArtifactLoadStageLabels,
): string {
	return labels[label] ?? label;
}
