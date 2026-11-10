// The page's credits must name the same versions the vendored SOURCE.md files record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const html = readFileSync(join(SITE, 'index.html'), 'utf8');
const source = (dir) => readFileSync(join(SITE, 'vendor', dir, 'SOURCE.md'), 'utf8');

// [package, vendor dir, how SOURCE.md states its version]
const PACKAGES = [
  ['gifenc', 'gifenc', /^- Version: (\d+\.\d+\.\d+)$/m],
  ['gifuct-js', 'gifuct-js', /\bgifuct-js (\d+\.\d+\.\d+)/],
  ['js-binary-schema-parser', 'gifuct-js', /\bjs-binary-schema-parser (\d+\.\d+\.\d+)/],
];

for (const [name, dir, pattern] of PACKAGES) {
  test(`credits list ${name} at the version recorded in vendor/${dir}/SOURCE.md`, () => {
    const version = source(dir).match(pattern)?.[1];
    assert.ok(version, `no ${name} version in vendor/${dir}/SOURCE.md`);
    const credit = html.match(new RegExp(`>${name}</a> (\\d+\\.\\d+\\.\\d+)`))?.[1];
    assert.equal(credit, version);
  });
}
