import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const out = resolve(root, 'www');
await mkdir(out, { recursive: true });
const entries = await readdir(root, { withFileTypes: true });
const pages = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.html'));
for (const page of pages) {
  await copyFile(resolve(root, page.name), resolve(out, page.name));
}
await copyFile(resolve(root, 'manifest.webmanifest'), resolve(out, 'manifest.webmanifest'));
await mkdir(resolve(out, 'icons'), { recursive: true });
await copyFile(resolve(root, 'icons/one.svg'), resolve(out, 'icons/one.svg'));
console.log(`Prepared ONE web bundle: ${pages.length} HTML pages copied to www/.`);
