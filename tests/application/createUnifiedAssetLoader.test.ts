import { expect, test } from 'bun:test';
import type { BrowserArtifactLoaderContract } from '../../src/application/assetLoaderContract.ts';
import type { AssetLoaderPorts } from '../../src/application/assetLoaderPorts.ts';
import { createUnifiedAssetLoader } from '../../src/application/createUnifiedAssetLoader.ts';
import { browserArtifactResourceCapacity } from '../../src/domain/browserArtifactResourceCapacity.ts';

function createPorts() {
	const metadata = new Map<string, unknown>();
	const ports: AssetLoaderPorts = {
		cache: {
			inspect: async (alias) =>
				metadata.has(alias)
					? { kind: 'metadata', metadata: metadata.get(alias) }
					: { kind: 'miss' },
			initializeMetadata: async (alias, value) => {
				metadata.set(alias, value);
			},
			removeAlias: async (alias) => {
				metadata.delete(alias);
			},
			initialize: async () => {
				throw new Error('Unexpected binary initialization');
			},
			writeChunks: async () => {
				throw new Error('Unexpected binary write');
			},
		},
		capacity: () =>
			browserArtifactResourceCapacity({
				hardwareConcurrency: 4,
				deviceMemoryGibibytes: undefined,
				platform: 'Linux',
			}),
		transfer: async () => {
			throw new Error('Unexpected binary transfer');
		},
		reportFailure: () => {},
	};
	return { ports, metadata };
}
function contract(
	fetchResponse: () => Promise<Response>,
	signal = new AbortController().signal,
): BrowserArtifactLoaderContract<string, string> {
	return {
		alias: 'independent-app:document',
		generationPriority: 'standard',
		materialization: 'cache',
		responseBody: { kind: 'metadata' },
		metadataPolicy: 'cache-first',
		cacheValidation: { kind: 'immutable' },
		signal,
		fetch: fetchResponse,
		decode: async (response) => response.json(),
		parseMetadata: (value) => {
			if (typeof value !== 'string') throw new Error('Invalid document');
			return value;
		},
		reference: () => null,
		validate: () => {},
		assemble: (value) => value,
		reportCacheWriteFailure: () => {},
	};
}

test('independent storage validates and reuses cached metadata without browser APIs', async () => {
	const { ports } = createPorts();
	const loader = createUnifiedAssetLoader(ports);
	let requests = 0;
	const request = contract(async () => {
		requests += 1;
		return Response.json('document');
	});
	expect(await loader.load(request)).toEqual({
		value: 'document',
		source: 'network',
	});
	expect(await loader.load(request)).toEqual({
		value: 'document',
		source: 'cache',
	});
	expect(requests).toBe(1);
});

test('invalid cached metadata is regenerated with the current parser', async () => {
	const { ports, metadata } = createPorts();
	metadata.set('independent-app:document', { obsolete: true });
	const loader = createUnifiedAssetLoader(ports);
	expect(
		await loader.load(contract(async () => Response.json('current'))),
	).toEqual({ value: 'current', source: 'network' });
	expect(metadata.get('independent-app:document')).toBe('current');
});

test('a cancelled subscriber does not abort a shared request used by another subscriber', async () => {
	const { ports } = createPorts();
	const loader = createUnifiedAssetLoader(ports);
	const firstAbort = new AbortController();
	const secondAbort = new AbortController();
	let release: (response: Response) => void = () => {
		throw new Error('Request not started');
	};
	let started: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		started = resolve;
	});
	let requests = 0;
	const fetchResponse = () =>
		new Promise<Response>((resolve) => {
			requests += 1;
			release = resolve;
			started();
		});
	const first = loader.load(contract(fetchResponse, firstAbort.signal));
	const second = loader.load(contract(fetchResponse, secondAbort.signal));
	await ready;
	firstAbort.abort();
	await expect(first).rejects.toMatchObject({ name: 'AbortError' });
	release(Response.json('shared'));
	expect(await second).toEqual({ value: 'shared', source: 'network' });
	expect(requests).toBe(1);
});

test('factories never share cached results across storage instances', async () => {
	const first = createUnifiedAssetLoader(createPorts().ports);
	const second = createUnifiedAssetLoader(createPorts().ports);
	const values = await Promise.all([
		first.load(contract(async () => Response.json('first'))),
		second.load(contract(async () => Response.json('second'))),
	]);
	expect(values.map((value) => value.value)).toEqual(['first', 'second']);
});
