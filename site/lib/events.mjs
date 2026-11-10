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

// The privacy note as a heading-free list of blocks: { p } paragraphs and { ul } lists of strings.
export function privacyNote() {
  return [
    { p: 'Your GIF never leaves your browser. Decoding, conversion, and both downloads happen on your device; the site never uploads, proxies, or stores the GIF or its URL.' },
    { p: 'To see whether the site is used, it counts these anonymous events:' },
    { ul: Object.entries(EVENTS).map(([name, about]) => `${name}: ${about}`) },
    { p: 'Each event can carry only these coarse fields:' },
    { ul: Object.entries(FIELDS).map(([name, f]) => `${name} (${f.about}): ${f.values.join(', ')}`) },
    { p: 'Nothing else is recorded: no IP address, user agent, cookie, file name, GIF URL, or any identifier that links events to you or to each other.' },
  ];
}

export function privacyNoteText() {
  return privacyNote().map((b) => b.p ?? b.ul.join('\n')).join('\n');
}
