// -----------------------------------------------------------------------------
// Which tasks are "overdue", "today" or "this week", and in which order they
// are shown. Shared by the widget and the `tasks_summary` scene action, so a
// dashboard and a scene never disagree about what is due.
//
// A timed task is overdue as soon as its time has passed; an all-day task only
// once its day has passed. Days are local (see time.js).
// -----------------------------------------------------------------------------

import { addDays, localDay } from './time.js';

// The scopes offered by the widget setting and the scene action field, in
// the manifest order.
export const SCOPES = ['today_and_overdue', 'today', 'overdue', 'week'];
export const DEFAULT_SCOPE = 'today_and_overdue';

const WEEK_DAYS = 7;

/**
 * @param {import('./ticktick/snapshot.js').Task} task - The task.
 * @param {Date} now - Reference instant.
 * @param {string} [timeZone] - IANA time zone, for tests.
 * @returns {'overdue'|'today'|'upcoming'|'none'} Where the task stands.
 * @example
 * bucketOf(task, new Date());
 */
export function bucketOf(task, now, timeZone) {
  if (!task.due) {
    return 'none';
  }
  const today = localDay(now, timeZone);
  if (task.allDay) {
    if (task.dueDay < today) {
      return 'overdue';
    }
    return task.dueDay === today ? 'today' : 'upcoming';
  }
  if (task.due.getTime() < now.getTime()) {
    return 'overdue';
  }
  return task.dueDay === today ? 'today' : 'upcoming';
}

const inScope = (task, bucket, scope, now, timeZone) => {
  switch (scope) {
    case 'today':
      return bucket === 'today';
    case 'overdue':
      return bucket === 'overdue';
    case 'week':
      return (
        bucket === 'overdue' ||
        bucket === 'today' ||
        (bucket === 'upcoming' && task.dueDay <= addDays(localDay(now, timeZone), WEEK_DAYS - 1))
      );
    default:
      return bucket === 'overdue' || bucket === 'today';
  }
};

/**
 * The tasks of a scope, overdue first, then by due date, then by priority.
 * @param {import('./ticktick/snapshot.js').Task[]} tasks - All undone tasks.
 * @param {string} scope - One of SCOPES; anything else means DEFAULT_SCOPE.
 * @param {Date} now - Reference instant.
 * @param {string} [timeZone] - IANA time zone, for tests.
 * @returns {import('./ticktick/snapshot.js').Task[]} The sorted selection.
 * @example
 * selectTasks(snapshot.tasks, 'today', new Date());
 */
export function selectTasks(tasks, scope, now, timeZone) {
  return tasks
    .filter((task) => inScope(task, bucketOf(task, now, timeZone), scope, now, timeZone))
    .sort(compareTasks);
}

// By day; within a day the all-day tasks first, then by time; then by
// priority (high first) and title.
const compareTasks = (a, b) =>
  a.dueDay.localeCompare(b.dueDay) ||
  Number(b.allDay) - Number(a.allDay) ||
  a.due.getTime() - b.due.getTime() ||
  b.priority - a.priority ||
  a.title.localeCompare(b.title);

/**
 * Count the overdue and today tasks.
 * @param {import('./ticktick/snapshot.js').Task[]} tasks - All undone tasks.
 * @param {Date} now - Reference instant.
 * @param {string} [timeZone] - IANA time zone, for tests.
 * @returns {{overdue: number, today: number}} The counts.
 * @example
 * countTasks(snapshot.tasks, new Date()); // { overdue: 2, today: 3 }
 */
export function countTasks(tasks, now, timeZone) {
  const counts = { overdue: 0, today: 0 };
  for (const task of tasks) {
    const bucket = bucketOf(task, now, timeZone);
    if (bucket === 'overdue' || bucket === 'today') {
      counts[bucket] += 1;
    }
  }
  return counts;
}
