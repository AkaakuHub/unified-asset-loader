import { useCallback, useEffect, useRef, useState } from 'react';
import {
	type BrowserArtifactCollectionEntry,
	createBrowserArtifactCollectionEntries,
	reduceBrowserArtifactCollection,
} from '../domain/browserArtifactCollectionState.ts';
import type { ContentArtifactLoadProgress } from '../domain/contentArtifactLoadProgress.ts';
import { unknownErrorMessage } from '../domain/unknownErrorMessage.ts';

type BrowserArtifactLoader<Loaded> = (
	signal: AbortSignal,
	reportProgress: (progress: ContentArtifactLoadProgress) => void,
	reportCacheWriteFailure: (message: string) => void,
) => Promise<Loaded | null>;

type BrowserArtifactRequest<Loaded> = Readonly<{
	identity: string;
	load: BrowserArtifactLoader<Loaded>;
}>;

type BrowserArtifactCollectionState<Loaded> = Readonly<{
	requestSetIdentity: string;
	loads: ReadonlyMap<string, BrowserArtifactCollectionEntry<Loaded>>;
}>;

export function useBrowserArtifacts<Loaded>(input: {
	enabled: boolean;
	requests: readonly BrowserArtifactRequest<Loaded>[];
	abortSignal?: AbortSignal;
	abortOnFailure?: boolean;
	onLoadFailure?(cause: unknown): void;
}): Readonly<{
	loads: ReadonlyMap<string, BrowserArtifactCollectionEntry<Loaded>>;
	retry: () => void;
}> {
	const [retryKey, setRetryKey] = useState(0);
	const requestIdentities = input.requests.map(({ identity }) => identity);
	if (new Set(requestIdentities).size !== requestIdentities.length)
		throw new Error('Browser artifact request identity is duplicated');
	const requestSetIdentity = `${JSON.stringify(requestIdentities)}:${String(retryKey)}`;
	const loadersRef = useRef(new Map<string, BrowserArtifactLoader<Loaded>>());
	const onLoadFailureRef = useRef(input.onLoadFailure);
	loadersRef.current = new Map(
		input.requests.map(({ identity, load }) => [identity, load]),
	);
	onLoadFailureRef.current = input.onLoadFailure;
	const [state, setState] = useState<BrowserArtifactCollectionState<Loaded>>({
		requestSetIdentity,
		loads: createBrowserArtifactCollectionEntries(requestIdentities),
	});
	useEffect(() => {
		const abort = new AbortController();
		const activeLoaders = new Map(loadersRef.current);
		const activeIdentities = [...activeLoaders.keys()];
		setState({
			requestSetIdentity,
			loads: createBrowserArtifactCollectionEntries(activeIdentities),
		});
		if (!input.enabled) return () => abort.abort();
		const abortPendingLoads = () => {
			abort.abort(input.abortSignal?.reason);
			updateLoads({
				type: 'fail-pending',
				message: 'Browser artifact collection load was aborted',
			});
		};
		if (input.abortSignal?.aborted) {
			abortPendingLoads();
			return;
		}
		input.abortSignal?.addEventListener('abort', abortPendingLoads, {
			once: true,
		});
		for (const identity of activeIdentities) {
			const load = activeLoaders.get(identity);
			if (load === undefined)
				throw new Error('Browser artifact loader is absent');
			void load(
				abort.signal,
				(progress) => {
					if (!abort.signal.aborted)
						updateLoads({ type: 'progress', identity, progress });
				},
				(message) => {
					if (!abort.signal.aborted)
						updateLoads({ type: 'cache-write-failed', identity, message });
				},
			).then(
				(value) => {
					if (!abort.signal.aborted)
						updateLoads({ type: 'completed', identity, value });
				},
				(cause: unknown) => {
					if (abort.signal.aborted) return;
					const message = unknownErrorMessage(cause);
					updateLoads({ type: 'failed', identity, message });
					onLoadFailureRef.current?.(cause);
					if (input.abortOnFailure) {
						updateLoads({
							type: 'fail-pending',
							message: `Browser artifact collection was aborted after ${identity} failed: ${message}`,
						});
						abort.abort(cause);
					}
				},
			);
		}
		return () => {
			input.abortSignal?.removeEventListener('abort', abortPendingLoads);
			abort.abort();
		};

		function updateLoads(
			event: Parameters<typeof reduceBrowserArtifactCollection<Loaded>>[1],
		): void {
			setState((current) => {
				if (current.requestSetIdentity !== requestSetIdentity) return current;
				return {
					requestSetIdentity,
					loads: reduceBrowserArtifactCollection(current.loads, event),
				};
			});
		}
	}, [
		input.abortOnFailure,
		input.abortSignal,
		input.enabled,
		requestSetIdentity,
	]);
	const retry = useCallback(() => setRetryKey((current) => current + 1), []);
	return {
		loads:
			state.requestSetIdentity === requestSetIdentity
				? state.loads
				: createBrowserArtifactCollectionEntries(requestIdentities),
		retry,
	};
}

export function useBrowserArtifact<Loaded>(input: {
	enabled: boolean;
	identity: string;
	load: BrowserArtifactLoader<Loaded>;
}): BrowserArtifactCollectionEntry<Loaded> & Readonly<{ retry: () => void }> {
	const collection = useBrowserArtifacts({
		enabled: input.enabled,
		requests: [{ identity: input.identity, load: input.load }],
	});
	const load = collection.loads.get(input.identity);
	if (load === undefined)
		throw new Error('Browser artifact collection entry is absent');
	return { ...load, retry: collection.retry };
}
