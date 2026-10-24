import type { ArtifactLoadSummaryEntry } from './artifactLoadSummary.ts';
import {
	type ContentArtifactLoadProgress,
	updateContentArtifactLoadProgressHistory,
} from './contentArtifactLoadProgress.ts';

export type ArtifactLoadEntryEvent = Readonly<{
	type: 'started' | 'progress' | 'completed' | 'failed';
	identity: string;
	assetType: string;
	label: string;
	progress?: ContentArtifactLoadProgress;
	error?: string;
}>;

export type ArtifactLoadEntryState = ReadonlyMap<
	string,
	ArtifactLoadSummaryEntry
>;

export function reduceArtifactLoadEntryEvent(
	loads: ArtifactLoadEntryState,
	event: ArtifactLoadEntryEvent,
): ArtifactLoadEntryState {
	const current = loads.get(event.identity);
	const entry: ArtifactLoadSummaryEntry = current ?? {
		identity: event.identity,
		assetType: event.assetType,
		label: event.label,
		progress: null,
		progressHistory: [],
		ready: false,
		error: null,
	};
	if (entry.assetType !== event.assetType || entry.label !== event.label)
		throw new Error('Artifact load identity is ambiguous');
	const next = new Map(loads);
	if (event.type === 'started') {
		next.set(event.identity, {
			...entry,
			progress: null,
			progressHistory: [],
			ready: false,
			error: null,
		});
	} else if (event.type === 'progress') {
		if (event.progress === undefined)
			throw new Error('Artifact load progress is absent');
		next.set(event.identity, {
			...entry,
			progress: event.progress,
			progressHistory: updateContentArtifactLoadProgressHistory(
				entry.progressHistory ?? [],
				event.progress,
			),
		});
	} else if (event.type === 'completed') {
		next.set(event.identity, { ...entry, ready: true, error: null });
	} else {
		if (event.error === undefined)
			throw new Error('Artifact load failure reason is absent');
		next.set(event.identity, { ...entry, ready: false, error: event.error });
	}
	return next;
}
