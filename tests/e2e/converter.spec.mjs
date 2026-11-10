import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tempDir, makeGif, probeGif } from '../helpers/fixtures.mjs';

const DEMO_URL = 'https://media.tenor.com/1iOUXZFLpBgAAAAM/dance-dancing.gif';

const dir = tempDir('gif2ascii-e2e-');
const small = makeGif(join(dir, 'small.gif'), { frames: 8, fps: 10 });
const square = makeGif(join(dir, 'square.gif'), { frames: 4, fps: 10, width: 40, height: 40 });
const long = makeGif(join(dir, 'long.gif'), { frames: 200, fps: 10 });
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

test('uploading a GIF starts the preview playing, and the GIF never leaves the browser', async ({ page }) => {
  const gifBytes = readFileSync(small);
  const marker = gifBytes.subarray(gifBytes.length - 64); // a run of the fixture's image data
  const uploads = [];
  page.on('request', (req) => {
    const body = req.postDataBuffer();
    if (body && (body.length > 512 || body.includes(marker))) uploads.push(`${req.method()} ${req.url()} (${body.length} bytes)`);
  });
  await upload(page, small);
  expect(await canvasWidth(page)).toBeGreaterThan(0);
  const first = await frameData(page);
  await expect.poll(() => frameData(page), { timeout: 3000 }).not.toBe(first);
  await Promise.all([page.waitForEvent('download'), page.click('#download-player')]);
  await Promise.all([page.waitForEvent('download'), page.click('#download-gif')]);
  expect(uploads).toEqual([]);
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

test('a conversion error after a control change is shown and keeps the previous result', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await upload(page, small);
  const width = await canvasWidth(page);
  await page.waitForTimeout(1500); // let all 8 frames (100 ms each) render once, so the preview plays from its cache
  await page.evaluate(() => {
    window.ImageData = class { constructor() { throw new RangeError('test: no memory for ImageData'); } };
  });
  await page.locator('#width').fill('60');
  const message = page.locator('#message');
  await expect(message).toHaveClass(/error/);
  await expect(message).toContainText('test: no memory for ImageData');
  await expect(message).toContainText('previous result is still shown');
  expect(await canvasWidth(page)).toBe(width);
  const first = await frameData(page);
  await expect.poll(() => frameData(page), { timeout: 3000 }).not.toBe(first);
  expect(pageErrors).toEqual([]);
});

test('usage events carry exactly the expected bodies', async ({ page }) => {
  const bodies = [];
  await page.route('**/api/event', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await upload(page, small);
  await Promise.all([page.waitForEvent('download'), page.click('#download-player')]);
  await Promise.all([page.waitForEvent('download'), page.click('#download-gif')]);
  const fields = { input: 'file', width: '<=40', frames: '<25' };
  await expect.poll(() => bodies.length).toBe(3);
  expect(bodies).toEqual([
    { event: 'convert', ...fields },
    { event: 'export_player', ...fields },
    { event: 'export_gif', ...fields },
  ]);
});

test('events fall back to fetch, and a failed event never reaches the visitor', async ({ page }) => {
  await page.addInitScript(() => { navigator.sendBeacon = () => false; });
  const attempts = [];
  await page.route('**/api/event', async (route) => {
    attempts.push(route.request().postDataJSON().event);
    await route.abort();
  });
  await upload(page, small);
  await Promise.all([page.waitForEvent('download'), page.click('#download-player')]);
  await Promise.all([page.waitForEvent('download'), page.click('#download-gif')]);
  await expect.poll(() => attempts).toEqual(['convert', 'export_player', 'export_gif']);
  await expect(page.locator('#message')).not.toHaveClass(/error/);
  await expect(page.locator('#message')).toContainText('Saved small.gif');
});

test('loading another GIF during an encode keeps that export and its event intact', async ({ page }) => {
  const bodies = [];
  await page.route('**/api/event', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await upload(page, long);
  const downloaded = page.waitForEvent('download');
  await page.click('#download-gif');
  await expect(page.locator('#message')).toContainText('Encoding GIF');
  await drop(page, small);
  await expect(page.locator('#message')).toContainText('Converted small.gif');
  await expect(page.locator('#download-gif')).toBeDisabled();
  const gif = await downloaded;
  expect(gif.suggestedFilename()).toBe('long.gif');
  await expect(page.locator('#download-gif')).toBeEnabled();
  await expect.poll(() => bodies.find((b) => b.event === 'export_gif')).toEqual({ event: 'export_gif', input: 'file', width: '<=40', frames: '<=300' });
});

test('scale and background controls reach the export and the preview', async ({ page }) => {
  await upload(page, small);
  await page.locator('#scale').fill('4');
  const [gif] = await Promise.all([page.waitForEvent('download'), page.click('#download-gif')]);
  const saved = join(dir, 'scaled.gif');
  await gif.saveAs(saved);
  expect(probeGif(saved).width).toBe((await canvasWidth(page)) * 4);

  await expect(page.locator('#stage')).toHaveClass(/checker/);
  await page.locator('#transparent').uncheck();
  await page.locator('#bg-color').fill('#000000');
  const corner = () => page.locator('#preview').evaluate((c) => [...c.getContext('2d').getImageData(0, 0, 1, 1).data]);
  await expect.poll(corner).toEqual([0, 0, 0, 255]);
  await expect(page.locator('#stage')).not.toHaveClass(/checker/);
});

test('every credited license link serves the license text', async ({ page, request }) => {
  await page.goto('/');
  const hrefs = await page.locator('#credits a[href^="vendor/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs.length).toBe(3);
  for (const href of hrefs) {
    const res = await request.get(`/${href}`);
    expect(res.status(), href).toBe(200);
    expect(await res.text(), href).toContain('Permission is hereby granted');
  }
});

test('download names drop shell metacharacters', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', { name: '-x$(touch p).gif', mimeType: 'image/gif', buffer: readFileSync(small) });
  await expect(page.locator('#message')).toContainText('Converted x-touch-p.gif');
  const [player] = await Promise.all([page.waitForEvent('download'), page.click('#download-player')]);
  expect(player.suggestedFilename()).toBe('x-touch-p.mjs');
  await expect(page.locator('#message')).toContainText('Run it with: node x-touch-p.mjs');
});

test('a file that is not a GIF keeps the previous result', async ({ page }) => {
  await upload(page, small);
  const width = await canvasWidth(page);
  await page.setInputFiles('#file', { name: 'bad.gif', mimeType: 'image/gif', buffer: Buffer.from('<html>') });
  const message = page.locator('#message');
  await expect(message).toHaveClass(/error/);
  await expect(message).toContainText('not a readable GIF');
  await expect(message).toContainText('previous result');
  expect(await canvasWidth(page)).toBe(width);
  await expect(page.locator('#download-gif')).toBeEnabled();
});

test('a URL whose host blocks cross-origin reads explains the block', async ({ page }) => {
  await page.goto('/');
  await page.route(DEMO_URL, (route) => route.abort());
  await page.click('#demo');
  const message = page.locator('#message');
  await expect(message).toHaveClass(/error/);
  await expect(message).toContainText('blocks downloads');
  await expect(message).toContainText('upload it instead');
});

test('dropping a GIF on the page converts it', async ({ page }) => {
  await page.goto('/');
  await drop(page, small);
  await expect(page.locator('#message')).toContainText('Converted small.gif');
  expect(await canvasWidth(page)).toBeGreaterThan(0);
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
