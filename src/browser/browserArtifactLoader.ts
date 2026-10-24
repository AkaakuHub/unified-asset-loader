import { createUnifiedAssetLoader } from '../application/createUnifiedAssetLoader.ts';
import { reportBrowserArtifactFailure } from '../application/reportBrowserArtifactFailure.ts';
import {
	deleteBrowserArtifactAlias,
	initializeBrowserArtifactCache,
	initializeBrowserArtifactMetadataCache,
	inspectBrowserArtifactCache,
	writeBrowserArtifactChunks,
} from './browserArtifactCache.ts';
import { browserArtifactRuntimeCapacity } from './browserArtifactRuntimeCapacity.ts';
import { fetchMissingContentAddressedArtifactChunks } from './contentAddressedArtifactRange.ts';

export const browserArtifactCompositionMetadataPolicy = 'cache-first' as const;

export const { load: loadBrowserArtifact } = createUnifiedAssetLoader({
	cache: {
		inspect: inspectBrowserArtifactCache,
		removeAlias: deleteBrowserArtifactAlias,
		initializeMetadata: initializeBrowserArtifactMetadataCache,
		initialize: initializeBrowserArtifactCache,
		writeChunks: writeBrowserArtifactChunks,
	},
	capacity: browserArtifactRuntimeCapacity,
	transfer: fetchMissingContentAddressedArtifactChunks,
	reportFailure: reportBrowserArtifactFailure,
});
