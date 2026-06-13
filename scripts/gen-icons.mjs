/**
 * Generates PNG icons from public/icons/icon.svg.
 * Run once: node scripts/gen-icons.mjs
 * Requires: npm install -D @resvg/resvg-js
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const svg = readFileSync(resolve(root, 'public/icons/icon.svg'), 'utf8');

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-512-maskable.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const { name, size } of sizes) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const png = resvg.render().asPng();
  writeFileSync(resolve(root, 'public/icons', name), png);
  console.log(`✓ ${name} (${size}×${size})`);
}
