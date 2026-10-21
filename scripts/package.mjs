import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'extension');
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
if (manifest.host_permissions || manifest.externally_connectable) throw new Error('Unexpected externally accessible permissions');

async function entries(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await entries(full));
    else files.push({ name: `screen-mark/${path.relative(extension, full).replaceAll('\\', '/')}`, data: await readFile(full), full });
  }
  return files;
}

const files = await entries(extension);
files.push({ name: 'screen-mark/LICENSE', data: await readFile(path.join(root, 'LICENSE')), full: path.join(root, 'LICENSE') });
for (const file of files) if (file.full.endsWith('.js')) execFileSync(process.execPath, ['--check', file.full], { stdio: 'pipe' });
for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons)]) {
  if (!files.some(entry => entry.name === `screen-mark/${file}`)) throw new Error(`Missing manifest file: ${file}`);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const chunks = []; const central = []; let offset = 0;
for (const file of files) {
  const name = Buffer.from(file.name); const crc = crc32(file.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(file.data.length, 18); local.writeUInt32LE(file.data.length, 22); local.writeUInt16LE(name.length, 26);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8);
  entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(file.data.length, 20); entry.writeUInt32LE(file.data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
  chunks.push(local, name, file.data); central.push(entry, name); offset += local.length + name.length + file.data.length;
}
const directory = Buffer.concat(central); const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...chunks, directory, end]);
const destination = path.join(root, 'dist', `screen-mark-${manifest.version}.zip`);
await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, zip);
console.log(JSON.stringify({ destination, files: files.length, bytes: zip.length, sha256: createHash('sha256').update(zip).digest('hex') }, null, 2));
