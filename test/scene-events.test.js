import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskDueScheduler, buildTaskDueEventData, fireTimeOf } from '../src/scene-events.js';
import { task } from './fixtures/ticktick.js';

const TZ = 'Europe/Paris';
const NOW = new Date('2026-10-09T08:00:00Z');

function fakeTimers() {
  const timers = new Map();
  let next = 1;
  return {
    timers,
    setTimer(fn, delay) {
      const id = next++;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    fireAll() {
      for (const [id, { fn }] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
  };
}

const schedulerWith = (clock = { now: NOW }) => {
  const timers = fakeTimers();
  const fired = [];
  const scheduler = new TaskDueScheduler({
    onDue: (entry) => fired.push(entry.id),
    now: () => clock.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    timeZone: TZ,
  });
  return { scheduler, timers, fired, clock };
};

test('fireTimeOf: the due time, or the configured hour of an all-day task', () => {
  assert.equal(fireTimeOf(task(), 9, TZ).toISOString(), '2026-10-09T12:00:00.000Z');
  assert.equal(fireTimeOf(task({ allDay: true }), 9, TZ).toISOString(), '2026-10-09T07:00:00.000Z');
  assert.equal(fireTimeOf(task({ due: null }), 9, TZ), null);
});

test('buildTaskDueEventData is flat and language-neutral', () => {
  const data = buildTaskDueEventData(
    task({ priority: 3, listName: null, content: 'z'.repeat(1500) }),
    TZ,
  );
  assert.deepEqual(
    { ...data, content: data.content.length },
    {
      title: 'Buy milk',
      list_name: 'Inbox',
      priority: 'medium',
      due_date: '2026-10-09',
      due_time: '14:00',
      all_day: false,
      content: 1000,
    },
  );
});

test('reschedule sets one timer per task due within 24 h, none for the past', () => {
  const { scheduler, timers, fired } = schedulerWith();
  scheduler.reschedule(
    [
      task({ id: 'in-4h' }),
      task({ id: 'past', due: new Date('2026-10-09T07:00:00Z') }),
      task({ id: 'all-day-today-9h-past', allDay: true }),
      task({ id: 'all-day-tomorrow', allDay: true, dueDay: '2026-10-10' }),
      task({ id: 'in-3-days', due: new Date('2026-10-12T08:00:00Z'), dueDay: '2026-10-12' }),
      task({ id: 'no-date', due: null, dueDay: null }),
    ],
    9,
  );
  assert.deepEqual(
    [...timers.timers.values()].map(({ delay }) => delay / 3600000),
    [4, 23],
  );
  timers.fireAll();
  assert.deepEqual(fired, ['in-4h', 'all-day-tomorrow']);
});

test('reschedule replaces the schedule and never fires a task twice for the same due time', () => {
  const { scheduler, timers, fired, clock } = schedulerWith();
  const tasks = [task({ id: 'a' })];
  scheduler.reschedule(tasks, 9);
  scheduler.reschedule(tasks, 9);
  assert.equal(timers.timers.size, 1);
  timers.fireAll();
  // A poll right before the due time (timer fired a little early) schedules nothing new.
  clock.now = new Date('2026-10-09T11:59:59Z');
  scheduler.reschedule(tasks, 9);
  assert.equal(timers.timers.size, 0);
  assert.deepEqual(fired, ['a']);

  // Moved to another time: fires again.
  scheduler.reschedule([task({ id: 'a', due: new Date('2026-10-09T13:00:00Z') })], 9);
  assert.equal(timers.timers.size, 1);
});

test('the fired history is pruned after a day, and stop clears the timers', () => {
  const { scheduler, timers, clock } = schedulerWith();
  scheduler.reschedule([task({ id: 'a' })], 9);
  timers.fireAll();
  assert.equal(scheduler.fired.size, 1);
  clock.now = new Date('2026-10-11T08:00:00Z');
  scheduler.reschedule([], 9);
  assert.equal(scheduler.fired.size, 0);

  scheduler.reschedule([task({ id: 'b', due: new Date('2026-10-11T09:00:00Z') })], 9);
  scheduler.stop();
  assert.equal(timers.timers.size, 0);
});
