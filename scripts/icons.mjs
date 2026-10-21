import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const directory = new URL('../extension/icons/', import.meta.url);
await mkdir(directory, { recursive: true });
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect x="3" y="3" width="122" height="122" rx="28" fill="#245b46"/><rect x="25" y="39" width="68" height="55" rx="5" fill="none" stroke="#f7f5ee" stroke-width="7"/><circle cx="94" cy="34" r="25" fill="#e44d35" stroke="#245b46" stroke-width="5"/><path d="M89 27l7-5v25m-7 0h15" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="5"/></svg>');
for (const size of [16, 48, 128]) await sharp(svg).resize(size, size).png().toFile(fileURLToPath(new URL(`${size}.png`, directory)));
console.log('Icons created: 16, 48, 128px');
