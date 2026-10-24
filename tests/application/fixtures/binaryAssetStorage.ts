import type { AssetLoaderPorts } from '../../../src/application/assetLoaderPorts.ts';
import type { BrowserArtifactReference } from '../../../src/domain/browserArtifactReference.ts';
import { browserArtifactResourceCapacity } from '../../../src/domain/browserArtifactResourceCapacity.ts';

export function createStorage(): AssetLoaderPorts {
	const entries = new Map<
		string,
		Readonly<{ metadata: unknown; reference: BrowserArtifactReference }>
	>();
	const files = new Map<BrowserArtifactReference, Uint8Array>();
	return {
		cache: {
			inspect: async (alias) => {
				const entry = entries.get(alias);
				if (entry === undefined) return { kind: 'miss' };
				const binary = files.get(entry.reference);
				return binary === undefined
					? { kind: 'partial', ...entry, missingIndexes: [0] }
					: { kind: 'complete', ...entry, binary };
			},
			initialize: async (alias, metadata, reference) => {
				entries.set(alias, { metadata, reference });
				return true;
			},
			removeAlias: async (alias) => {
				entries.delete(alias);
			},
			writeChunks: async (reference, chunks) => {
				const binary = new Uint8Array(reference.size);
				for (const chunk of chunks)
					binary.set(chunk.bytes, chunk.index * 4 * 1024 * 1024);
				files.set(reference, binary);
			},
			initializeMetadata: async () => {
				throw new Error('Binary assets require a reference');
			},
		},
		capacity: () =>
			browserArtifactResourceCapacity({
				hardwareConcurrency: 4,
				deviceMemoryGibibytes: undefined,
				platform: 'Linux',
			}),
		transfer: async () => {
			throw new Error(
				'Ordinary file downloads must not require a custom range endpoint',
			);
		},
		reportFailure: () => {},
	};
}
