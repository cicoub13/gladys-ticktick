import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TickTickError } from '../src/ticktick/client.js';
import {
  fetchSnapshot,
  formatTickTickDate,
  normalizeTask,
  parseTickTickDate,
} from '../src/ticktick/snapshot.js';
import { project, projectData, rawTask } from './fixtures/ticktick.js';

process.env.TZ = 'Europe/Paris';

test('parseTickTickDate reads the offset without a colon, and rejects garbage', () => {
  assert.equal(
    parseTickTickDate('2019-11-13T03:00:00+0000').toISOString(),
    '2019-11-13T03:00:00.000Z',
  );
  assert.equal(
    parseTickTickDate('2019-11-13T03:00:00.000+0200').toISOString(),
    '2019-11-13T01:00:00.000Z',
  );
  assert.equal(parseTickTickDate(''), null);
  assert.equal(parseTickTickDate(undefined), null);
  assert.equal(parseTickTickDate('not a date'), null);
});

test('formatTickTickDate writes the TickTick format', () => {
  assert.equal(formatTickTickDate(new Date('2019-11-13T03:00:00Z')), '2019-11-13T03:00:00+0000');
});

test('normalizeTask keeps the fields the integration uses', () => {
  const task = normalizeTask(rawTask({ priority: 5, content: ' Semi-skimmed ' }), 'Groceries');
  assert.deepEqual(task, {
    id: 't-milk',
    projectId: 'p-groceries',
    listName: 'Groceries',
    title: 'Buy milk',
    content: 'Semi-skimmed',
    priority: 5,
    allDay: false,
    due: new Date('2026-10-09T12:00:00Z'),
    dueDay: '2026-10-09',
  });
});

test('an all-day task gets the day of its own time zone', () => {
  // Midnight in Tokyo is still the previous day in Paris.
  const task = normalizeTask(
    rawTask({ isAllDay: true, dueDate: '2026-10-09T15:00:00+0000', timeZone: 'Asia/Tokyo' }),
    null,
  );
  assert.equal(task.dueDay, '2026-10-10');
  const unknownZone = normalizeTask(
    rawTask({ isAllDay: true, dueDate: '2026-10-09T22:00:00+0000', timeZone: 'Not/AZone' }),
    null,
  );
  assert.equal(unknownZone.dueDay, '2026-10-10');
});

test('normalizeTask defaults odd fields and skips what is not an undone task', () => {
  const task = normalizeTask(
    rawTask({ title: undefined, content: '', desc: 'from desc', priority: 2, dueDate: null }),
    'L',
  );
  assert.equal(task.title, '');
  assert.equal(task.content, 'from desc');
  assert.equal(task.priority, 0);
  assert.equal(task.due, null);
  assert.equal(task.dueDay, null);
  assert.equal(normalizeTask(rawTask({ content: undefined, desc: undefined }), 'L').content, '');
  assert.equal(normalizeTask(rawTask({ status: 2 }), 'L'), null);
  assert.equal(normalizeTask(rawTask({ status: -1 }), 'L'), null);
  assert.equal(normalizeTask(rawTask({ kind: 'NOTE' }), 'L'), null);
  assert.equal(normalizeTask(rawTask({ id: 42 }), 'L'), null);
  assert.equal(normalizeTask(null, 'L'), null);
  assert.ok(normalizeTask(rawTask({ status: undefined }), 'L'));
});

const clientOf = (routes) => ({
  calls: [],
  async listProjects() {
    return routes.projects;
  },
  async getProjectData(id) {
    this.calls.push(id);
    const answer = routes.data[id];
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  },
});

test('fetchSnapshot reads the inbox and every open task list', async () => {
  const client = clientOf({
    projects: [
      project(),
      project({ id: 'p-closed', closed: true }),
      project({ id: 'p-notes', kind: 'NOTE' }),
      { name: 'no id' },
    ],
    data: {
      inbox: { tasks: [rawTask({ id: 't-inbox', projectId: 'inbox118' })] },
      'p-groceries': projectData([rawTask(), rawTask({ id: 't-done', status: 2 })]),
    },
  });
  const snapshot = await fetchSnapshot(client);
  assert.deepEqual(client.calls, ['inbox', 'p-groceries']);
  assert.deepEqual(snapshot.projects, [{ id: 'p-groceries', name: 'Groceries' }]);
  assert.equal(snapshot.inboxId, 'inbox118');
  assert.deepEqual(
    snapshot.tasks.map((task) => [task.id, task.listName]),
    [
      ['t-inbox', null],
      ['t-milk', 'Groceries'],
    ],
  );
});

test('fetchSnapshot survives an account without an inbox endpoint, not other failures', async () => {
  const withoutInbox = await fetchSnapshot(
    clientOf({
      projects: null,
      data: { inbox: new TickTickError('not_found', 'x', { status: 404 }) },
    }),
  );
  assert.deepEqual(withoutInbox, { projects: [], inboxId: 'inbox', tasks: [] });

  await assert.rejects(
    fetchSnapshot(clientOf({ projects: [], data: { inbox: new TickTickError('auth', 'x') } })),
    { kind: 'auth' },
  );
});

test('fetchSnapshot takes the inbox id from the project when TickTick sends it', async () => {
  const snapshot = await fetchSnapshot(
    clientOf({ projects: [], data: { inbox: { project: { id: 'inbox99' }, tasks: 'bad' } } }),
  );
  assert.equal(snapshot.inboxId, 'inbox99');
  assert.deepEqual(snapshot.tasks, []);
});
