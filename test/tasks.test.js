import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf, countTasks, selectTasks } from '../src/tasks.js';
import { task } from './fixtures/ticktick.js';

const TZ = 'Europe/Paris';
// Friday 2026-10-09, 10:00 in Paris.
const NOW = new Date('2026-10-09T08:00:00Z');

const timed = (id, iso, overrides = {}) => {
  const due = new Date(iso);
  return task({ id, title: id, due, dueDay: iso.slice(0, 10), ...overrides });
};
const allDay = (id, day, overrides = {}) =>
  task({
    id,
    title: id,
    allDay: true,
    due: new Date(`${day}T00:00:00Z`),
    dueDay: day,
    ...overrides,
  });

const TASKS = [
  timed('later-today', '2026-10-09T16:00:00Z'),
  timed('earlier-today', '2026-10-09T06:00:00Z'),
  allDay('today-all-day', '2026-10-09'),
  allDay('yesterday', '2026-10-08'),
  timed('tomorrow', '2026-10-10T07:00:00Z'),
  allDay('in-6-days', '2026-10-15'),
  allDay('in-7-days', '2026-10-16'),
  task({ id: 'no-date', title: 'no-date', due: null, dueDay: null }),
];

const ids = (tasks) => tasks.map((entry) => entry.id);

test('bucketOf: a timed task is overdue once its time passed, an all-day one once its day passed', () => {
  const buckets = Object.fromEntries(TASKS.map((entry) => [entry.id, bucketOf(entry, NOW, TZ)]));
  assert.deepEqual(buckets, {
    'later-today': 'today',
    'earlier-today': 'overdue',
    'today-all-day': 'today',
    yesterday: 'overdue',
    tomorrow: 'upcoming',
    'in-6-days': 'upcoming',
    'in-7-days': 'upcoming',
    'no-date': 'none',
  });
});

test('selectTasks sorts by day, all-day first, then time, priority and title', () => {
  assert.deepEqual(ids(selectTasks(TASKS, 'today_and_overdue', NOW, TZ)), [
    'yesterday',
    'today-all-day',
    'earlier-today',
    'later-today',
  ]);
  assert.deepEqual(ids(selectTasks(TASKS, 'today', NOW, TZ)), ['today-all-day', 'later-today']);
  assert.deepEqual(ids(selectTasks(TASKS, 'overdue', NOW, TZ)), ['yesterday', 'earlier-today']);
  assert.deepEqual(ids(selectTasks(TASKS, 'week', NOW, TZ)), [
    'yesterday',
    'today-all-day',
    'earlier-today',
    'later-today',
    'tomorrow',
    'in-6-days',
  ]);
  assert.deepEqual(
    ids(selectTasks(TASKS, 'bogus', NOW, TZ)),
    ids(selectTasks(TASKS, 'today_and_overdue', NOW, TZ)),
  );
});

test('selectTasks breaks ties by priority, then title', () => {
  const tasks = [
    allDay('b', '2026-10-09', { priority: 0 }),
    allDay('a', '2026-10-09', { priority: 0 }),
    allDay('c', '2026-10-09', { priority: 5 }),
  ];
  assert.deepEqual(ids(selectTasks(tasks, 'today', NOW, TZ)), ['c', 'a', 'b']);
});

test('countTasks counts overdue and today tasks', () => {
  assert.deepEqual(countTasks(TASKS, NOW, TZ), { overdue: 2, today: 2 });
});
