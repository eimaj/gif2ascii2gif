import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tempDir, makeGif, probeGif } from '../helpers/fixtures.mjs';

const DEMO_URL = 'https://media.tenor.com/1iOUXZFLpBgAAAAM/dance-dancing.gif';

const dir = tempDir('gif2ascii-e2e-');
const small = makeGif(join(dir, 'small.gif'), { frames: 8, fps: 10 });
const square = makeGif(join(dir, 'square.gif'), { frames: 4, fps: 10, width: 40, height: 40 });
const tooMany = makeGif(join(dir, 'too-many.gif'), { frames: 301, fps: 10, width: 16, height: 16 });

const canvasWidth = (page) => page.locator('#preview').evaluate((c) => c.width);
const canvasHeight = (page) => page.locator('#preview').evaluate((c) => c.height);
const frameData = (page) => page.locator('#preview').evaluate((c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.join(','));

async function upload(page, file) {
  await page.goto('/');
  await page.setInputFiles('#file', file);
  await expect(page.locator('#message')).toContainText('Converted');
}

// Drop a file on the page the way a browser does: a `drop` event carrying a DataTransfer.
async function drop(page, file) {
  const dataTransfer = await page.evaluateHandle(({ b64, name }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type: 'image/gif' }));
    return dt;
  }, { b64: readFileSync(file).toString('base64'), name: basename(file) });
  await page.dispatchEvent('body', 'drop', { dataTransfer });
}

// Serve `file` for the demo URL after `delayMs`, with CORS allowed.
async function routeDemo(page, file, delayMs = 0) {
  await page.route(DEMO_URL, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({ status: 200, contentType: 'image/gif', headers: { 'Access-Control-Allow-Origin': '*' }, body: readFileSync(file) })
      .catch((err) => console.log(`demo route not fulfilled (request was aborted): ${err.message}`));
  });
}

test('uploading a GIF starts the preview playing', async ({ page }) => {
  await upload(page, small);
  expect(await canvasWidth(page)).toBeGreaterThan(0);
  const first = await frameData(page);
  await expect.poll(() => frameData(page), { timeout: 3000 }).not.toBe(first);
});

test('changing width resizes the canvas', async ({ page }) => {
  await upload(page, small);
  expect(await canvasWidth(page)).toBe((40 + 2) * 6);
  await page.locator('#width').fill('60');
  await expect.poll(() => canvasWidth(page)).toBe((60 + 2) * 6);
});

test('both downloads are named after the source and the GIF has every frame', async ({ page }) => {
  await upload(page, small);
  const [player] = await Promise.all([page.waitForEvent('download'), page.click('#download-player')]);
  expect(player.suggestedFilename()).toBe('small.mjs');

  const [gif] = await Promise.all([page.waitForEvent('download'), page.click('#download-gif')]);
  expect(gif.suggestedFilename()).toBe('small.gif');
  const saved = join(dir, 'export.gif');
  await gif.saveAs(saved);
  const info = probeGif(saved);
  expect(info.frames).toBe(8);
  const w = await canvasWidth(page);
  expect(info.width).toBe(w * 2);
});

test('a 301-frame GIF is blocked with the limit and the reason', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', tooMany);
  const message = page.locator('#message');
  await expect(message).toContainText('301 frames');
  await expect(message).toContainText('limit is 300');
  await expect(message).toContainText('responsive');
  expect(await canvasWidth(page)).toBe(0);
});

test('the demo is fetched by URL, read through the size-capped reader, and converted', async ({ page }) => {
  await page.goto('/');
  await routeDemo(page, square);
  await page.click('#demo');
  await expect(page.locator('#message')).toContainText('Converted dance-dancing.gif: 4 frames');
});

test('a newer load wins over a slower earlier one', async ({ page }) => {
  await page.goto('/');
  await routeDemo(page, square, 1500);
  await page.click('#demo');
  await expect(page.locator('#message')).toContainText('Loading dance-dancing.gif');
  await drop(page, small);
  await expect(page.locator('#message')).toContainText('Converted small.gif');
  const height = await canvasHeight(page);
  await page.waitForTimeout(2500);
  await expect(page.locator('#message')).toContainText('Converted small.gif');
  expect(await canvasHeight(page)).toBe(height);
  await expect(page.locator('#demo')).toBeEnabled();
});
