// -----------------------------------------------------------------------------
// One polling round: the TickTick lists and their undone tasks, reduced to a
// snapshot the widget, the scene actions and the scene trigger read.
//
// The API is untrusted: a malformed task is skipped or defaulted, never
// thrown. GET /project omits the inbox, so it is read on its own through the
// `inbox` pseudo id; an account where that id is unknown (404) simply has no
// inbox tasks in the snapshot.
//
// Dates: TickTick writes `2019-11-13T03:00:00+0000` (no colon in the offset).
// An all-day task stores the midnight of its day in the task's own time zone
// (`timeZone`), so its day is read in that zone; a timed task's day is read in
// the Gladys time zone.
// -----------------------------------------------------------------------------

import { INBOX_PROJECT_ID } from './client.js';
import { localDay } from '../time.js';

// TickTick priorities: 0 none, 1 low, 3 medium, 5 high.
export const PRIORITIES = { 0: 'none', 1: 'low', 3: 'medium', 5: 'high' };

const STATUS_UNDONE = 0;

/**
 * @typedef {object} Task
 * @property {string} id
 * @property {string} projectId
 * @property {string|null} listName - null for the inbox.
 * @property {string} title
 * @property {string} content
 * @property {0|1|3|5} priority
 * @property {boolean} allDay
 * @property {Date|null} due
 * @property {string|null} dueDay - 'YYYY-MM-DD'.
 */

/**
 * @typedef {object} Snapshot
 * @property {{id: string, name: string}[]} projects - Open task lists, inbox excluded.
 * @property {string} inboxId - The real id of the inbox when known, else 'inbox'.
 * @property {Task[]} tasks - Undone tasks of every list, inbox included.
 */

/**
 * Parse a TickTick date.
 * @param {unknown} value - e.g. '2019-11-13T03:00:00+0000'.
 * @returns {Date|null} The instant, or null when missing or invalid.
 * @example
 * parseTickTickDate('2019-11-13T03:00:00+0000'); // 2019-11-13T03:00:00.000Z
 */
export function parseTickTickDate(value) {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Format an instant the way TickTick expects it.
 * @param {Date} date - The instant.
 * @returns {string} e.g. '2019-11-13T03:00:00+0000'.
 * @example
 * formatTickTickDate(new Date('2019-11-13T03:00:00Z')); // '2019-11-13T03:00:00+0000'
 */
export function formatTickTickDate(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, '+0000');
}

function dayOf(due, allDay, taskTimeZone) {
  if (allDay && typeof taskTimeZone === 'string' && taskTimeZone !== '') {
    try {
      return localDay(due, taskTimeZone);
    } catch {
      // Unknown zone name: fall back to the Gladys one below.
    }
  }
  return localDay(due);
}

/**
 * Normalize one raw task, or null when it is not an undone task.
 * @param {object} raw - A task from the API.
 * @param {string|null} listName - Name of its list, null for the inbox.
 * @returns {Task|null} The task.
 * @example
 * normalizeTask({ id: 't1', projectId: 'p1', title: 'Buy milk', status: 0 }, 'Groceries');
 */
export function normalizeTask(raw, listName) {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  if (typeof raw.id !== 'string' || typeof raw.projectId !== 'string') {
    return null;
  }
  if ((raw.status ?? STATUS_UNDONE) !== STATUS_UNDONE || raw.kind === 'NOTE') {
    return null;
  }
  const due = parseTickTickDate(raw.dueDate);
  const allDay = raw.isAllDay === true;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const content = typeof raw.content === 'string' && raw.content !== '' ? raw.content : raw.desc;
  return {
    id: raw.id,
    projectId: raw.projectId,
    listName,
    title,
    content: typeof content === 'string' ? content.trim() : '',
    priority: Object.hasOwn(PRIORITIES, raw.priority) ? raw.priority : 0,
    allDay,
    due,
    dueDay: due ? dayOf(due, allDay, raw.timeZone) : null,
  };
}

const tasksOf = (data, listName) =>
  (Array.isArray(data?.tasks) ? data.tasks : [])
    .map((raw) => normalizeTask(raw, listName))
    .filter(Boolean);

/**
 * Read every open list and its undone tasks.
 * @param {import('./client.js').TickTickClient} client - The API client.
 * @returns {Promise<Snapshot>} The snapshot.
 * @example
 * const snapshot = await fetchSnapshot(client);
 */
export async function fetchSnapshot(client) {
  const rawProjects = await client.listProjects();
  const projects = (Array.isArray(rawProjects) ? rawProjects : [])
    .filter(
      (project) =>
        typeof project?.id === 'string' &&
        project.closed !== true &&
        (project.kind ?? 'TASK') === 'TASK',
    )
    .map((project) => ({
      id: project.id,
      name: typeof project.name === 'string' ? project.name.trim() : '',
    }));

  const tasks = [];
  let inboxId = INBOX_PROJECT_ID;
  try {
    const inbox = await client.getProjectData(INBOX_PROJECT_ID);
    const inboxTasks = tasksOf(inbox, null);
    inboxId = inbox?.project?.id ?? inboxTasks[0]?.projectId ?? INBOX_PROJECT_ID;
    tasks.push(...inboxTasks);
  } catch (err) {
    if (err?.kind !== 'not_found') {
      throw err;
    }
  }
  // One list at a time: TickTick documents no rate limit, stay gentle.
  for (const project of projects) {
    tasks.push(...tasksOf(await client.getProjectData(project.id), project.name));
  }
  return { projects, inboxId, tasks };
}
