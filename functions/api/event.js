// Cloudflare Pages Function: count one anonymous usage event in Workers Analytics Engine.
// The only Cloudflare coupling is the binding name `EVENTS`; the dataset is configured outside the repo.
import { MAX_EVENT_BYTES, validateEvent } from '../../site/lib/events.mjs';

const reply = (status, text = '') => new Response(text || null, {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
});

// Read at most `limit` bytes; null when the body is longer.
async function readCapped(request, limit) {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });

  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) return reply(403, 'forbidden');

  const declared = Number(request.headers.get('Content-Length'));
  if (declared > MAX_EVENT_BYTES) return reply(413, 'too large');
  const bytes = await readCapped(request, MAX_EVENT_BYTES);
  if (!bytes) return reply(413, 'too large');

  let body;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (err) {
    return reply(400, `bad JSON: ${err.message}`);
  }
  const problem = validateEvent(body);
  if (problem) return reply(400, problem);

  if (!env?.EVENTS) return reply(503, 'event storage not configured');

  try {
    env.EVENTS.writeDataPoint({
      blobs: [body.event, body.input ?? '', body.width ?? '', body.frames ?? ''],
      indexes: [body.event],
    });
  } catch (err) {
    console.error('event write failed', err);
    return reply(503, 'event storage error');
  }
  return new Response(null, { status: 204 });
}
