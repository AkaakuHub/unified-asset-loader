import { createBinaryAssetLoader } from '../application/loadBinaryAsset.ts';
import { loadBrowserArtifact } from './browserArtifactLoader.ts';

export const { load: loadBinaryAsset } = createBinaryAssetLoader({
	loader: { load: loadBrowserArtifact },
	fetch: (url, signal) => fetch(url, { signal }),
});
