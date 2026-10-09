// -----------------------------------------------------------------------------
// `task_due` scene trigger: scheduling, and the event payload handed to the
// SDK's `publishSceneEvent`.
//
// After every poll, one timer per undone task due within the next 24 hours:
// at its time for a timed task, at the configured hour of its day for an
// all-day task. The schedule is fully replaced each time (a task completed or
// moved in TickTick simply drops out), on the model of PassScheduler in
// ../gladys-iss/src/scene-events.js. A due time already past is never fired
// late (a restart does not replay the morning's tasks), and each task fires
// at most once per due time, even when a timer fires a few milliseconds early
// and the next poll would schedule it again.
// -----------------------------------------------------------------------------

import { PRIORITIES } from './ticktick/snapshot.js';
import { listLabel, sceneDue } from './localize.js';
import { zonedDateTime } from './time.js';

export const TASK_DUE_KEY = 'task_due';

const HORIZON_MS = 24 * 60 * 60 * 1000;
const CONTENT_MAX = 1000;

/**
 * The instant a task fires the trigger.
 * @param {import('./ticktick/snapshot.js').Task} task - The task.
 * @param {number} allDayHour - Local hour for all-day tasks.
 * @param {string} [timeZone] - IANA time zone, for tests.
 * @returns {Date|null} The instant, null without a due date.
 * @example
 * fireTimeOf(task, 9);
 */
export function fireTimeOf(task, allDayHour, timeZone) {
  if (!task.due) {
    return null;
  }
  return task.allDay ? zonedDateTime(task.dueDay, allDayHour, 0, timeZone) : task.due;
}

/**
 * Build the flat `data` of a `task_due` event: every key declared in the
 * manifest `fields` (priority) and `variables`.
 * @param {import('./ticktick/snapshot.js').Task} task - The task now due.
 * @param {string} [timeZone] - IANA time zone, for tests.
 * @returns {{title: string, list_name: string, priority: string, due_date: string, due_time: string, all_day: boolean, content: string}} The event data.
 * @example
 * buildTaskDueEventData(task);
 */
export function buildTaskDueEventData(task, timeZone) {
  return {
    title: task.title.slice(0, CONTENT_MAX),
    list_name: listLabel(task).slice(0, CONTENT_MAX),
    priority: PRIORITIES[task.priority],
    ...sceneDue(task, timeZone),
    all_day: task.allDay,
    content: task.content.slice(0, CONTENT_MAX),
  };
}

export class TaskDueScheduler {
  /**
   * @param {object} deps
   * @param {(task: import('./ticktick/snapshot.js').Task) => void} deps.onDue - Called when a task is due.
   * @param {() => Date} [deps.now] - Injectable clock, for tests.
   * @param {typeof setTimeout} [deps.setTimer] - Injectable timer, for tests.
   * @param {typeof clearTimeout} [deps.clearTimer] - Injectable timer, for tests.
   * @param {string} [deps.timeZone] - IANA time zone, for tests.
   */
  constructor({
    onDue,
    now = () => new Date(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    timeZone,
  }) {
    this.onDue = onDue;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timeZone = timeZone;
    this.timers = [];
    // `${taskId}|${fireAtMs}` -> fireAtMs, of the events already fired.
    this.fired = new Map();
  }

  /**
   * Replace the schedule with one timer per task due within the horizon.
   * @param {import('./ticktick/snapshot.js').Task[]} tasks - All undone tasks.
   * @param {number} allDayHour - Local hour for all-day tasks.
   * @returns {void}
   * @example
   * scheduler.reschedule(snapshot.tasks, 9);
   */
  reschedule(tasks, allDayHour) {
    this.stop();
    const nowMs = this.now().getTime();
    for (const [key, fireAtMs] of this.fired) {
      if (fireAtMs < nowMs - HORIZON_MS) {
        this.fired.delete(key);
      }
    }
    for (const task of tasks) {
      const fireAtMs = fireTimeOf(task, allDayHour, this.timeZone)?.getTime();
      if (fireAtMs === undefined) {
        continue;
      }
      const delay = fireAtMs - nowMs;
      const key = `${task.id}|${fireAtMs}`;
      if (delay <= 0 || delay > HORIZON_MS || this.fired.has(key)) {
        continue;
      }
      this.timers.push(
        this.setTimer(() => {
          this.fired.set(key, fireAtMs);
          this.onDue(task);
        }, delay),
      );
    }
  }

  /**
   * Cancel every pending timer (the fired history is kept).
   * @returns {void}
   * @example
   * scheduler.stop();
   */
  stop() {
    for (const timer of this.timers) {
      this.clearTimer(timer);
    }
    this.timers = [];
  }
}
