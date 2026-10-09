import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, formatLocalTime, localDay, zonedDateTime } from '../src/time.js';

const iso = (date) => date.toISOString();

test('formatLocalTime and localDay read the given time zone', () => {
  const date = new Date('2026-10-09T22:30:00Z');
  assert.equal(formatLocalTime(date, 'Europe/Paris'), '00:30');
  assert.equal(localDay(date, 'Europe/Paris'), '2026-10-10');
  assert.equal(localDay(date, 'UTC'), '2026-10-09');
  assert.equal(localDay(date, 'America/New_York'), '2026-10-09');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('zonedDateTime builds the instant of a local wall-clock time', () => {
  assert.equal(iso(zonedDateTime('2026-10-09', 9, 0, 'Europe/Paris')), '2026-10-09T07:00:00.000Z');
  assert.equal(iso(zonedDateTime('2026-12-09', 9, 30, 'Europe/Paris')), '2026-12-09T08:30:00.000Z');
  assert.equal(iso(zonedDateTime('2026-10-09', 0, 0, 'UTC')), '2026-10-09T00:00:00.000Z');
  assert.equal(
    iso(zonedDateTime('2026-10-09', 9, 0, 'America/New_York')),
    '2026-10-09T13:00:00.000Z',
  );
});

test('zonedDateTime handles the days of a DST change', () => {
  // Europe/Paris goes back from +02:00 to +01:00 on 2026-10-25 at 03:00.
  assert.equal(iso(zonedDateTime('2026-10-25', 9, 0, 'Europe/Paris')), '2026-10-25T08:00:00.000Z');
  assert.equal(iso(zonedDateTime('2026-10-25', 0, 0, 'Europe/Paris')), '2026-10-24T22:00:00.000Z');
  // And forward on 2026-03-29 at 02:00: 09:00 is already +02:00.
  assert.equal(iso(zonedDateTime('2026-03-29', 9, 0, 'Europe/Paris')), '2026-03-29T07:00:00.000Z');
});
