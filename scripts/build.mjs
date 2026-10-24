import { spawnSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
await rm(join(root, 'dist'), { recursive: true, force: true });
const compiler = join(dirname(require.resolve('typescript-compiler-api/package.json')), 'lib/tsc.js');
const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
for (const entry of await readdir(join(root, 'dist'), { recursive: true })) {
 const path = join(root, 'dist', entry);
 if (!entry.endsWith('.js') && !entry.endsWith('.d.ts')) continue;
 const source = await readFile(path, 'utf8');
 const compiled = entry.endsWith('.d.ts')
  ? source.replace(/(from\s+['"]|\bimport\(['"])(\.{1,2}\/[^'"]+)\.tsx?(['"])/gu, '$1$2.js$3')
  : source.replaceAll('.worker.ts', '.worker.js');
 if (compiled !== source) await writeFile(path, compiled);
}
