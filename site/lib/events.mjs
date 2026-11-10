// Anonymous usage events: the one schema used by the page, the /api/event function, and the privacy note.

export const EVENTS = {
  convert: 'a GIF was converted',
  export_gif: 'the GIF was downloaded',
  export_player: 'the terminal player was downloaded',
  blocked_too_large: 'a GIF was refused for being over a size limit',
};

export const FIELDS = {
  input: { values: ['file', 'drop', 'url', 'demo'], about: 'how the GIF was loaded' },
  width: { values: ['<=40', '<=80', '<=120', '<=160'], about: 'the width setting, rounded up to a bucket' },
  frames: { values: ['<25', '<50', '<100', '<=300', '>300'], about: 'the number of frames, as a bucket' },
};

export const MAX_EVENT_BYTES = 512;

export function widthBucket(width) {
  if (width <= 40) return '<=40';
  if (width <= 80) return '<=80';
  if (width <= 120) return '<=120';
  return '<=160';
}

export function framesBucket(frames) {
  if (frames < 25) return '<25';
  if (frames < 50) return '<50';
  if (frames < 100) return '<100';
  if (frames <= 300) return '<=300';
  return '>300';
}

// Returns null when `body` is a valid event, else a short reason.
export function validateEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be a JSON object';
  // hasOwn stringifies its key, so ["convert"] would match without the type check.
  if (typeof body.event !== 'string' || !Object.hasOwn(EVENTS, body.event)) return 'unknown event';
  for (const [key, value] of Object.entries(body)) {
    if (key === 'event') continue;
    if (!Object.hasOwn(FIELDS, key)) return `unknown field ${key}`;
    if (typeof value !== 'string' || !FIELDS[key].values.includes(value)) return `bad value for ${key}`;
  }
  return null;
}

// The privacy note as a heading-free list of blocks: { p } paragraphs (with an optional trailing
// { link: { text, href } }) and { ul } lists of strings.
export function privacyNote() {
  return [
    { p: 'Your GIF never leaves your browser. Decoding, conversion, and both downloads happen on your device; the site never uploads, proxies, or stores the GIF or its URL.' },
    { p: 'To see whether the site is used, it counts these anonymous events:' },
    { ul: Object.entries(EVENTS).map(([name, about]) => `${name}: ${about}`) },
    { p: 'Each event can carry only these coarse fields:' },
    { ul: Object.entries(FIELDS).map(([name, f]) => `${name} (${f.about}): ${f.values.join(', ')}`) },
    { p: 'These events carry nothing else: no IP address, user agent, cookie, file name, GIF URL, or any identifier that links events to you or to each other.' },
    {
      p: 'Separately, page views are counted by Cloudflare Web Analytics, which sets no cookies; Cloudflare derives your browser, operating system, and country from the page request.',
      link: { text: 'Cloudflare privacy policy', href: 'https://www.cloudflare.com/privacypolicy/' },
    },
  ];
}
