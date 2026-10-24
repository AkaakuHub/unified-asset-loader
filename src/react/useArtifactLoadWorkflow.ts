import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	type ArtifactLoadEntryEvent,
	type ArtifactLoadEntryState,
	reduceArtifactLoadEntryEvent,
} from '../domain/artifactLoadEntryState.ts';
import {
	type ArtifactLoadSummary,
	resolveArtifactLoadSummary,
} from '../domain/artifactLoadSummary.ts';

export function useArtifactLoadWorkflow(): Readonly<{
	summary: ArtifactLoadSummary;
	execute<Value>(
		operation: (
			signal: AbortSignal,
			reportLoadEvent: (event: ArtifactLoadEntryEvent) => void,
		) => Promise<Value>,
	): Promise<Value>;
	reset(): void;
}> {
	const [loads, setLoads] = useState<ArtifactLoadEntryState>(new Map());
	const abortRef = useRef<AbortController | null>(null);
	const summary = useMemo(
		() => resolveArtifactLoadSummary([...loads.values()]),
		[loads],
	);
	const reset = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setLoads(new Map());
	}, []);
	useEffect(
		() => () => {
			abortRef.current?.abort();
		},
		[],
	);
	const execute = useCallback(
		async <Value>(
			operation: (
				signal: AbortSignal,
				reportLoadEvent: (event: ArtifactLoadEntryEvent) => void,
			) => Promise<Value>,
		): Promise<Value> => {
			abortRef.current?.abort();
			const abort = new AbortController();
			abortRef.current = abort;
			setLoads(new Map());
			const reportLoadEvent = (event: ArtifactLoadEntryEvent): void => {
				if (abortRef.current !== abort || abort.signal.aborted) return;
				setLoads((current) => reduceArtifactLoadEntryEvent(current, event));
			};
			try {
				return await operation(abort.signal, reportLoadEvent);
			} finally {
				if (abortRef.current === abort) abortRef.current = null;
			}
		},
		[],
	);
	return { summary, execute, reset };
}
