import { useEffect, useState } from 'react';
import type { ContentArtifactLoadProgress } from '../domain/contentArtifactLoadProgress.ts';
import { useBrowserArtifact } from './useBrowserArtifact.ts';

type LoadedBrowserMediaArtifact = Readonly<{
	binary: Uint8Array;
	mediaType: string;
}>;

type BrowserMediaArtifactLoader = (
	signal: AbortSignal,
	reportProgress: (progress: ContentArtifactLoadProgress) => void,
	reportCacheWriteFailure: (message: string) => void,
) => Promise<LoadedBrowserMediaArtifact | null>;

export function useBrowserArtifactObjectUrl(input: {
	identity: string;
	load: BrowserMediaArtifactLoader;
}): Readonly<{
	source: string | null;
	progress: ContentArtifactLoadProgress | null;
	error: string | null;
}> {
	const loaded = useBrowserArtifact({
		enabled: true,
		identity: input.identity,
		load: input.load,
	});
	const [source, setSource] = useState<Readonly<{
		identity: string;
		value: string;
	}> | null>(null);
	useEffect(() => {
		if (loaded.value === null) {
			setSource(null);
			return;
		}
		const binary =
			loaded.value.binary.buffer instanceof ArrayBuffer &&
			loaded.value.binary.byteOffset === 0 &&
			loaded.value.binary.byteLength === loaded.value.binary.buffer.byteLength
				? loaded.value.binary.buffer
				: loaded.value.binary.slice().buffer;
		const objectUrl = URL.createObjectURL(
			new Blob([binary], { type: loaded.value.mediaType }),
		);
		setSource({ identity: input.identity, value: objectUrl });
		return () => {
			URL.revokeObjectURL(objectUrl);
		};
	}, [input.identity, loaded.value]);
	return {
		source: source?.identity === input.identity ? source.value : null,
		progress: loaded.progress,
		error: loaded.error ?? loaded.cacheWriteError,
	};
}
