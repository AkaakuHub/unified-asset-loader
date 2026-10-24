import type { ContentArtifactLoadProgress } from './contentArtifactLoadProgress.ts';
import { updateContentArtifactLoadProgressHistory } from './contentArtifactLoadProgress.ts';

export type BrowserArtifactCollectionEntry<Loaded> = Readonly<{
	value: Loaded | null;
	progress: ContentArtifactLoadProgress | null;
	progressHistory: readonly ContentArtifactLoadProgress[];
	error: string | null;
	cacheWriteError: string | null;
}>;

type BrowserArtifactCollectionEvent<Loaded> =
	| Readonly<{
			type: 'progress';
			identity: string;
			progress: ContentArtifactLoadProgress;
	  }>
	| Readonly<{ type: 'completed'; identity: string; value: Loaded | null }>
	| Readonly<{ type: 'failed'; identity: string; message: string }>
	| Readonly<{ type: 'cache-write-failed'; identity: string; message: string }>
	| Readonly<{ type: 'fail-pending'; message: string }>;

const emptyEntry = {
	value: null,
	progress: null,
	progressHistory: [],
	error: null,
	cacheWriteError: null,
} as const;

export function createBrowserArtifactCollectionEntries<Loaded>(
	identities: readonly string[],
): ReadonlyMap<string, BrowserArtifactCollectionEntry<Loaded>> {
	return new Map(identities.map((identity) => [identity, emptyEntry]));
}

export function reduceBrowserArtifactCollection<Loaded>(
	entries: ReadonlyMap<string, BrowserArtifactCollectionEntry<Loaded>>,
	event: BrowserArtifactCollectionEvent<Loaded>,
): ReadonlyMap<string, BrowserArtifactCollectionEntry<Loaded>> {
	if (event.type === 'fail-pending') {
		const next = new Map(entries);
		for (const [identity, entry] of entries) {
			if (entry.value === null && entry.error === null)
				next.set(identity, { ...entry, error: event.message });
		}
		return next;
	}
	const current = entries.get(event.identity);
	if (current === undefined) return entries;
	const next = new Map(entries);
	switch (event.type) {
		case 'progress':
			next.set(event.identity, {
				...current,
				progress: event.progress,
				progressHistory: updateContentArtifactLoadProgressHistory(
					current.progressHistory,
					event.progress,
				),
			});
			break;
		case 'completed':
			next.set(event.identity, { ...current, value: event.value });
			break;
		case 'failed':
			next.set(event.identity, { ...current, error: event.message });
			break;
		case 'cache-write-failed':
			next.set(event.identity, { ...current, cacheWriteError: event.message });
			break;
	}
	return next;
}
