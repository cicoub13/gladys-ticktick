import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ADD_TASK_ACTION, buildTasksContent, taskUrl } from '../src/widgets.js';
import { DUE_OPTIONS, PRIORITY_OPTIONS } from '../src/scene-actions.js';
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
  // No lists known yet: no Add task button.
  assert.deepEqual(typesOf(notConnected), ['text']);
  assert.deepEqual(typesOf(failing), ['text']);
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
  assert.deepEqual(typesOf(content), ['value', 'value', 'card-list', 'button']);
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
  assert.deepEqual(typesOf(content), ['value', 'value', 'text', 'button']);
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
  assert.deepEqual(typesOf(content), ['value', 'value', 'card-list', 'text', 'button']);
  assert.equal(content.components[3].text, ERROR.en);
});

test('the Add task button opens a valid form: title, due, priority, and the lists by id', () => {
  const snapshot = {
    projects: [
      { id: 'p-groceries', name: 'Groceries' },
      { id: 'p-long', name: 'L'.repeat(70) },
      { id: 'p-blank', name: '' },
    ],
    tasks: [],
  };
  const content = build(snapshot, { language: 'fr' });
  assert.deepEqual(validateWidgetContent(content), []);
  const button = content.components.at(-1);
  assert.equal(button.label, 'Ajouter une tâche');
  assert.equal(button.action.key, ADD_TASK_ACTION);
  const fields = Object.fromEntries(button.action.fields.map((field) => [field.key, field]));
  assert.deepEqual(Object.keys(fields), ['title', 'due', 'priority', 'list']);
  assert.equal(fields.title.type, 'string');
  assert.equal(fields.title.required, true);
  assert.deepEqual(
    fields.due.options.map((option) => option.value),
    DUE_OPTIONS,
  );
  assert.equal(fields.due.default, 'none');
  assert.deepEqual(
    fields.priority.options.map((option) => option.value),
    Object.keys(PRIORITY_OPTIONS),
  );
  assert.equal(fields.priority.default, 'none');
  assert.equal(fields.list.default, 'inbox');
  assert.deepEqual(fields.list.options, [
    { value: 'inbox', label: { en: 'Inbox', fr: 'Boîte de réception' } },
    { value: 'p-groceries', label: { en: 'Groceries' } },
    { value: 'p-long', label: { en: `${'L'.repeat(39)}…` } },
    { value: 'p-blank', label: { en: '(untitled)', fr: '(sans titre)' } },
  ]);
});

test('the list options stop at 50, and the busiest content stays within the budget', () => {
  const projects = Array.from({ length: 60 }, (_, index) => ({
    id: `p${index}`,
    name: `L${index}`,
  }));
  const tasks = Array.from({ length: 11 }, (_, index) => task({ id: `t${index}` }));
  const content = build({ projects, tasks }, { error: ERROR });
  // Two tiles, the list, the overflow caption, the error and the button.
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(typesOf(content), ['value', 'value', 'card-list', 'text', 'text', 'button']);
  const list = content.components[5].action.fields.find((field) => field.key === 'list');
  assert.equal(list.options.length, 50);
  assert.equal(list.options[0].value, 'inbox');
  assert.equal(list.options[49].value, 'p48');
});

test('taskUrl escapes the ids', () => {
  assert.equal(
    taskUrl({ projectId: 'a b', id: 'c/d' }),
    'https://ticktick.com/webapp/#p/a%20b/tasks/c%2Fd',
  );
});
