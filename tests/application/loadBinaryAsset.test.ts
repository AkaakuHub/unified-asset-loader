import { expect, test } from 'bun:test';
import { createUnifiedAssetLoader } from '../../src/application/createUnifiedAssetLoader.ts';
import { createBinaryAssetLoader } from '../../src/application/loadBinaryAsset.ts';
import { createStorage } from './fixtures/binaryAssetStorage.ts';

test('ordinary GLB bytes are cached using standard HTTP responses', async () => {
	const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
	let requests = 0;
	let decodes = 0;
	const loader = createBinaryAssetLoader({
		loader: createUnifiedAssetLoader(createStorage()),
		fetch: async (url) => {
			expect(url).toBe('https://assets.example/model.glb');
			requests += 1;
			return new Response(bytes);
		},
	});
	const request = {
		source: {
			key: 'model:preview',
			url: 'https://assets.example/model.glb',
			identity: 'source-etag',
			size: bytes.length,
		},
		signal: new AbortController().signal,
		decode: async (received: Uint8Array) => {
			decodes += 1;
			expect(received).toEqual(bytes);
			return { mesh: 'application-owned' };
		},
	};
	expect(await loader.load(request)).toEqual({
		source: 'network',
		value: { mesh: 'application-owned' },
	});
	expect(await loader.load(request)).toEqual({
		source: 'cache',
		value: { mesh: 'application-owned' },
	});
	expect(requests).toBe(1);
	expect(decodes).toBe(2);
	expect(
		(
			await loader.load({
				...request,
				source: { ...request.source, identity: 'changed-source-etag' },
			})
		).source,
	).toBe('network');
	expect(requests).toBe(2);
});

test('decoder completion is awaited and decoder failure rejects the whole asset load', async () => {
	const stages: boolean[] = [];
	const loader = createBinaryAssetLoader({
		loader: createUnifiedAssetLoader(createStorage()),
		fetch: async () => new Response(new Uint8Array([1, 2, 3])),
	});
	const request = {
		source: { key: 'mesh', url: '/mesh.obj', identity: 'source', size: 3 },
		signal: new AbortController().signal,
		reportProgress: (
			progress: import('../../src/domain/contentArtifactLoadProgress.ts').ContentArtifactLoadProgress,
		) => {
			if (progress.stage === 'decode') stages.push(progress.stageCompleted);
		},
		decode: async () => {
			await Promise.resolve();
			expect(stages).toEqual([false]);
			throw new Error('Invalid geometry');
		},
	};
	await expect(loader.load(request)).rejects.toThrow('Invalid geometry');
	expect(stages).toEqual([false]);
});
