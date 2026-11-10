// Run a generated player the way a visitor does and check it restores the terminal on Ctrl-C.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { playerSource } from '../../site/lib/player.mjs';
import { tempDir } from '../helpers/fixtures.mjs';

const ENTER = '\x1b[?1049h\x1b[?25l';
const RESTORE = '\x1b[0m\x1b[?25h\x1b[?1049l';

test('player: draws frames in the alternate screen and restores the terminal on SIGINT', async () => {
  const file = join(tempDir(), 'player.mjs');
  writeFileSync(file, playerSource(['\x1b[38;2;255;0;0m@\x1b[0m', '\x1b[38;2;0;0;255m#\x1b[0m'], 50));
  const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
  child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
  setTimeout(() => child.kill('SIGINT'), 250);
  const [code, signal] = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (c, s) => resolve([c, s]));
  });
  assert.equal(stderr, '');
  assert.equal(signal, null);
  assert.equal(code, 0);
  assert.ok(stdout.startsWith(ENTER), `stdout starts with ${JSON.stringify(stdout.slice(0, 20))}`);
  assert.ok(stdout.includes('@') && stdout.includes('#'), 'both frames were drawn');
  assert.ok(stdout.endsWith(RESTORE), `stdout ends with ${JSON.stringify(stdout.slice(-20))}`);
});
