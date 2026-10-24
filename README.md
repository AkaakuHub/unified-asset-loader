# unified-asset-loader

Asset loading with shared requests, validation, resumable chunk transfers, cache invalidation and progress reporting. The core depends only on its domain contracts and injected storage and transport ports.

## Install

```sh
npm install unified-asset-loader
```

The package is ESM and includes JavaScript, TypeScript declarations and browser Workers. Node.js22 or later is required for development and core usage. Browser use requires an ESM bundler that handles `new Worker(new URL(..., import.meta.url))`, such as Vite.

## Entrypoints

| Import | Responsibility |
| --- | --- |
| `unified-asset-loader` | Core loader factory, port contracts, progress, summary and workflow functions |
| `unified-asset-loader/browser` | OPFS cache, Worker pool, HTTP range transfers and shared browser loader |
| `unified-asset-loader/react` | Optional hooks for single assets, collections, object URLs and workflows |
| `unified-asset-loader/mui` | Optional progress components |

The core depends on domain types and injected ports. The browser implementation supplies those ports. React observes load state; MUI renders summaries. Applications supply URLs, identities, metadata parsers, validators, decoders and asset assembly. Server endpoints and format-specific converters belong to the application.

## Browser JSON loading

```ts
import { loadBrowserJsonArtifact } from 'unified-asset-loader/browser';

const controller = new AbortController();
const settings = await loadBrowserJsonArtifact({
  alias: 'my-app:settings',
  signal: controller.signal,
  metadataPolicy: 'cache-first',
  cacheValidation: { kind: 'immutable' },
  fetch: (signal) => fetch('/assets/settings.json', { signal }),
  parse(value) {
    if (typeof value !== 'object' || value === null || !('title' in value) || typeof value.title !== 'string') {
      throw new Error('Invalid settings');
    }
    return { title: value.title };
  },
  reportProgress: (progress) => console.log(progress.stage),
});
```

`immutable` reuses metadata only after the current parser accepts it. Use `metadataPolicy: 'refresh'` to request current metadata each time. `cache-first` with `expected-reference` checks the cached binary reference against the caller's current reference. Invalid metadata is removed and regenerated through the same request contract. Failed requests reject; incomplete assets are never returned as successes.

## GLB, glTF, OBJ and other binary assets

`loadBinaryAsset` downloads ordinary HTTP files, caches their original bytes and passes them to your decoder. It uses standard HTTP responses without a custom range server. The application supplies a stable `key`, the source URL, its byte size and a source identity such as an inventory checksum or ETag. A changed source identity replaces only that cached asset. Do not use implementation revisions as source identities.

```ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadBinaryAsset } from 'unified-asset-loader/browser';

const source = {
  key: 'gallery:model',
  url: 'https://assets.example/model.glb',
  identity: 'checksum-from-your-inventory',
  size: 123456,
};
const gltfLoader = new GLTFLoader();
const result = await loadBinaryAsset({
  source,
  signal: new AbortController().signal,
  decode: (bytes) => gltfLoader.parseAsync(
    Uint8Array.from(bytes).buffer,
    new URL('.', source.url).href,
  ),
});
// The application owns result.value.scene and its disposal.
```

The same API accepts an OBJ parser, texture decoder, audio decoder or a format-specific conversion adapter. Decoders may be asynchronous; the load completes only after they finish, and their errors reject the load. Three.js is an application dependency and is not included in the library. For glTF files with external buffers, textures, Draco or KTX2 resources, the application must configure and resolve those dependencies through its decoder. The API caches the requested file's bytes; it does not claim to discover or cache the dependency closure of every 3D format.

`createBinaryAssetLoader({ loader, fetch })` exposes the same API with injected storage/transport, using an instance returned by `createUnifiedAssetLoader`. The low-level contract below also supports separate original and converted caches and range-based delivery for applications that already provide them.

## Binary loading and conversion

`loadBrowserArtifact<Metadata, Result>(contract)` accepts the following application callbacks:

- `fetch(signal)` obtains the response; `decode(response, reportProgress)` interprets it.
- `parseMetadata(value)` validates both cached and fresh metadata against the current required structure.
- `reference(metadata)` returns `{ sha256, size, url }`, a local `{ assetPath, checksum, size, url: null }` identity, or `null` for metadata-only assets.
- `initialBinary(decoded, metadata)` optionally supplies a converted binary and its reference. `cacheMetadata(metadata)` determines the persisted metadata representation.
- `validate(metadata, binary)` checks the materialized result; `assemble(metadata, binary)` returns the application value.

Specify `generationPriority: 'standard'`, `materialization: 'binary'` (return bytes) or `'cache'` (prepare persistent bytes without assembling them), and `responseBody: { kind: 'metadata' }` or `{ kind: 'artifact', size }`.

The browser adapter stores metadata and binary chunks separately in OPFS under `browser-artifacts`. HTTP sources must support 4MiB ranges with matching `Content-Range` and a quoted SHA-256 ETag. A supplied local converted binary does not need a range endpoint. Keep original bytes and converted outputs under distinct application aliases. Conversion validation and regeneration use the application's existing original-data loader; this library does not add manual cache versions or implementation checksums.

Concurrent subscribers share a request for the same alias and materialization. Callers must use the same decoder/result contract for that identity. Aborting one subscriber leaves other subscribers running; the underlying request is aborted after all subscribers leave. Each core factory has its own queues and in-flight registry. The browser entrypoint uses one shared instance per module instance and preserves existing OPFS cache names.

## Core with your own storage

```ts
import { createUnifiedAssetLoader } from 'unified-asset-loader';
import type { AssetLoaderPorts } from 'unified-asset-loader';

export function createApplicationLoader(ports: AssetLoaderPorts) {
  return createUnifiedAssetLoader(ports);
}
```

`ports.cache` supplies `inspect`, `initializeMetadata`, `initialize`, `writeChunks` and `removeAlias`. `ports.transfer` supplies chunk transport; `ports.capacity` supplies concurrency and memory limits. `ports.reportFailure` receives failed shared loads. The factory returns a generic `load(contract)` function with the same contract as the browser entrypoint. No browser cache, Worker or React module is imported by the core.

## React and custom UI

```tsx
import { useBrowserArtifact } from 'unified-asset-loader/react';
import { loadBrowserJsonArtifact } from 'unified-asset-loader/browser';

function AssetStatus() {
  const state = useBrowserArtifact({
    enabled: true,
    identity: 'my-app:settings',
    load: async (signal, reportProgress, reportCacheWriteFailure) => {
      return loadBrowserJsonArtifact({
        alias: 'my-app:settings', signal, reportProgress, reportCacheWriteFailure,
        metadataPolicy: 'cache-first', cacheValidation: { kind: 'immutable' },
        fetch: (signal) => fetch('/assets/settings.json', { signal }),
        parse: (value) => value,
      });
    },
  });
  return <button onClick={state.retry}>{state.error ?? state.progress?.stage ?? 'Waiting'}</button>;
}
```

React19 is an optional peer dependency. Hooks expose state without imposing markup or styles. `useBrowserArtifacts` supports collections and cancellation; `useArtifactLoadWorkflow` exposes `summary`, `execute` and `reset`. `runArtifactLoadStep`, `runArtifactLocalStep` and `resolveArtifactLoadSummary` are available independently of React. The core reports stage and state identifiers; display wording belongs to the presentation layer (`unified-asset-loader/presentation/artifactLoadLabels`) or the consuming application.

For the supplied MUI progress UI, install React19, MUI9 and Emotion11 in the consuming application. Import `ArtifactLoadProgress` from `unified-asset-loader/mui` and pass `title`, `completionLabel` and `summary`. Customize its container with `sx`, inject controls with `actions`, and provide an error renderer with `renderError`, and customize stage labels with `formatStageLabel`, and set segment colors with `progressColors`. MUI themes control typography, spacing and palette. For full layout control, render the summary directly using your own components.

## Browser requirements

The OPFS Worker adapter requires a secure context, OPFS synchronous access handles in Workers, and cross-origin isolation. Serve the application with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. The core supports other environments through injected ports. Cache failures are reported and rejected; there is no in-memory fallback.

## Development and publishing

```sh
npm install
npm run build
npm run lint
bun test tests
npm pack
```

`npm run build` emits ESM and declarations and rewrites Worker URLs to the emitted `.js` files. `npm pack` rebuilds through `prepack`. The package contains only `dist`, this README and the MIT license. `npm run verify:package -- /absolute/path/to/new-scratch-directory` installs the tarball offline into an isolated consumer, imports the core and browser without UI peers, and checks emitted Worker assets. The scratch directory is removed afterward.

For source development, enable the repository hooks with `git config core.hooksPath .githooks`. The hooks compile the package and run its tests; they do not depend on a consuming application.

The package name is `unified-asset-loader`, the initial version is `0.1.0`, and the license is MIT. Registry availability, the publisher account and actual npm publication must be confirmed before running `npm publish`.
