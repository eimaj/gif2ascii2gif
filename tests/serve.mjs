#!/usr/bin/env node
// Zero-dependency static server for site/, applying site/_headers like Cloudflare Pages does.
// There is no Functions runtime here, so /api/event returns 404.
// Usage: node tests/serve.mjs [--port 4173]   (or PORT=4173)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const portFlag = process.argv.indexOf('--port');
const PORT = Number(portFlag > -1 ? process.argv[portFlag + 1] : process.env.PORT ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '': 'text/plain; charset=utf-8', // LICENSE files
};

// Parse Cloudflare Pages `_headers`: an unindented URL pattern, then indented `Name: value` lines.
export function parseHeaders(text) {
  const rules = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      const pattern = raw.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      rules.push({ match: new RegExp(`^${pattern}$`), headers: [] });
      continue;
    }
    const idx = raw.indexOf(':');
    if (idx === -1 || !rules.length) throw new Error(`bad _headers line: ${raw}`);
    rules.at(-1).headers.push([raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()]);
  }
  return rules;
}

const headersFile = join(SITE, '_headers');
const RULES = existsSync(headersFile) ? parseHeaders(readFileSync(headersFile, 'utf8')) : [];

async function resolveFile(urlPath) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const file = join(SITE, rel);
  if (file !== SITE && !file.startsWith(SITE + sep)) return null;
  const s = await stat(file).catch((err) => { if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null; throw err; });
  if (!s) return null;
  if (s.isDirectory()) return resolveFile(join(rel, 'index.html'));
  // Pages consumes these instead of serving them.
  if (['_headers', '_redirects'].includes(rel)) return null;
  return file;
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    for (const rule of RULES) if (rule.match.test(pathname)) for (const [k, v] of rule.headers) res.setHeader(k, v);
    const file = req.method === 'GET' || req.method === 'HEAD' ? await resolveFile(pathname) : null;
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found\n');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    console.error(`serve: ${req.method} ${req.url}: ${err.stack ?? err}`);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal error\n');
  }
});

server.listen(PORT, () => console.log(`serving ${SITE} at http://localhost:${PORT}`));
