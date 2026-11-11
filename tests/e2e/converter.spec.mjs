import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tempDir, makeGif, probeGif, firstFrameAlpha } from '../helpers/fixtures.mjs';
import { declaring } from '../helpers/gifs.mjs';
import { parsePlayer } from '../../site/lib/player.mjs';
import { EVENTS, FIELDS } from '../../site/lib/events.mjs';

const DEMO_URL = 'https://media.tenor.com/1iOUXZFLpBgAAAAM/dance-dancing.gif';

const dir = tempDir('gif2ascii-e2e-');
const small = makeGif(join(dir, 'small.gif'), { frames: 8, fps: 10 });
const square = makeGif(join(dir, 'square.gif'), { frames: 4, fps: 10, width: 40, height: 40 });
const long = makeGif(join(dir, 'long.gif'), { frames: 200, fps: 10 });
const demoSize = makeGif(join(dir, 'demo-size.gif'), { frames: 4, fps: 10, width: 220, height: 366 }); // the demo GIF's size
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
  expect([info.width, info.height]).toEqual([80, 60]); // the fixture's own size
  const alpha = firstFrameAlpha(saved); // default background is transparent
  expect(alpha).toContain(0);
  expect(alpha).toContain(255);
});

test('the GIF export has exactly the source GIF\'s dimensions at every width', async ({ page }) => {
  await upload(page, demoSize);
  for (const width of ['40', '160']) {
    await page.locator('#width').fill(width);
    await expect.poll(() => canvasWidth(page)).toBe((Number(width) + 2) * 6);
    const [gif] = await Promise.all([page.waitForEvent('download'), page.click('#download-gif')]);
    const saved = join(dir, `demo-size-${width}.gif`);
    await gif.saveAs(saved);
    const info = probeGif(saved);
    expect([info.width, info.height]).toEqual([220, 366]);
  }
});

test('the scale control is gone, and narrow characters are flagged near the export button', async ({ page }) => {
  await upload(page, demoSize);
  await expect(page.locator('#scale')).toHaveCount(0);
  await expect(page.getByText('Export scale')).toHaveCount(0);
  const note = page.locator('#export-note');
  await expect(note).toBeVisible(); // 40 columns × 6 = 240 px, wider than 220
  await expect(note).toContainText('smaller than 6 pixels');
  await page.locator('#width').fill('36'); // 216 px fits in 220
  await expect(note).toBeHidden();
  await page.locator('#width').fill('160');
  await expect(note).toBeVisible();
});

test('the downloaded player holds the current frames, width, and delay', async ({ page }) => {
  await upload(page, small);
  await page.locator('#width').fill('60');
  await expect.poll(() => canvasWidth(page)).toBe((60 + 2) * 6);
  const [player] = await Promise.all([page.waitForEvent('download'), page.click('#download-player')]);
  const saved = join(dir, 'player.mjs');
  await player.saveAs(saved);
  const { frames, delayMs } = parsePlayer(readFileSync(saved, 'utf8'));
  expect(frames.length).toBe(8);
  expect(delayMs).toBe(100); // the fixture is 10 fps
  for (const frame of frames) {
    const widths = new Set(frame.split('\n').map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').length));
    expect([...widths]).toEqual([60]);
  }
});

test('the CLI section is gone and a link points to the repo README', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Use it from the command line' })).toHaveCount(0);
  await expect(page.locator('button[data-copy], .command')).toHaveCount(0);
  const link = page.getByRole('link', { name: 'on GitHub' });
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', 'https://github.com/eimaj/gif2ascii2gif#readme');
});

test('the page is dark by default, light when the system prefers light', async ({ page }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' }); // Chromium reports 'no-preference' as light
  await page.goto('/');
  expect(await background()).toBe('rgb(13, 17, 16)'); // --bg #0d1110
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await background()).toBe('rgb(246, 247, 244)'); // --bg #f6f7f4
});

test('at phone width the page does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await upload(page, small);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

// Collect the body of every usage event the page sends.
async function captureEvents(page) {
  const bodies = [];
  await page.route('**/api/event', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  return bodies;
}

test('a 301-frame GIF is blocked with the limit and the reason, and counted', async ({ page }) => {
  const bodies = await captureEvents(page);
  await page.goto('/');
  await page.setInputFiles('#file', tooMany);
  const message = page.locator('#message');
  await expect(message).toContainText('301 frames');
  await expect(message).toContainText('limit is 300');
  await expect(message).toContainText('responsive');
  expect(await canvasWidth(page)).toBe(0);
  await expect.poll(() => bodies).toEqual([{ event: 'blocked_too_large', input: 'file', frames: '>300' }]);
});

test('a pixel-limit refusal is counted without a frames bucket', async ({ page }) => {
  const bodies = await captureEvents(page);
  await page.goto('/');
  await page.setInputFiles('#file', { name: 'huge.gif', mimeType: 'image/gif', buffer: Buffer.from(declaring({ screen: [60000, 60000] })) });
  await expect(page.locator('#message')).toContainText('60000×60000 pixels');
  await expect.poll(() => bodies).toEqual([{ event: 'blocked_too_large', input: 'file' }]);
});

test('a 1920×1080 GIF is refused with its size, the 1024 limit, and a resize hint', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', { name: 'hd.gif', mimeType: 'image/gif', buffer: Buffer.from(declaring({ screen: [1920, 1080] })) });
  const message = page.locator('#message');
  await expect(message).toContainText('1920×1080 pixels; the limit is 1024×1024');
  await expect(message).toContainText('Resize it');
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
  // The encode's progress messages share #message, so read the loaded GIF from #info instead.
  const state = () => page.evaluate(() => ({
    smallShown: document.querySelector('#info').textContent.startsWith('8 frames'),
    exportDisabled: document.querySelector('#download-gif').disabled,
  }));
  await expect.poll(state).toEqual({ smallShown: true, exportDisabled: true });
  const gif = await downloaded;
  expect(gif.suggestedFilename()).toBe('long.gif');
  await expect(page.locator('#download-gif')).toBeEnabled();
  await expect.poll(() => bodies.find((b) => b.event === 'export_gif')).toEqual({ event: 'export_gif', input: 'file', width: '<=40', frames: '<=300' });
});

test('background controls reach the export and the preview', async ({ page }) => {
  await upload(page, small);
  await expect(page.locator('#stage')).toHaveClass(/checker/);
  await page.locator('#transparent').uncheck();
  await page.locator('#bg-color').fill('#ff0000'); // not the default (#000000), so the chosen color must reach the preview
  const corner = () => page.locator('#preview').evaluate((c) => [...c.getContext('2d').getImageData(0, 0, 1, 1).data]);
  await expect.poll(corner).toEqual([255, 0, 0, 255]);
  await expect(page.locator('#stage')).not.toHaveClass(/checker/);

  const [gif] = await Promise.all([page.waitForEvent('download'), page.click('#download-gif')]);
  const saved = join(dir, 'solid.gif');
  await gif.saveAs(saved);
  expect(firstFrameAlpha(saved).every((a) => a === 255)).toBe(true);
});

test('the rendered privacy note discloses Web Analytics and links its policy', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Privacy' }).click();
  const note = page.locator('#privacy-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Cloudflare Web Analytics');
  await expect(note.locator('a[href="https://www.cloudflare.com/privacypolicy/"]')).toHaveText('Cloudflare privacy policy');
});

// ---- About tabs ----------------------------------------------------------------------------

const TABS = [['How it works', 'how-it-works'], ['Privacy', 'privacy'], ['Credits', 'credits']];

async function expectSelected(page, name) {
  for (const [label, id] of TABS) {
    const selected = label === name;
    await expect(page.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', String(selected));
    await expect(page.getByRole('tab', { name: label })).toHaveAttribute('tabindex', selected ? '0' : '-1');
    await (selected ? expect(page.locator(`#${id}`)).toBeVisible() : expect(page.locator(`#${id}`)).toBeHidden());
  }
}

test('the about tabs are in order, wired to their panels, and How it works is selected', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('tablist').getByRole('tab');
  await expect(tabs).toHaveText(TABS.map(([label]) => label));
  for (const [label, id] of TABS) {
    const tab = page.getByRole('tab', { name: label });
    await expect(tab).toHaveAttribute('aria-controls', id);
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-labelledby', await tab.getAttribute('id'));
    await expect(page.getByRole('tabpanel', { name: label, includeHidden: true })).toHaveAttribute('id', id);
  }
  await expectSelected(page, 'How it works');
  expect(new URL(page.url()).hash).toBe('');
});

test('clicking a tab shows only its panel and puts it in the URL without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 }); // short, so the page stays scrollable past the tabs
  await page.goto('/');
  for (const [label, id] of [...TABS].reverse()) {
    const tab = page.getByRole('tab', { name: label });
    await tab.scrollIntoViewIfNeeded(); // click() scrolls the tab into view itself; measure after that
    const before = await page.evaluate(() => window.scrollY);
    await tab.click();
    await expectSelected(page, label);
    expect(new URL(page.url()).hash).toBe(`#${id}`);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  }
});

test('arrow, Home and End keys move focus between tabs, and Enter selects', async ({ page }) => {
  await page.goto('/');
  const tab = (label) => page.getByRole('tab', { name: label });
  await tab('How it works').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab('Privacy')).toBeFocused();
  await expectSelected(page, 'How it works'); // manual activation: focus alone does not select
  await page.keyboard.press('Enter');
  await expectSelected(page, 'Privacy');
  await page.keyboard.press('ArrowRight');
  await expect(tab('Credits')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tab('How it works')).toBeFocused(); // wraps
  await page.keyboard.press('ArrowLeft');
  await expect(tab('Credits')).toBeFocused(); // wraps back
  await page.keyboard.press('Home');
  await expect(tab('How it works')).toBeFocused();
  await page.keyboard.press('End');
  await expect(tab('Credits')).toBeFocused();
  await page.keyboard.press(' ');
  await expectSelected(page, 'Credits');
});

test('a hash deep link opens its tab on load and on hash change', async ({ page }) => {
  await page.goto('/#credits');
  await expectSelected(page, 'Credits');
  await page.evaluate(() => { location.hash = '#privacy'; });
  await expectSelected(page, 'Privacy');
  await page.evaluate(() => { location.hash = '#converter'; }); // not a tab: the selection stays
  await expectSelected(page, 'Privacy');
});

test('the Privacy tab lists every usage event and field', async ({ page }) => {
  await page.goto('/#privacy');
  const note = page.locator('#privacy-note');
  await expect(note).toBeVisible();
  for (const name of [...Object.keys(EVENTS), ...Object.keys(FIELDS)]) await expect(note).toContainText(name);
});

test('without JavaScript every about panel is readable and the tab list is hidden', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('tablist', { includeHidden: true })).toBeHidden();
  for (const heading of ['How it works', 'Privacy', 'Credits and licenses']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await expect(page.locator('#credits a[href="vendor/gifenc/LICENSE"]')).toBeVisible();
  await context.close();
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

test('the demo is fetched by URL directly and converted, and its URL is never proxied or counted', async ({ page }) => {
  const bodies = await captureEvents(page);
  const carriers = [];
  page.on('request', (req) => {
    const direct = req.method() === 'GET' && req.url() === DEMO_URL;
    const mentions = req.url().includes('tenor') || (req.postData() ?? '').includes('tenor');
    if (mentions && !direct) carriers.push(`${req.method()} ${req.url()}`);
  });
  await page.goto('/');
  await routeDemo(page, square);
  await page.click('#demo');
  await expect(page.locator('#message')).toContainText('Converted dance-dancing.gif: 4 frames');
  await expect.poll(() => bodies).toEqual([{ event: 'convert', input: 'demo', width: '<=40', frames: '<25' }]);
  expect(carriers).toEqual([]);
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
