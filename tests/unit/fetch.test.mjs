import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGif, FetchBlockedError, FetchTimeoutError } from '../../site/lib/fetch.mjs';
import { LimitError, MAX_BYTES } from '../../site/lib/decode.mjs';

const URL_ = 'https://gifs.example/a.gif';

// A fetch that never answers, and rejects with the abort reason once its signal aborts, like a real one.
const hangingFetch = (url, { signal }) => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

// A response whose body sends nothing more and errors once the request's signal aborts.
const stallingBodyFetch = async (url, { signal }) => new Response(new ReadableStream({
  start(c) {
    c.enqueue(new Uint8Array([0x47]));
    signal.addEventListener('abort', () => c.error(signal.reason), { once: true });
  },
}));

test('fetchGif: no response within the time limit throws FetchTimeoutError', async () => {
  await assert.rejects(fetchGif(URL_, new AbortController().signal, { fetch: hangingFetch, timeoutMs: 20 }), FetchTimeoutError);
});

test('fetchGif: a body still arriving at the time limit throws FetchTimeoutError', async () => {
  await assert.rejects(fetchGif(URL_, new AbortController().signal, { fetch: stallingBodyFetch, timeoutMs: 20 }), FetchTimeoutError);
});

test('fetchGif: an abort by the caller is rethrown as it is, not reported as a block or a timeout', async () => {
  const controller = new AbortController();
  const reason = new Error('superseded');
  const pending = fetchGif(URL_, controller.signal, { fetch: hangingFetch, timeoutMs: 10_000 });
  controller.abort(reason);
  await assert.rejects(pending, (err) => err === reason);
});

test('fetchGif: a network or CORS failure throws FetchBlockedError', async () => {
  const cors = new TypeError('Failed to fetch');
  await assert.rejects(
    fetchGif(URL_, new AbortController().signal, { fetch: async () => { throw cors; } }),
    (err) => err instanceof FetchBlockedError && err.cause === cors,
  );
});

test('fetchGif: a body with no Content-Length is stopped once it passes the size limit', async () => {
  let sent = 0;
  const endless = async () => new Response(new ReadableStream({
    pull(c) { sent += 1 << 20; c.enqueue(new Uint8Array(1 << 20)); },
  }));
  await assert.rejects(fetchGif(URL_, new AbortController().signal, { fetch: endless }), (err) => {
    assert.ok(err instanceof LimitError);
    assert.equal(err.kind, 'download');
    assert.equal(err.limit, MAX_BYTES);
    return true;
  });
  assert.ok(sent <= MAX_BYTES + (2 << 20), `read ${sent} bytes`);
});

test('fetchGif: a declared Content-Length over the limit throws before reading the body', async () => {
  const big = async () => new Response('x', { headers: { 'content-length': String(MAX_BYTES + 1) } });
  await assert.rejects(fetchGif(URL_, new AbortController().signal, { fetch: big }), (err) => err instanceof LimitError && err.kind === 'bytes');
});

test('fetchGif: returns the body of a small response', async () => {
  const ok = async () => new Response(new Uint8Array([1, 2, 3]));
  assert.deepEqual([...new Uint8Array(await fetchGif(URL_, new AbortController().signal, { fetch: ok }))], [1, 2, 3]);
});
