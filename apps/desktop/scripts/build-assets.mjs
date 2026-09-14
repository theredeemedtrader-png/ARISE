import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const source = path.join(repositoryRoot, 'assets', 'brand', 'arise-symbol.svg');
const output = path.join(desktopRoot, 'build', 'generated');
const sizes = [16, 24, 32, 48, 64, 128, 256];

await mkdir(output, { recursive: true });
const svg = await readFile(source);
const pngFiles = [];
for (const size of sizes) {
  const destination = path.join(output, `arise-symbol-${size}.png`);
  await sharp(svg, { density: 1200 })
    .resize(size, size, { fit: 'contain' })
    .png()
    .toFile(destination);
  pngFiles.push(destination);
}
await writeFile(path.join(output, 'arise.ico'), await pngToIco(pngFiles));
console.log(`Generated ARISE icon assets from ${path.relative(repositoryRoot, source)}.`);
