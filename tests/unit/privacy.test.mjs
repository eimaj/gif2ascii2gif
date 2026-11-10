import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, FIELDS, privacyNoteText } from '../../site/lib/events.mjs';

test('privacy note lists every allowlisted event', () => {
  const text = privacyNoteText();
  for (const name of Object.keys(EVENTS)) assert.ok(text.includes(name), `missing event ${name}`);
});

test('privacy note lists every field and every allowed value', () => {
  const text = privacyNoteText();
  for (const [name, { values }] of Object.entries(FIELDS)) {
    assert.ok(text.includes(name), `missing field ${name}`);
    for (const v of values) assert.ok(text.includes(v), `missing ${name} value ${v}`);
  }
});

test('privacy note says the GIF never leaves the browser', () => {
  assert.match(privacyNoteText(), /never leaves your browser/);
});

test('privacy note scopes "nothing else" to the events and discloses Web Analytics', () => {
  const text = privacyNoteText();
  assert.match(text, /These events carry nothing else/);
  assert.doesNotMatch(text, /Nothing else is recorded/);
  assert.match(text, /Cloudflare Web Analytics/);
  assert.match(text, /browser, operating system, and country/);
});
