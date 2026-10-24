import type { BrowserArtifactReference } from '../domain/browserArtifactReference.ts';
import type { BrowserArtifactResourceCapacity } from '../domain/browserArtifactResourceCapacity.ts';
import type { ContentAddressedArtifactReference } from '../domain/contentAddressedArtifact.ts';

export type BrowserArtifactCacheInspection =
	| Readonly<{ kind: 'miss' }>
	| Readonly<{ kind: 'metadata'; metadata: unknown }>
	| Readonly<{
			kind: 'partial';
			metadata: unknown;
			reference: BrowserArtifactReference;
			missingIndexes: readonly number[];
	  }>
	| Readonly<{
			kind: 'ready';
			metadata: unknown;
			reference: BrowserArtifactReference;
	  }>
	| Readonly<{
			kind: 'complete';
			metadata: unknown;
			reference: BrowserArtifactReference;
			binary: Uint8Array;
	  }>;

export type ArtifactChunk = Readonly<{ index: number; bytes: Uint8Array }>;
export type ArtifactTransferRequest = Readonly<{
	reference: ContentAddressedArtifactReference;
	missingIndexes: readonly number[];
	parallelism: number;
	signal: AbortSignal;
	write(chunks: readonly ArtifactChunk[]): Promise<void>;
	report(
		progress: Readonly<{ networkReceivedBytes: number; savedBytes: number }>,
	): void;
}>;

export type AssetLoaderPorts = Readonly<{
	cache: Readonly<{
		inspect(
			alias: string,
			assembleBinary: boolean,
		): Promise<BrowserArtifactCacheInspection>;
		removeAlias(alias: string): Promise<void>;
		initializeMetadata(alias: string, metadata: unknown): Promise<void>;
		initialize(
			alias: string,
			metadata: unknown,
			reference: BrowserArtifactReference,
		): Promise<boolean>;
		writeChunks(
			reference: BrowserArtifactReference,
			chunks: readonly ArtifactChunk[],
		): Promise<void>;
	}>;
	capacity(): BrowserArtifactResourceCapacity;
	transfer(request: ArtifactTransferRequest): Promise<void>;
	reportFailure(alias: string, cause: unknown): void;
}>;
