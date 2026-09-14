import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

let buildCommit = process.env.ARISE_BUILD_COMMIT?.trim();
if (!buildCommit) {
  try {
    buildCommit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    buildCommit = 'unknown';
  }
}
const buildDate = process.env.ARISE_BUILD_DATE?.trim() || new Date().toISOString();
const define = {
  __ARISE_BUILD_COMMIT__: JSON.stringify(buildCommit),
  __ARISE_BUILD_DATE__: JSON.stringify(buildDate),
};

await build({
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist/main/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron', 'better-sqlite3'],
  define,
});
await build({
  entryPoints: ['src/preload/preload.ts'],
  outfile: 'dist/preload/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  define,
});
await build({
  entryPoints: ['../mt5-agent/src/main.ts'],
  outfile: 'dist/agent/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  define,
});
