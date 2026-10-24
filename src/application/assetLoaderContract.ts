import type { BrowserArtifactGenerationPriority } from '../domain/browserArtifactGenerationScheduler.ts';
import type { BrowserArtifactReference } from '../domain/browserArtifactReference.ts';
import type { ContentArtifactLoadProgress } from '../domain/contentArtifactLoadProgress.ts';

export type BrowserArtifactCacheValidation =
	| Readonly<{ kind: 'immutable' }>
	| Readonly<{
			kind: 'expected-reference';
			reference: BrowserArtifactReference;
	  }>;

type BrowserArtifactLoaderContractBase<Metadata, Result> = Readonly<{
	alias: string;
	generationPriority: BrowserArtifactGenerationPriority;
	materialization: 'binary' | 'cache';
	responseBody:
		| Readonly<{ kind: 'metadata' }>
		| Readonly<{ kind: 'artifact'; size: number }>;
	signal: AbortSignal;
	fetch(signal: AbortSignal): Promise<Response>;
	decode(
		response: Response,
		reportProgress:
			| ((progress: ContentArtifactLoadProgress) => void)
			| undefined,
	): Promise<unknown>;
	parseMetadata(value: unknown): Metadata | Promise<Metadata>;
	shouldCacheMetadata?: (metadata: Metadata) => boolean;
	reference(metadata: Metadata): BrowserArtifactReference | null;
	initialBinary?: (
		decoded: unknown,
		metadata: Metadata,
	) => BrowserArtifactInitialBinary | null;
	cacheMetadata?: (metadata: Metadata) => unknown;
	assemble(
		metadata: Metadata,
		binary: Uint8Array | null,
	): Result | Promise<Result>;
	validate(metadata: Metadata, binary: Uint8Array | null): void | Promise<void>;
	reportMetadata?: (metadata: Metadata) => void;
	reportProgress?:
		| ((progress: ContentArtifactLoadProgress) => void)
		| undefined;
	reportCacheWriteFailure(message: string): void;
}>;

export type BrowserArtifactInitialBinary = Readonly<{
	binary: Uint8Array;
	reference: BrowserArtifactReference;
}>;

export type BrowserArtifactLoaderContract<Metadata, Result> =
	BrowserArtifactLoaderContractBase<Metadata, Result> &
		(
			| Readonly<{ metadataPolicy: 'refresh' }>
			| Readonly<{
					metadataPolicy: 'cache-first';
					cacheValidation: BrowserArtifactCacheValidation;
			  }>
		);

export type BrowserArtifactLoaderResult<Result> = Readonly<{
	value: Result;
	source: 'cache' | 'network';
}>;
