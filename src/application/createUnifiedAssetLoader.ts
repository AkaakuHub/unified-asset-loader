import { WeightedTaskScheduler } from '../application/scheduling/weightedTaskScheduler.ts';
import { browserArtifactCacheFailureAction } from '../domain/browserArtifactCache.ts';
import { requestWhileRemovingInvalidBrowserArtifactAlias } from '../domain/browserArtifactCacheReplacement.ts';
import { BrowserArtifactGenerationScheduler } from '../domain/browserArtifactGenerationScheduler.ts';
import { createBrowserArtifactInspectionCoordinator } from '../domain/browserArtifactInspectionCoordinator.ts';
import {
	type BrowserArtifactReference,
	browserArtifactReferencesMatch,
	remoteBrowserArtifactReference,
} from '../domain/browserArtifactReference.ts';
import {
	browserArtifactResponseActiveBytes,
	browserArtifactTransferActiveBytes,
} from '../domain/browserArtifactResourceCapacity.ts';
import type { ContentAddressedArtifactReference } from '../domain/contentAddressedArtifact.ts';
import { contentAddressedArtifactExistingBytes } from '../domain/contentAddressedArtifactRange.ts';
import {
	type ContentArtifactLoadProgress,
	contentArtifactLoadProgress,
} from '../domain/contentArtifactLoadProgress.ts';
import {
	createSharedLoadFlight,
	getOrCreateSharedLoadFlight,
	type SharedLoadFlight,
} from '../domain/sharedLoadFlight.ts';
import { unknownErrorMessage } from '../domain/unknownErrorMessage.ts';
import type {
	BrowserArtifactInitialBinary,
	BrowserArtifactLoaderContract,
	BrowserArtifactLoaderResult,
} from './assetLoaderContract.ts';

import type { AssetLoaderPorts } from './assetLoaderPorts.ts';
import { browserArtifactHttpError } from './browserArtifactHttpError.ts';

export function isBrowserArtifactMetadataCacheable<Metadata>(
	metadata: Metadata,
	shouldCacheMetadata: ((metadata: Metadata) => boolean) | undefined,
): boolean {
	return shouldCacheMetadata?.(metadata) ?? true;
}

export function createUnifiedAssetLoader(ports: AssetLoaderPorts) {
	const {
		inspect: inspectBrowserArtifactCache,
		removeAlias: deleteBrowserArtifactAlias,
		initializeMetadata: initializeBrowserArtifactMetadataCache,
		initialize: initializeBrowserArtifactCache,
		writeChunks: writeBrowserArtifactChunks,
	} = ports.cache;

	type AliasLoadProgress =
		| Readonly<{ kind: 'progress'; progress: ContentArtifactLoadProgress }>
		| Readonly<{ kind: 'metadata'; metadata: unknown }>
		| Readonly<{ kind: 'cache-write-failure'; message: string }>;
	type AliasLoadFlight = SharedLoadFlight<
		AliasLoadProgress,
		BrowserArtifactLoaderResult<unknown>
	>;

	const aliasLoads = new Map<string, AliasLoadFlight>();
	type ArtifactTransferProgress = Readonly<{
		networkReceivedBytes: number;
		savedBytes: number;
	}>;
	type ArtifactTransferFlight = SharedLoadFlight<
		ArtifactTransferProgress,
		void
	>;
	const artifactTransfers = new Map<string, ArtifactTransferFlight>();
	const artifactInspection = createBrowserArtifactInspectionCoordinator(
		inspectBrowserArtifactCache,
	);
	let artifactGenerationScheduler: BrowserArtifactGenerationScheduler | null =
		null;
	let artifactTransferScheduler: WeightedTaskScheduler | null = null;

	async function loadBrowserArtifact<Metadata, Result>(
		contract: BrowserArtifactLoaderContract<Metadata, Result>,
	): Promise<BrowserArtifactLoaderResult<Result>> {
		const loadIdentity = `${contract.materialization}:${contract.alias}`;
		const flight = getOrCreateSharedLoadFlight(
			aliasLoads.get(loadIdentity),
			() => createAliasLoadFlight(loadIdentity, contract),
		);
		return await subscribeAliasLoadFlight(flight, contract);
	}

	function createAliasLoadFlight<Metadata, Result>(
		loadIdentity: string,
		contract: BrowserArtifactLoaderContract<Metadata, Result>,
	): AliasLoadFlight {
		const flight = createSharedLoadFlight<
			AliasLoadProgress,
			BrowserArtifactLoaderResult<unknown>
		>(
			async (signal, report) =>
				await loadBrowserArtifactOnce({
					...contract,
					signal,
					reportProgress: (progress) => report({ kind: 'progress', progress }),
					reportMetadata: (metadata) => report({ kind: 'metadata', metadata }),
					reportCacheWriteFailure: (message) =>
						report({ kind: 'cache-write-failure', message }),
				}),
		);
		void flight.completion.then(
			() => removeAliasLoad(loadIdentity, flight),
			(cause) => {
				ports.reportFailure(contract.alias, cause);
				removeAliasLoad(loadIdentity, flight);
			},
		);
		aliasLoads.set(loadIdentity, flight);
		return flight;
	}

	async function subscribeAliasLoadFlight<Metadata, Result>(
		flight: AliasLoadFlight,
		contract: BrowserArtifactLoaderContract<Metadata, Result>,
	): Promise<BrowserArtifactLoaderResult<Result>> {
		const loaded = await flight.subscribe(contract.signal, (event) => {
			if (event.kind === 'progress') contract.reportProgress?.(event.progress);
			else if (event.kind === 'metadata')
				contract.reportMetadata?.(event.metadata as Metadata);
			else contract.reportCacheWriteFailure(event.message);
		});
		return { ...loaded, value: loaded.value as Result };
	}

	function removeAliasLoad(alias: string, flight: AliasLoadFlight): void {
		if (aliasLoads.get(alias) === flight) aliasLoads.delete(alias);
	}

	async function loadBrowserArtifactOnce<Metadata, Result>(
		contract: BrowserArtifactLoaderContract<Metadata, Result>,
	): Promise<BrowserArtifactLoaderResult<Result>> {
		let invalidAliasRemoval: Promise<void> | null = null;
		contract.reportProgress?.(
			contentArtifactLoadProgress({
				stage: 'cache-check',
				stageCompleted: false,
			}),
		);
		let inspection =
			contract.metadataPolicy === 'cache-first'
				? await artifactInspection.inspectForMaterialization(
						contract.alias,
						contract.materialization,
						contract.signal,
					)
				: { kind: 'miss' as const };
		contract.reportProgress?.(
			contentArtifactLoadProgress({
				stage: 'cache-check',
				stageCompleted: true,
			}),
		);
		if (
			inspection.kind !== 'miss' &&
			contract.metadataPolicy === 'cache-first' &&
			contract.cacheValidation.kind !== 'immutable'
		) {
			if (inspection.kind === 'metadata') {
				invalidAliasRemoval = deleteBrowserArtifactAlias(contract.alias);
				inspection = { kind: 'miss' };
			} else if (
				!referencesMatch(
					inspection.reference,
					contract.cacheValidation.reference,
				)
			) {
				invalidAliasRemoval = deleteBrowserArtifactAlias(contract.alias);
				inspection = { kind: 'miss' };
			}
		}
		if (inspection.kind === 'partial' && inspection.reference.url === null) {
			invalidAliasRemoval = deleteBrowserArtifactAlias(contract.alias);
			inspection = { kind: 'miss' };
		}
		if (inspection.kind !== 'miss') {
			if (inspection.kind === 'metadata') {
				let cachedMetadata: Metadata | undefined;
				try {
					const metadata = await contract.parseMetadata(inspection.metadata);
					if (
						!isBrowserArtifactMetadataCacheable(
							metadata,
							contract.shouldCacheMetadata,
						)
					)
						throw new Error('Browser artifact metadata is not cacheable');
					if (contract.reference(metadata) !== null)
						throw new Error(
							'Browser artifact metadata cache reference differs',
						);
					cachedMetadata = metadata;
				} catch (cause) {
					if (browserArtifactCacheFailureAction('metadata', cause) === 'abort')
						throw cause;
					invalidAliasRemoval = deleteBrowserArtifactAlias(contract.alias);
				}
				if (cachedMetadata !== undefined) {
					contract.reportMetadata?.(cachedMetadata);
					return {
						value: await finishArtifact(contract, cachedMetadata, null),
						source: 'cache',
					};
				}
			}
			if (inspection.kind === 'metadata') {
				if (invalidAliasRemoval === null)
					throw new Error('Browser artifact metadata cache state is invalid');
			} else {
				let cached:
					| Readonly<{
							metadata: Metadata;
							reference: BrowserArtifactReference;
					  }>
					| undefined;
				try {
					const metadata = await contract.parseMetadata(inspection.metadata);
					if (
						!isBrowserArtifactMetadataCacheable(
							metadata,
							contract.shouldCacheMetadata,
						)
					)
						throw new Error('Browser artifact metadata is not cacheable');
					cached = {
						metadata,
						reference: requiredMatchingReference(
							contract.reference(metadata),
							inspection.reference,
						),
					};
				} catch (cause) {
					if (browserArtifactCacheFailureAction('metadata', cause) === 'abort')
						throw cause;
					invalidAliasRemoval = deleteBrowserArtifactAlias(contract.alias);
				}
				if (cached !== undefined) {
					const { metadata, reference } = cached;
					contract.reportMetadata?.(metadata);
					let binary: Uint8Array | null | undefined;
					if (inspection.kind === 'partial') {
						try {
							await transferMissingChunks(
								reference,
								inspection.missingIndexes,
								contract,
							);
						} catch (cause) {
							const action = browserArtifactCacheFailureAction(
								'transfer',
								cause,
							);
							if (action === 'abort' || action === 'preserve-partial')
								throw cause;
							invalidAliasRemoval = deleteBrowserArtifactAlias(contract.alias);
							cached = undefined;
						}
					}
					if (cached !== undefined) {
						try {
							binary =
								inspection.kind === 'complete'
									? inspection.binary
									: await readCachedArtifactBinary(contract);
						} catch (cause) {
							if (browserArtifactCacheFailureAction('read', cause) === 'abort')
								throw cause;
							invalidAliasRemoval = deleteBrowserArtifactAlias(contract.alias);
						}
						if (binary !== undefined) {
							try {
								return {
									value: await finishArtifact(contract, metadata, binary),
									source: 'cache',
								};
							} catch (cause) {
								if (
									browserArtifactCacheFailureAction('read', cause) === 'abort'
								)
									throw cause;
								invalidAliasRemoval = deleteBrowserArtifactAlias(
									contract.alias,
								);
							}
						}
					}
				}
			}
		}
		contract.reportProgress?.(
			contentArtifactLoadProgress({ stage: 'queue', stageCompleted: false }),
		);
		const decodedMetadata = await decodeBrowserArtifactResponse(
			contract,
			invalidAliasRemoval,
		);
		contract.reportProgress?.(
			contentArtifactLoadProgress({ stage: 'metadata', stageCompleted: false }),
		);
		const metadata = await contract.parseMetadata(decodedMetadata);
		contract.reportProgress?.(
			contentArtifactLoadProgress({ stage: 'metadata', stageCompleted: true }),
		);
		const reference = contract.reference(metadata);
		if (reference === null) {
			if (
				isBrowserArtifactMetadataCacheable(
					metadata,
					contract.shouldCacheMetadata,
				)
			) {
				await initializeBrowserArtifactMetadataCache(
					contract.alias,
					decodedMetadata,
				);
			}
			contract.reportMetadata?.(metadata);
			return {
				value: await finishArtifact(contract, metadata, null),
				source: 'network',
			};
		}
		let cachedBinary: Uint8Array | null;
		try {
			const initialized = await initializeBrowserArtifactCache(
				contract.alias,
				contract.cacheMetadata?.(metadata) ?? decodedMetadata,
				reference,
			);
			if (!initialized)
				throw new Error('Browser artifact cache capacity is exhausted');
			contract.reportMetadata?.(metadata);
			const partial = await artifactInspection.inspectManifest(
				contract.alias,
				contract.signal,
			);
			if (partial.kind === 'miss')
				throw new Error('Browser artifact cache manifest is absent');
			const initial = contract.initialBinary?.(decodedMetadata, metadata);
			const initialBinary =
				initial === undefined || initial === null
					? null
					: verifiedInitialBinary(reference, initial);
			if (partial.kind === 'partial') {
				if (initialBinary === null)
					await transferMissingChunks(
						reference,
						partial.missingIndexes,
						contract,
					);
				else await storeInitialBinary(reference, initialBinary, contract);
			}
			cachedBinary =
				contract.materialization === 'cache'
					? null
					: initialBinary === null
						? await readCachedArtifactBinary(contract)
						: initialBinary;
		} catch (cause) {
			contract.reportCacheWriteFailure(unknownErrorMessage(cause));
			throw cause;
		}
		return {
			value: await finishArtifact(contract, metadata, cachedBinary),
			source: 'network',
		};
	}

	async function decodeBrowserArtifactResponse<Metadata, Result>(
		contract: BrowserArtifactLoaderContract<Metadata, Result>,
		invalidAliasRemoval: Promise<void> | null,
	): Promise<unknown> {
		if (contract.responseBody.kind === 'metadata') {
			return await browserArtifactGenerationScheduler().schedule(
				contract.signal,
				contract.generationPriority,
				async () =>
					await contract.decode(
						await requestBrowserArtifactResponse(contract, invalidAliasRemoval),
						contract.reportProgress,
					),
			);
		}
		return await browserArtifactTransferScheduler().schedule(
			browserArtifactResponseActiveBytes(contract.responseBody.size),
			async () => {
				const response = await requestBrowserArtifactResponse(
					contract,
					invalidAliasRemoval,
				);
				return await contract.decode(response, contract.reportProgress);
			},
		);
	}

	async function requestBrowserArtifactResponse<Metadata, Result>(
		contract: BrowserArtifactLoaderContract<Metadata, Result>,
		invalidAliasRemoval: Promise<void> | null,
	): Promise<Response> {
		contract.reportProgress?.(
			contentArtifactLoadProgress({
				stage: 'request',
				stageCompleted: false,
			}),
		);
		const response =
			invalidAliasRemoval === null
				? await contract.fetch(contract.signal)
				: await requestWhileRemovingInvalidBrowserArtifactAlias(
						invalidAliasRemoval,
						() => contract.fetch(contract.signal),
					);
		if (!response.ok) throw await browserArtifactHttpError(response);
		contract.reportProgress?.(
			contentArtifactLoadProgress({
				stage: 'request',
				stageCompleted: true,
			}),
		);
		return response;
	}

	async function transferMissingChunks<Metadata, Result>(
		reference: BrowserArtifactReference,
		missingIndexes: readonly number[],
		contract: BrowserArtifactLoaderContract<Metadata, Result>,
	): Promise<void> {
		const remoteReference = remoteBrowserArtifactReference(reference);
		const existing = artifactTransfers.get(remoteReference.sha256);
		const existingBytes = contentAddressedArtifactExistingBytes(
			remoteReference,
			missingIndexes,
		);
		const flight = getOrCreateSharedLoadFlight(existing, () =>
			createArtifactTransferFlight(remoteReference, missingIndexes),
		);
		await flight.subscribe(contract.signal, (progress) => {
			if (contract.reportProgress !== undefined)
				reportArtifactTransferProgress(
					remoteReference,
					existingBytes,
					progress,
					contract.reportProgress,
				);
		});
	}

	async function storeInitialBinary<Metadata, Result>(
		reference: BrowserArtifactReference,
		binary: Uint8Array,
		contract: BrowserArtifactLoaderContract<Metadata, Result>,
	): Promise<void> {
		contract.reportProgress?.(
			contentArtifactLoadProgress({
				stage: 'transfer',
				stageCompleted: false,
				networkReceivedBytes: binary.byteLength,
				transferredBytes: 0,
				totalBytes: reference.size,
			}),
		);
		const chunks = Array.from(
			{ length: Math.ceil(binary.byteLength / (4 * 1024 * 1024)) },
			(_, index) => ({
				index,
				bytes: binary.slice(
					index * 4 * 1024 * 1024,
					Math.min(binary.byteLength, (index + 1) * 4 * 1024 * 1024),
				),
			}),
		);
		await writeBrowserArtifactChunks(reference, chunks);
		contract.reportProgress?.(
			contentArtifactLoadProgress({
				stage: 'transfer',
				stageCompleted: true,
				networkReceivedBytes: binary.byteLength,
				transferredBytes: binary.byteLength,
				totalBytes: reference.size,
			}),
		);
	}

	function verifiedInitialBinary(
		reference: BrowserArtifactReference,
		initial: BrowserArtifactInitialBinary,
	): Uint8Array {
		if (
			!browserArtifactReferencesMatch(initial.reference, reference) ||
			initial.binary.byteLength !== reference.size
		)
			throw new Error('Browser artifact initial binary identity differs');
		return initial.binary;
	}

	function createArtifactTransferFlight(
		reference: ContentAddressedArtifactReference,
		missingIndexes: readonly number[],
	): ArtifactTransferFlight {
		const capacity = ports.capacity();
		const flight = createSharedLoadFlight<ArtifactTransferProgress, void>(
			async (signal, report) => {
				report({ networkReceivedBytes: 0, savedBytes: 0 });
				await browserArtifactTransferScheduler().schedule(
					browserArtifactTransferActiveBytes(
						reference.size,
						capacity.rangeParallelism,
					),
					async () =>
						await ports.transfer({
							reference,
							missingIndexes,
							parallelism: capacity.rangeParallelism,
							signal,
							write: async (chunks) =>
								await writeBrowserArtifactChunks(reference, chunks),
							report,
						}),
				);
			},
		);
		void flight.completion.then(
			() => removeArtifactTransfer(reference.sha256, flight),
			() => removeArtifactTransfer(reference.sha256, flight),
		);
		artifactTransfers.set(reference.sha256, flight);
		return flight;
	}

	function removeArtifactTransfer(
		sha256: string,
		flight: ArtifactTransferFlight,
	): void {
		if (artifactTransfers.get(sha256) === flight)
			artifactTransfers.delete(sha256);
	}

	function browserArtifactGenerationScheduler(): BrowserArtifactGenerationScheduler {
		if (artifactGenerationScheduler !== null)
			return artifactGenerationScheduler;
		artifactGenerationScheduler = new BrowserArtifactGenerationScheduler(
			ports.capacity().parallelism,
		);
		return artifactGenerationScheduler;
	}

	function browserArtifactTransferScheduler(): WeightedTaskScheduler {
		if (artifactTransferScheduler !== null) return artifactTransferScheduler;
		const capacity = ports.capacity();
		artifactTransferScheduler = new WeightedTaskScheduler(
			capacity.maximumConcurrentTransfers,
			capacity.maximumActiveBytes,
		);
		return artifactTransferScheduler;
	}

	function reportArtifactTransferProgress(
		reference: ContentAddressedArtifactReference,
		existingBytes: number,
		progress: ArtifactTransferProgress,
		reportProgress: (progress: ContentArtifactLoadProgress) => void,
	): void {
		const transferredBytes = Math.min(
			reference.size,
			existingBytes + progress.savedBytes,
		);
		reportProgress(
			contentArtifactLoadProgress({
				stage: 'transfer',
				stageCompleted: transferredBytes === reference.size,
				networkReceivedBytes: progress.networkReceivedBytes,
				transferredBytes,
				totalBytes: reference.size,
			}),
		);
	}

	async function readCachedArtifactBinary<Metadata, Result>(
		contract: BrowserArtifactLoaderContract<Metadata, Result>,
	): Promise<Uint8Array | null> {
		if (contract.materialization === 'cache') return null;
		const complete = await artifactInspection.inspectBinary(
			contract.alias,
			contract.signal,
		);
		if (complete.kind !== 'complete')
			throw new Error('Browser artifact cache remains incomplete');
		return complete.binary;
	}

	async function finishArtifact<Metadata, Result>(
		contract: BrowserArtifactLoaderContract<Metadata, Result>,
		metadata: Metadata,
		binary: Uint8Array | null,
	): Promise<Result> {
		contract.reportProgress?.(
			contentArtifactLoadProgress({ stage: 'validate', stageCompleted: false }),
		);
		await contract.validate(metadata, binary);
		contract.reportProgress?.(
			contentArtifactLoadProgress({ stage: 'validate', stageCompleted: true }),
		);
		contract.reportProgress?.(
			contentArtifactLoadProgress({ stage: 'decode', stageCompleted: false }),
		);
		const result = await contract.assemble(metadata, binary);
		contract.reportProgress?.(
			contentArtifactLoadProgress({ stage: 'decode', stageCompleted: true }),
		);
		return result;
	}

	function requiredMatchingReference(
		actual: BrowserArtifactReference | null,
		expected: BrowserArtifactReference,
	): BrowserArtifactReference {
		if (
			actual === null ||
			!browserArtifactReferencesMatch(actual, expected) ||
			actual.url !== expected.url
		)
			throw new Error('Browser artifact reference differs');
		return actual;
	}

	function referencesMatch(
		left: BrowserArtifactReference,
		right: BrowserArtifactReference,
	): boolean {
		return browserArtifactReferencesMatch(left, right);
	}

	return { load: loadBrowserArtifact };
}
