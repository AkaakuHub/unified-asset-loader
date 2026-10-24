import { expect, test } from 'bun:test';
import { createUnifiedAssetLoader } from '../../src/application/createUnifiedAssetLoader.ts';
import { createBinaryAssetLoader } from '../../src/application/loadBinaryAsset.ts';
import { createStorage } from './fixtures/binaryAssetStorage.ts';

const source = {
	key: 'texture',
	url: '/texture.webp',
	identity: 'inventory-checksum',
	size: 3,
};
const goodBytes = new Uint8Array([1, 2, 3]);
function validate(bytes: Uint8Array) {
	if (bytes[0] !== 1) throw new Error('Checksum differs');
}

test('invalid received bytes never enter the cache and a later attempt can recover', async () => {
	let requests = 0;
	let checks = 0;
	let decodes = 0;
	const loader = createBinaryAssetLoader({
		loader: createUnifiedAssetLoader(createStorage()),
		fetch: async () => {
			requests++;
			return new Response(
				requests === 1 ? new Uint8Array([0, 0, 0]) : goodBytes,
			);
		},
	});
	const request = {
		source,
		signal: new AbortController().signal,
		validate: async (bytes: Uint8Array) => {
			checks++;
			validate(bytes);
		},
		decode: () => {
			decodes++;
			return 'texture';
		},
	};
	await expect(loader.load(request)).rejects.toThrow('Checksum differs');
	expect(decodes).toBe(0);
	expect(await loader.load(request)).toEqual({
		source: 'network',
		value: 'texture',
	});
	expect(await loader.load(request)).toEqual({
		source: 'cache',
		value: 'texture',
	});
	expect(requests).toBe(2);
	expect(checks).toBe(3);
	expect(decodes).toBe(2);
});

test('corrupt cached bytes are invalidated without an automatic network retry', async () => {
	const storage = createStorage();
	let requests = 0;
	let decodes = 0;
	const loader = createBinaryAssetLoader({
		loader: createUnifiedAssetLoader(storage),
		fetch: async () => {
			requests++;
			return new Response(goodBytes);
		},
	});
	const request = {
		source,
		signal: new AbortController().signal,
		validate,
		decode: () => {
			decodes++;
			return 'texture';
		},
	};
	await loader.load(request);
	const cached = await storage.cache.inspect(source.key, true);
	if (cached.kind !== 'complete') throw new Error('Expected completed cache');
	cached.binary[0] = 0;
	await expect(loader.load(request)).rejects.toThrow('Checksum differs');
	expect(requests).toBe(1);
	expect(decodes).toBe(1);
	expect(await loader.load(request)).toEqual({
		source: 'network',
		value: 'texture',
	});
	expect(requests).toBe(2);
});

test('decoder failures preserve bytes that passed validation', async () => {
	let requests = 0;
	let failDecoder = true;
	const loader = createBinaryAssetLoader({
		loader: createUnifiedAssetLoader(createStorage()),
		fetch: async () => {
			requests++;
			return new Response(goodBytes);
		},
	});
	const request = {
		source,
		signal: new AbortController().signal,
		validate,
		decode: () => {
			if (failDecoder) throw new Error('Renderer unavailable');
			return 'texture';
		},
	};
	await expect(loader.load(request)).rejects.toThrow('Renderer unavailable');
	failDecoder = false;
	expect(await loader.load(request)).toEqual({
		source: 'cache',
		value: 'texture',
	});
	expect(requests).toBe(1);
});
