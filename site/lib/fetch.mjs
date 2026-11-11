// Fetching a GIF by URL in the browser: time limit, size cap, and error classification.
// Standard JS only, so it also runs under Node for tests.
import { checkFileSize, readCapped } from './decode.mjs';

export const FETCH_TIMEOUT_MS = 30_000;

// The fetch failed before any response: the host blocks cross-origin reads, or the network failed.
export class FetchBlockedError extends Error {
  constructor(options) {
    super('fetch blocked', options);
    this.name = 'FetchBlockedError';
  }
}

// The server did not finish sending the GIF in time.
export class FetchTimeoutError extends Error {
  constructor(options) {
    super('fetch timed out', options);
    this.name = 'FetchTimeoutError';
  }
}

// Fetch a GIF by URL, giving up after `timeoutMs` and reading at most MAX_BYTES of the body,
// whatever Content-Length says. An abort through `signal` is rethrown as it is.
export async function fetchGif(url, signal, { fetch = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  // One controller for both the caller's abort and the time limit, so browsers without
  // AbortSignal.any (Safari before 17.4, Chrome before 116, Firefox before 124) work too.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  const failed = (err) => {
    if (signal.aborted) return err;
    if (timedOut) return new FetchTimeoutError({ cause: err });
    return null;
  };
  try {
    let res;
    try {
      res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
    } catch (err) {
      throw failed(err) ?? new FetchBlockedError({ cause: err });
    }
    if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText} for that URL.`);
    const length = Number(res.headers.get('content-length'));
    if (length) checkFileSize(length);
    try {
      return await readCapped(res.body);
    } catch (err) {
      throw failed(err) ?? err;
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
