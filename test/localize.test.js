import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueText, listLabel, priorityLabel, resolveLanguage, sceneDue } from '../src/localize.js';
import { task } from './fixtures/ticktick.js';

const TZ = 'Europe/Paris';
const NOW = new Date('2026-10-09T08:00:00Z');

test('resolveLanguage falls back to English', () => {
  assert.equal(resolveLanguage('fr'), 'fr');
  assert.equal(resolveLanguage('de'), 'en');
  assert.equal(resolveLanguage(undefined), 'en');
});

test('listLabel names the inbox in the viewer language, "Inbox" for scenes', () => {
  assert.equal(listLabel(task()), 'Groceries');
  assert.equal(listLabel(task({ listName: null }), 'fr'), 'Boîte de réception');
  assert.equal(listLabel(task({ listName: null }), 'en'), 'Inbox');
  assert.equal(listLabel(task({ listName: null })), 'Inbox');
});

test('priorityLabel only labels real priorities', () => {
  assert.equal(priorityLabel(5, 'fr'), 'Haute');
  assert.equal(priorityLabel(1, 'en'), 'Low');
  assert.equal(priorityLabel(0, 'en'), null);
  assert.equal(priorityLabel(2, 'en'), null);
});

test('dueText says today, tomorrow or the date, with the local time', () => {
  const today = task({ due: new Date('2026-10-09T12:00:00Z'), dueDay: '2026-10-09' });
  assert.equal(dueText(today, 'en', NOW, false, TZ), 'Today 14:00');
  assert.equal(dueText(today, 'fr', NOW, false, TZ), "Aujourd'hui 14:00");

  const tomorrow = task({ allDay: true, dueDay: '2026-10-10' });
  assert.equal(dueText(tomorrow, 'fr', NOW, false, TZ), 'Demain');

  const late = task({ allDay: true, dueDay: '2026-10-07' });
  assert.equal(dueText(late, 'en', NOW, true, TZ), 'Late · Wed, Oct 7');
  assert.equal(dueText(late, 'fr', NOW, true, TZ), 'En retard · mer. 7 oct.');

  const nextWeek = task({ due: new Date('2026-10-14T16:30:00Z'), dueDay: '2026-10-14' });
  assert.equal(dueText(nextWeek, 'en', NOW, false, TZ), 'Wed, Oct 14 18:30');
});

test('sceneDue is language-neutral', () => {
  assert.deepEqual(sceneDue(task(), TZ), { due_date: '2026-10-09', due_time: '14:00' });
  assert.deepEqual(sceneDue(task({ allDay: true }), TZ), { due_date: '2026-10-09', due_time: '' });
  assert.deepEqual(sceneDue(task({ due: null, dueDay: null }), TZ), { due_date: '', due_time: '' });
});
