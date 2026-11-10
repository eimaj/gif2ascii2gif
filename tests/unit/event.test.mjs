import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../../functions/api/event.js';
import { widthBucket, framesBucket, validateEvent } from '../../site/lib/events.mjs';

const URL_ = 'https://gif.example/api/event';
const ORIGIN = 'https://gif.example';

function fakeEnv() {
  const points = [];
  return { points, env: { EVENTS: { writeDataPoint: (p) => points.push(p) } } };
}

function post(body, { origin = ORIGIN, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (origin) h.Origin = origin;
  return new Request(URL_, { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

async function call(request, env = fakeEnv().env) {
  return (await onRequest({ request, env })).status;
}

test('405 for non-POST', async () => {
  assert.equal(await call(new Request(URL_, { method: 'GET', headers: { Origin: ORIGIN } })), 405);
});

test('403 for a cross-site origin', async () => {
  const { env, points } = fakeEnv();
  assert.equal(await call(post({ event: 'convert' }, { origin: 'https://evil.example' }), env), 403);
  assert.equal(points.length, 0);
});

test('403 for a missing origin', async () => {
  assert.equal(await call(post({ event: 'convert' }, { origin: null })), 403);
});

test('413 for a 4 KB body', async () => {
  const { env, points } = fakeEnv();
  assert.equal(await call(post({ event: 'convert', pad: 'x'.repeat(4096) }), env), 413);
  assert.equal(points.length, 0);
});

test('413 when the body is longer than its declared length allows', async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x'.repeat(600))); c.close(); } });
  const request = new Request(URL_, { method: 'POST', headers: { Origin: ORIGIN }, body: stream, duplex: 'half' });
  assert.equal(await call(request), 413);
});

test('413 from a declared Content-Length over the limit, before reading the body', async () => {
  const { env, points } = fakeEnv();
  const request = post({ event: 'convert' }, { headers: { 'Content-Length': '513' } });
  assert.equal(request.headers.get('Content-Length'), '513');
  assert.equal(await call(request, env), 413);
  assert.equal(points.length, 0);
});

test('204 when a correct Content-Length is declared, as real beacons do', async () => {
  const { env, points } = fakeEnv();
  const body = JSON.stringify({ event: 'convert' });
  const request = post(body, { headers: { 'Content-Length': String(body.length) } });
  assert.equal(await call(request, env), 204);
  assert.equal(points.length, 1);
});

test('400 for a body that is not valid UTF-8', async () => {
  const { env, points } = fakeEnv();
  const request = new Request(URL_, { method: 'POST', headers: { Origin: ORIGIN }, body: new Uint8Array([0xff, 0xfe]) });
  assert.equal(await call(request, env), 400);
  assert.equal(points.length, 0);
});

test('400 for bad JSON', async () => {
  assert.equal(await call(post('{nope')), 400);
});

test('400 for an unknown event', async () => {
  const { env, points } = fakeEnv();
  assert.equal(await call(post({ event: 'pageview' }), env), 400);
  assert.equal(points.length, 0);
});

test('400 for a non-string event name, with nothing recorded', async () => {
  for (const event of [['convert'], [['export_gif']], 1, null, { convert: 1 }]) {
    const { env, points } = fakeEnv();
    assert.equal(await call(post({ event }), env), 400, JSON.stringify(event));
    assert.equal(points.length, 0);
  }
});

test('400 for a non-string field value', async () => {
  for (const input of [['file'], { file: 1 }, 1, null]) {
    assert.equal(await call(post({ event: 'convert', input })), 400, JSON.stringify(input));
  }
});

test('400 for a value outside its enum', async () => {
  assert.equal(await call(post({ event: 'convert', input: 'clipboard' })), 400);
  assert.equal(await call(post({ event: 'convert', width: '40' })), 400);
});

test('400 for an extra field', async () => {
  const { env, points } = fakeEnv();
  assert.equal(await call(post({ event: 'convert', url: 'https://x/y.gif' }), env), 400);
  assert.equal(points.length, 0);
});

test('400 for a non-object body', async () => {
  assert.equal(await call(post('["convert"]')), 400);
});

test('503 when the EVENTS binding is missing', async () => {
  assert.equal(await call(post({ event: 'convert' }), {}), 503);
});

test('503 with a logged error when the binding cannot write', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const env = { EVENTS: { writeDataPoint: () => { throw new TypeError('not an Analytics Engine binding'); } } };
  const res = await onRequest({ request: post({ event: 'convert' }), env });
  assert.equal(res.status, 503);
  assert.equal(await res.text(), 'event storage error');
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0].arguments[1]), /not an Analytics Engine binding/);
});

test('204 records only the event and its enumerated fields', async () => {
  const { env, points } = fakeEnv();
  const status = await call(post({ event: 'convert', input: 'file', width: '<=40', frames: '<25' }, {
    headers: { 'User-Agent': 'secret-agent', Cookie: 'id=123', 'CF-Connecting-IP': '203.0.113.9' },
  }), env);
  assert.equal(status, 204);
  assert.deepEqual(points, [{ blobs: ['convert', 'file', '<=40', '<25'], indexes: ['convert'] }]);
});

test('204 with optional fields omitted', async () => {
  const { env, points } = fakeEnv();
  assert.equal(await call(post({ event: 'blocked_too_large', input: 'url' }), env), 204);
  assert.deepEqual(points[0].blobs, ['blocked_too_large', 'url', '', '']);
});

test('buckets', () => {
  assert.deepEqual([8, 40, 41, 80, 120, 160].map(widthBucket), ['<=40', '<=40', '<=80', '<=80', '<=120', '<=160']);
  assert.deepEqual([1, 24, 25, 99, 300, 301].map(framesBucket), ['<25', '<25', '<50', '<100', '<=300', '>300']);
  assert.equal(validateEvent({ event: 'export_gif', width: widthBucket(60), frames: framesBucket(10) }), null);
});
