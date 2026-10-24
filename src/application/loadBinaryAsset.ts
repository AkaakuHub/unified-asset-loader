import type { BrowserArtifactReference } from '../domain/browserArtifactReference.ts';
import {
	browserArtifactReferencesMatch,
	isBrowserArtifactReference,
	locallyMaterializedBrowserArtifactReference,
} from '../domain/browserArtifactReference.ts';
import type { ContentArtifactLoadProgress } from '../domain/contentArtifactLoadProgress.ts';
import type {
	BrowserArtifactLoaderContract,
	BrowserArtifactLoaderResult,
} from './assetLoaderContract.ts';
import { readArtifactResponseBinary } from './readArtifactResponseBinary.ts';

export type BinaryAssetSource = Readonly<{
	key: string;
	url: string;
	identity: string;
	size: number;
}>;

export type BinaryAssetRequest<Asset> = Readonly<{
	source: BinaryAssetSource;
	signal: AbortSignal;
	decode(bytes: Uint8Array): Asset | Promise<Asset>;
	validate?(bytes: Uint8Array): void | Promise<void>;
	reportProgress?:
		| ((progress: ContentArtifactLoadProgress) => void)
		| undefined;
	reportCacheWriteFailure?: ((message: string) => void) | undefined;
}>;

export type AssetLoader = Readonly<{
	load<Metadata, Result>(
		contract: BrowserArtifactLoaderContract<Metadata, Result>,
	): Promise<BrowserArtifactLoaderResult<Result>>;
}>;

type Metadata = Readonly<{ reference: BrowserArtifactReference }>;

export function createBinaryAssetLoader(
	ports: Readonly<{
		loader: AssetLoader;
		fetch(url: string, signal: AbortSignal): Promise<Response>;
	}>,
) {
	return {
		async load<Asset>(
			request: BinaryAssetRequest<Asset>,
		): Promise<BrowserArtifactLoaderResult<Asset>> {
			const { source } = request;
			if (
				source.key.length === 0 ||
				source.url.length === 0 ||
				source.identity.length === 0 ||
				!Number.isSafeInteger(source.size) ||
				source.size <= 0
			) {
				throw new Error('Binary asset source is invalid');
			}
			const reference = locallyMaterializedBrowserArtifactReference({
				assetPath: source.url,
				checksum: source.identity,
				size: source.size,
			});
			return await ports.loader.load<Metadata, Asset>({
				alias: source.key,
				generationPriority: 'standard',
				materialization: 'binary',
				metadataPolicy: 'cache-first',
				cacheValidation: { kind: 'expected-reference', reference },
				responseBody: { kind: 'artifact', size: source.size },
				signal: request.signal,
				fetch: (signal) => ports.fetch(source.url, signal),
				decode: async (response, report) => ({
					reference,
					binary: await readArtifactResponseBinary(
						response,
						source.size,
						report,
					),
				}),
				parseMetadata: (value) => {
					if (
						typeof value !== 'object' ||
						value === null ||
						!('reference' in value) ||
						!isBrowserArtifactReference(value.reference) ||
						!browserArtifactReferencesMatch(value.reference, reference)
					) {
						throw new Error('Binary asset cache identity differs');
					}
					return { reference: value.reference };
				},
				reference: (metadata) => metadata.reference,
				initialBinary: (value, metadata) => {
					if (
						typeof value !== 'object' ||
						value === null ||
						!('binary' in value) ||
						!(value.binary instanceof Uint8Array)
					)
						throw new Error('Binary asset payload is absent');
					return { binary: value.binary, reference: metadata.reference };
				},
				cacheMetadata: (metadata) => metadata,
				validate: async (metadata, binary) => {
					if (binary === null || binary.byteLength !== metadata.reference.size)
						throw new Error('Binary asset byte length differs');
					await request.validate?.(binary);
				},
				assemble: (metadata, binary) => {
					if (binary === null)
						throw new Error(
							`Binary asset bytes are absent: expected ${String(metadata.reference.size)} bytes`,
						);
					return request.decode(binary);
				},
				reportProgress: request.reportProgress,
				reportCacheWriteFailure: request.reportCacheWriteFailure ?? (() => {}),
			});
		},
	};
}
