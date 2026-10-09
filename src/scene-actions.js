// -----------------------------------------------------------------------------
// Scene actions.
//
// `create_task`: adds a task to a list found by name (the inbox when the name
// is empty or matches no list), optionally due today or tomorrow, at a time or
// all day. Outputs the new task id and the list it landed in.
//
// `tasks_summary`: the tasks of a scope from the last snapshot, as a count and
// one line per task, ready for a notification or a voice message.
//
// Outputs are language-neutral (see localize.js). A failure throws: the scene
// logs it and goes on with its next actions.
// -----------------------------------------------------------------------------

import { DEFAULT_SCOPE, SCOPES, selectTasks } from './tasks.js';
import { INBOX_NAME, listLabel, sceneDue } from './localize.js';
import { formatTickTickDate } from './ticktick/snapshot.js';
import { addDays, formatLocalTime, localDay, zonedDateTime } from './time.js';

export const CREATE_TASK_KEY = 'create_task';
export const TASKS_SUMMARY_KEY = 'tasks_summary';

// Manifest option values, in the manifest order.
export const DUE_OPTIONS = ['none', 'today', 'tomorrow'];
export const PRIORITY_OPTIONS = { none: 0, low: 1, medium: 3, high: 5 };

const TITLE_MAX = 500;
const TIME_PATTERN = /^([01]?\d|2[0-3])[:hH]([0-5]\d)$/;

/**
 * Build the TickTick task a `create_task` action asks for.
 * @param {object} fields - The resolved action fields.
 * @param {{id: string, name: string}[]} projects - The open lists.
 * @param {string} inboxId - Id of the inbox.
 * @param {Date} now - Reference instant.
 * @param {string} [timeZone] - IANA time zone, for tests (defaults to TZ).
 * @returns {{task: object, listName: string}} The API payload and the list name.
 * @example
 * buildNewTask({ title: 'Take the bins out', due: 'today', due_time: '19:00' }, projects, 'inbox', new Date());
 */
export function buildNewTask(fields, projects, inboxId, now, timeZone) {
  const title = typeof fields?.title === 'string' ? fields.title.trim() : '';
  if (title === '') {
    throw new Error('The task title is empty / Le titre de la tâche est vide');
  }
  const wanted = typeof fields.list_name === 'string' ? fields.list_name.trim().toLowerCase() : '';
  const project = wanted
    ? projects.find((entry) => entry.name.toLowerCase() === wanted)
    : undefined;

  const task = {
    title: title.slice(0, TITLE_MAX),
    projectId: project?.id ?? inboxId,
    priority: PRIORITY_OPTIONS[fields.priority] ?? 0,
  };

  const due = DUE_OPTIONS.includes(fields.due) ? fields.due : 'none';
  if (due !== 'none') {
    const day = addDays(localDay(now, timeZone), due === 'tomorrow' ? 1 : 0);
    const time =
      typeof fields.due_time === 'string' ? TIME_PATTERN.exec(fields.due_time.trim()) : null;
    const instant = time
      ? zonedDateTime(day, Number(time[1]), Number(time[2]), timeZone)
      : zonedDateTime(day, 0, 0, timeZone);
    task.startDate = formatTickTickDate(instant);
    task.dueDate = task.startDate;
    task.isAllDay = time === null;
    task.timeZone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  return { task, listName: project?.name ?? INBOX_NAME };
}

/**
 * Run `create_task`.
 * @param {import('./ticktick/client.js').TickTickClient} client - The API client.
 * @param {object} fields - The resolved action fields.
 * @param {import('./ticktick/snapshot.js').Snapshot|null} snapshot - Last snapshot (its lists), if any.
 * @param {Date} [now] - Reference instant, for tests.
 * @returns {Promise<{task_id: string, list_name: string}>} The outputs.
 * @example
 * await runCreateTask(client, { title: 'Buy milk' }, snapshot);
 */
export async function runCreateTask(client, fields, snapshot, now = new Date()) {
  // A list created since the last poll is still found.
  let projects = snapshot?.projects ?? [];
  const wanted = typeof fields?.list_name === 'string' ? fields.list_name.trim().toLowerCase() : '';
  if (wanted && !projects.some((project) => project.name.toLowerCase() === wanted)) {
    const raw = await client.listProjects();
    projects = (Array.isArray(raw) ? raw : [])
      .filter((project) => typeof project?.id === 'string' && typeof project.name === 'string')
      .map((project) => ({ id: project.id, name: project.name.trim() }));
  }
  const { task, listName } = buildNewTask(fields, projects, snapshot?.inboxId ?? 'inbox', now);
  const created = await client.createTask(task);
  return { task_id: typeof created?.id === 'string' ? created.id : '', list_name: listName };
}

/**
 * Outputs of `tasks_summary`. `next_*` are omitted when no task is selected.
 * @param {import('./ticktick/snapshot.js').Task[]} tasks - All undone tasks.
 * @param {object} fields - The resolved action fields.
 * @param {Date} [now] - Reference instant, for tests.
 * @param {string} [timeZone] - IANA time zone, for tests.
 * @returns {{count: number, titles: string, next_title?: string, next_list?: string, next_due_date?: string, next_due_time?: string}} The outputs.
 * @example
 * buildTasksSummary(snapshot.tasks, { scope: 'today' });
 */
export function buildTasksSummary(tasks, fields, now = new Date(), timeZone = undefined) {
  const scope = SCOPES.includes(fields?.scope) ? fields.scope : DEFAULT_SCOPE;
  const selected = selectTasks(tasks, scope, now, timeZone);
  const titles = selected
    .map((task) =>
      task.allDay ? task.title : `${task.title} (${formatLocalTime(task.due, timeZone)})`,
    )
    .join('\n');
  const outputs = { count: selected.length, titles };
  const [next] = selected;
  if (next) {
    const { due_date: dueDate, due_time: dueTime } = sceneDue(next, timeZone);
    Object.assign(outputs, {
      next_title: next.title,
      next_list: listLabel(next),
      next_due_date: dueDate,
      next_due_time: dueTime,
    });
  }
  return outputs;
}
