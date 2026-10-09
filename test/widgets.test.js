import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildTasksContent, taskUrl } from '../src/widgets.js';
import { task } from './fixtures/ticktick.js';

const TZ = 'Europe/Paris';
const NOW = new Date('2026-10-09T08:00:00Z');
const ERROR = { en: 'TickTick cannot be reached.', fr: 'TickTick est injoignable.' };

const build = (snapshot, options = {}) =>
  buildTasksContent(snapshot, { now: NOW, timeZone: TZ, language: 'en', ...options });

const typesOf = (content) => content.components.map((component) => component.type);

test('without a snapshot the widget asks to connect, or shows the error', () => {
  const notConnected = build(null, { language: 'fr' });
  assert.deepEqual(validateWidgetContent(notConnected), []);
  assert.match(notConnected.components[0].text, /Connectez/);

  const failing = build(null, { error: ERROR });
  assert.equal(failing.components[0].text, ERROR.en);
});

test('the widget shows the counters and one row per task of the scope', () => {
  const snapshot = {
    tasks: [
      task({ id: 'late', title: 'Pay the bill', allDay: true, dueDay: '2026-10-08', priority: 5 }),
      task({ id: 'today', title: 'Buy milk', content: 'Semi-skimmed' }),
      task({ id: 'inbox', title: '', listName: null, allDay: true, priority: 3 }),
      task({ id: 'future', dueDay: '2026-10-20', due: new Date('2026-10-20T08:00:00Z') }),
    ],
  };
  const content = build(snapshot, { language: 'fr' });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(typesOf(content), ['value', 'value', 'card-list']);
  assert.deepEqual(
    content.components.slice(0, 2).map((tile) => [tile.label, tile.value, tile.color]),
    [
      ['En retard', 1, 'danger'],
      ["Aujourd'hui", 2, 'primary'],
    ],
  );
  const [late, inbox, today] = content.components[2].items;
  assert.equal(late.title, 'Pay the bill');
  assert.equal(late.subtitle, 'Groceries · En retard · jeu. 8 oct.');
  assert.deepEqual(late.badge, { text: 'Haute', color: 'danger' });
  assert.equal(late.description, undefined);
  assert.equal(inbox.title, '(sans titre)');
  assert.equal(inbox.subtitle, "Boîte de réception · Aujourd'hui");
  assert.equal(inbox.badge.color, 'warning');
  assert.equal(today.subtitle, "Groceries · Aujourd'hui 14:00");
  assert.equal(today.badge, undefined);
  assert.equal(today.description, 'Semi-skimmed');
  assert.deepEqual(today.links, [
    {
      url: 'https://ticktick.com/webapp/#p/p-groceries/tasks/today',
      label: 'Ouvrir dans TickTick',
    },
  ]);
});

test('an empty scope shows a caption and green counters', () => {
  const content = build({ tasks: [] }, { settings: { scope: 'overdue' } });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(typesOf(content), ['value', 'value', 'text']);
  assert.equal(content.components[0].color, 'success');
  assert.equal(content.components[2].text, 'No overdue task. Well done!');
});

test('the rows stop at 8, with a caption for the rest, and texts are clipped', () => {
  const tasks = Array.from({ length: 11 }, (_, index) =>
    task({ id: `t${index}`, title: `${'x'.repeat(80)}${index}`, content: 'y'.repeat(3000) }),
  );
  const content = build({ tasks });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[2].items.length, 8);
  assert.equal(content.components[2].items[0].title.length, 60);
  assert.equal(content.components[2].items[0].description.length, 2000);
  assert.equal(content.components[3].text, '+3 more tasks in TickTick');
  assert.equal(build({ tasks: tasks.slice(0, 9) }).components[3].text, '+1 more task in TickTick');
});

test('a failed poll keeps the last tasks and adds the error', () => {
  const content = build({ tasks: [task()] }, { error: ERROR, settings: { scope: 'week' } });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(typesOf(content), ['value', 'value', 'card-list', 'text']);
  assert.equal(content.components[3].text, ERROR.en);
});

test('taskUrl escapes the ids', () => {
  assert.equal(
    taskUrl({ projectId: 'a b', id: 'c/d' }),
    'https://ticktick.com/webapp/#p/a%20b/tasks/c%2Fd',
  );
});
