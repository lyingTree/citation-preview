import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';

const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const files = ['main.js', 'manifest.json', 'styles.css'];
const zip = new JSZip();
const archiveDate = new Date('2026-01-01T00:00:00Z');
zip.file(`${manifest.id}/`, null, { dir: true, date: archiveDate });
const folder = zip.folder(manifest.id);
// Fixed timestamps make independently produced installation archives reproducible.
for (const filename of files) {
  folder.file(filename, await readFile(join(root, filename)), { date: archiveDate });
}
const output = join(root, 'dist');
await mkdir(output, { recursive: true });
const path = join(output, `${packageJson.name}-${manifest.version}.zip`);
await writeFile(path, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(path);
