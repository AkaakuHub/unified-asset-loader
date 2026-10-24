import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2]) throw new Error('Pass an empty scratch directory for package verification');
const scratch = resolve(process.argv[2]);
function run(command, args, cwd = root) {
 const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
 if (result.error) throw result.error;
 if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}\n${result.stdout}`);
 return result.stdout;
}
await mkdir(scratch, { recursive: false });
try {
 const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch]))[0];
 assert(packed && packed.filename);
 const names = packed.files.map((entry) => entry.path);
 assert(names.includes('dist/browser/browserArtifactFile.worker.js'));
 assert(names.includes('dist/browser/browserArtifactMetadata.worker.js'));
 assert(names.includes('dist/index.d.ts'));
 const consumer = resolve(scratch, 'consumer');
 await mkdir(consumer);
 await writeFile(resolve(consumer, 'package.json'), JSON.stringify({ type: 'module', private: true }));
 run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--offline', resolve(scratch, packed.filename)], consumer);
 await writeFile(resolve(consumer, 'verify.mjs'), `
import assert from 'node:assert/strict';
import { createUnifiedAssetLoader, browserArtifactResourceCapacity, resolveArtifactLoadSummary } from 'unified-asset-loader';
import { loadBrowserArtifact } from 'unified-asset-loader/browser';
assert.equal(typeof createUnifiedAssetLoader, 'function');
assert.equal(typeof loadBrowserArtifact, 'function');
assert.equal(typeof browserArtifactResourceCapacity, 'function');
assert.equal(resolveArtifactLoadSummary([]).total, 0);
console.log('npm tarball: core and browser entrypoints imported without React or repository sources');
`);
 process.stdout.write(run(process.execPath, ['verify.mjs'], consumer));
 await writeFile(resolve(consumer, 'verify.mts'), `
import { createUnifiedAssetLoader, createBinaryAssetLoader } from 'unified-asset-loader';
import type { AssetLoaderPorts } from 'unified-asset-loader';
import { loadBinaryAsset } from 'unified-asset-loader/browser';
export async function typedConsumer(ports: AssetLoaderPorts) {
 const loader = createBinaryAssetLoader({ loader: createUnifiedAssetLoader(ports), fetch: (url, signal) => fetch(url, { signal }) });
 const request = {
  source: { key: 'mesh', url: '/mesh.glb', identity: 'source-identity', size: 8 },
  signal: new AbortController().signal,
  decode: async (bytes: Uint8Array) => ({ byteLength: bytes.byteLength }),
 };
 const result = await loader.load(request);
 const browserResult = await loadBinaryAsset(request);
 const size: number = result.value.byteLength + browserResult.value.byteLength;
 return size;
}
`);
 const require = createRequire(import.meta.url);
 const compiler = resolve(dirname(require.resolve('typescript-compiler-api/package.json')), 'lib/tsc.js');
 run(process.execPath, [compiler, '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--lib', 'ES2023,DOM,DOM.Iterable', 'verify.mts'], consumer);
 console.log('npm tarball: standalone TypeScript consumer validated');

 for (const worker of ['browserArtifactFile', 'browserArtifactMetadata']) {
  run(process.execPath, ['--check', resolve(consumer, 'node_modules/unified-asset-loader/dist/browser', worker + '.worker.js')], consumer);
 }

 console.log(`npm tarball verified: ${packed.filename}, ${names.length} files`);
} finally {
 await rm(scratch, { recursive: true, force: true });
}
