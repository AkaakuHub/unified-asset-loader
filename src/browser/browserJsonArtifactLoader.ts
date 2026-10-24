import type { BrowserArtifactCacheValidation } from '../application/assetLoaderContract.ts';
import type { ContentArtifactLoadProgress } from '../domain/contentArtifactLoadProgress.ts';
import { loadBrowserArtifact } from './browserArtifactLoader.ts';

type BrowserJsonArtifactMetadataPolicy =
	| Readonly<{ metadataPolicy: 'refresh' }>
	| Readonly<{
			metadataPolicy: 'cache-first';
			cacheValidation: BrowserArtifactCacheValidation;
	  }>;

export type BrowserJsonArtifactLoadOptions = Readonly<{
	signal?: AbortSignal;
	reportProgress?: (progress: ContentArtifactLoadProgress) => void;
	reportCacheWriteFailure?: (message: string) => void;
}>;

export async function loadBrowserJsonArtifact<Value>(
	input: Readonly<{
		alias: string;
		signal: AbortSignal;
		fetch(signal: AbortSignal): Promise<Response>;
		parse(value: unknown): Value | Promise<Value>;
		reportProgress?: (progress: ContentArtifactLoadProgress) => void;
		reportCacheWriteFailure?: (message: string) => void;
	}> &
		BrowserJsonArtifactMetadataPolicy,
): Promise<Value> {
	const loaded = await loadBrowserArtifact<Value, Value>({
		alias: input.alias,
		generationPriority: 'standard',
		materialization: 'cache',
		responseBody: { kind: 'metadata' },
		signal: input.signal,
		fetch: input.fetch,
		decode: (response) => response.json(),
		parseMetadata: input.parse,
		shouldCacheMetadata: () => input.metadataPolicy === 'cache-first',
		reference: () => null,
		assemble: (value) => value,
		validate: (_metadata, binary) => {
			if (binary !== null)
				throw new Error('Browser JSON artifact binary is unexpected');
		},
		reportProgress: input.reportProgress,
		reportCacheWriteFailure: input.reportCacheWriteFailure ?? (() => undefined),
		...(input.metadataPolicy === 'refresh'
			? { metadataPolicy: 'refresh' as const }
			: {
					metadataPolicy: 'cache-first' as const,
					cacheValidation: input.cacheValidation,
				}),
	});
	return loaded.value;
}
