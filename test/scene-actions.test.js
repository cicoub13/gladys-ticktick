import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNewTask, buildTasksSummary, runCreateTask } from '../src/scene-actions.js';
import { task } from './fixtures/ticktick.js';

process.env.TZ = 'Europe/Paris';

const TZ = 'Europe/Paris';
const NOW = new Date('2026-10-09T08:00:00Z');
const PROJECTS = [
  { id: 'p-groceries', name: 'Groceries' },
  { id: 'p-home', name: 'Home' },
];

test('buildNewTask without a date goes to the matching list, case-insensitively', () => {
  const { task: payload, listName } = buildNewTask(
    { title: '  Buy milk ', list_name: ' groceries ', priority: 'high', due: 'none' },
    PROJECTS,
    'inbox1',
    NOW,
    TZ,
  );
  assert.deepEqual(payload, { title: 'Buy milk', projectId: 'p-groceries', priority: 5 });
  assert.equal(listName, 'Groceries');
});

test('buildNewTask falls back to the inbox for an empty or unknown list', () => {
  for (const listName of [undefined, '', 'Nope']) {
    const built = buildNewTask({ title: 'x', list_name: listName }, PROJECTS, 'inbox1', NOW, TZ);
    assert.equal(built.task.projectId, 'inbox1');
    assert.equal(built.task.priority, 0);
    assert.equal(built.listName, 'Inbox');
  }
});

test('buildNewTask sets an all-day date, or a timed one when a time is given', () => {
  const allDay = buildNewTask({ title: 'x', due: 'tomorrow' }, PROJECTS, 'inbox', NOW, TZ).task;
  assert.equal(allDay.dueDate, '2026-10-09T22:00:00+0000');
  assert.equal(allDay.startDate, allDay.dueDate);
  assert.equal(allDay.isAllDay, true);
  assert.equal(allDay.timeZone, TZ);

  const timed = buildNewTask(
    { title: 'x', due: 'today', due_time: '18h30' },
    PROJECTS,
    'inbox',
    NOW,
    TZ,
  ).task;
  assert.equal(timed.dueDate, '2026-10-09T16:30:00+0000');
  assert.equal(timed.isAllDay, false);

  const badTime = buildNewTask({ title: 'x', due: 'today', due_time: '25:00' }, [], 'i', NOW, TZ);
  assert.equal(badTime.task.isAllDay, true);
  assert.equal(
    buildNewTask({ title: 'x', due: 'later' }, [], 'i', NOW, TZ).task.dueDate,
    undefined,
  );
});

test('buildNewTask uses the process time zone by default', () => {
  const built = buildNewTask({ title: 'x', due: 'today' }, [], 'i', NOW);
  assert.equal(built.task.timeZone, 'Europe/Paris');
});

test('buildNewTask refuses an empty title', () => {
  assert.throws(() => buildNewTask({ title: '  ' }, PROJECTS, 'inbox', NOW, TZ), /empty/);
  assert.throws(() => buildNewTask(undefined, PROJECTS, 'inbox', NOW, TZ), /empty/);
});

const fakeClient = (projects = []) => ({
  created: [],
  listed: 0,
  async listProjects() {
    this.listed += 1;
    return projects;
  },
  async createTask(payload) {
    this.created.push(payload);
    return { id: 'new-id', ...payload };
  },
});

test('runCreateTask uses the snapshot lists, and re-reads them for an unknown name', async () => {
  const snapshot = { projects: PROJECTS, inboxId: 'inbox1', tasks: [] };
  const client = fakeClient([{ id: 'p-new', name: 'New list' }, { id: 42 }]);
  assert.deepEqual(await runCreateTask(client, { title: 'a', list_name: 'Home' }, snapshot, NOW), {
    task_id: 'new-id',
    list_name: 'Home',
  });
  assert.equal(client.listed, 0);

  assert.deepEqual(
    await runCreateTask(client, { title: 'b', list_name: 'new list' }, snapshot, NOW),
    { task_id: 'new-id', list_name: 'New list' },
  );
  assert.equal(client.listed, 1);
  assert.equal(client.created[1].projectId, 'p-new');
});

test('runCreateTask works before the first poll, into the inbox', async () => {
  const client = fakeClient(null);
  client.createTask = async () => ({});
  assert.deepEqual(await runCreateTask(client, { title: 'a', list_name: 'Any' }, null), {
    task_id: '',
    list_name: 'Inbox',
  });
});

test('buildTasksSummary counts and lists the tasks of the scope', () => {
  const tasks = [
    task({ id: 'a', title: 'Buy milk' }),
    task({ id: 'b', title: 'Pay the bill', allDay: true, dueDay: '2026-10-08', listName: null }),
  ];
  assert.deepEqual(buildTasksSummary(tasks, { scope: 'today_and_overdue' }, NOW, TZ), {
    count: 2,
    titles: 'Pay the bill\nBuy milk (14:00)',
    next_title: 'Pay the bill',
    next_list: 'Inbox',
    next_due_date: '2026-10-08',
    next_due_time: '',
  });
  assert.deepEqual(buildTasksSummary(tasks, { scope: 'week' }, NOW, TZ).count, 2);
  assert.deepEqual(buildTasksSummary([], undefined, NOW, TZ), { count: 0, titles: '' });
});
