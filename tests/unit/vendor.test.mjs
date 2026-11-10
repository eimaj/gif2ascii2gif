import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDOR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site', 'vendor');
const FILES = [
  ['gifenc', 'gifenc.esm.js'],
  ['gifuct-js', 'gifuct.bundle.mjs'],
];

for (const [dir, file] of FILES) {
  test(`vendor: ${dir}/${file} matches the SHA-256 in SOURCE.md`, () => {
    const source = readFileSync(join(VENDOR, dir, 'SOURCE.md'), 'utf8');
    const recorded = source.match(new RegExp(`SHA-256 of \`${file.replace('.', '\\.')}\`: \`([0-9a-f]{64})\``));
    assert.ok(recorded, `no SHA-256 for ${file} in ${dir}/SOURCE.md`);
    const actual = createHash('sha256').update(readFileSync(join(VENDOR, dir, file))).digest('hex');
    assert.equal(actual, recorded[1]);
  });
}
