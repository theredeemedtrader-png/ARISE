import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const PYTHON_VERSION = '3.13.14';
const PYTHON_SHA256 = '90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907';
const MT5_VERSION = '5.0.6180';
const NUMPY_VERSION = '2.5.3';
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(desktopRoot, 'build', 'cache');
const runtime = path.join(desktopRoot, 'build', 'python');
const archive = path.join(cache, `python-${PYTHON_VERSION}-embed-amd64.zip`);
const url = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;

await mkdir(cache, { recursive: true });
if (!existsSync(archive)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Python runtime download failed: HTTP ${response.status}`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
}
const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
if (digest !== PYTHON_SHA256) throw new Error(`Python runtime checksum mismatch: ${digest}`);

await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
const extracted = spawnSync('tar.exe', ['-xf', archive, '-C', runtime], { stdio: 'inherit', windowsHide: true });
if (extracted.status !== 0) throw new Error('Unable to extract the pinned Python runtime');

const pth = path.join(runtime, 'python313._pth');
const pthText = (await readFile(pth, 'utf8')).replace(/^#import site$/m, 'import site');
await writeFile(pth, pthText, 'utf8');

const configuredPython = process.env.ARISE_PACKAGING_PYTHON?.trim();
const installer = configuredPython || 'py.exe';
const prefix = configuredPython ? [] : ['-3.13'];
const installed = spawnSync(installer, [
  ...prefix,
  '-m', 'pip', 'install',
  '--disable-pip-version-check',
  '--no-compile',
  '--only-binary=:all:',
  '--no-deps',
  '--target', runtime,
  `numpy==${NUMPY_VERSION}`,
  `MetaTrader5==${MT5_VERSION}`,
], { stdio: 'inherit', windowsHide: true });
if (installed.status !== 0) {
  throw new Error('Unable to install the pinned MetaTrader5 package into the private runtime');
}

const smoke = spawnSync(path.join(runtime, 'python.exe'), [
  '-c',
  `import MetaTrader5; assert MetaTrader5.__version__ == '${MT5_VERSION}'; print(MetaTrader5.__version__)`,
], { stdio: 'inherit', windowsHide: true });
if (smoke.status !== 0) throw new Error('Private Python runtime smoke test failed');
console.log(`Built private Python ${PYTHON_VERSION} runtime with MetaTrader5 ${MT5_VERSION}.`);
