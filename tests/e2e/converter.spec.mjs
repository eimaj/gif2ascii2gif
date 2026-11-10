import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { tempDir, makeGif, probeGif } from '../helpers/fixtures.mjs';

const dir = tempDir('gif2ascii-e2e-');
const small = makeGif(join(dir, 'small.gif'), { frames: 8, fps: 10 });
const tooMany = makeGif(join(dir, 'too-many.gif'), { frames: 301, fps: 10, width: 16, height: 16 });

const canvasWidth = (page) => page.locator('#preview').evaluate((c) => c.width);
const frameData = (page) => page.locator('#preview').evaluate((c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.join(','));

async function upload(page, file) {
  await page.goto('/');
  await page.setInputFiles('#file', file);
  await expect(page.locator('#message')).toContainText('Converted');
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
