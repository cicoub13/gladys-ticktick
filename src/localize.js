// -----------------------------------------------------------------------------
// Human-readable task values.
//
// The widget gets the viewer's language with each request and is written in
// it. Scenes get no language (event data and action outputs are flat
// scalars), so their values stay language-neutral: `HH:MM` times,
// `YYYY-MM-DD` days, priority codes, and "Inbox" for the list without a name.
// Dates and times use the process time zone (the `TZ` Gladys injects).
// -----------------------------------------------------------------------------

import { PRIORITIES } from './ticktick/snapshot.js';
import { addDays, formatLocalTime, localDay } from './time.js';

export const LANGUAGES = ['en', 'fr'];

// Name of the inbox in scenes, where no language is known.
export const INBOX_NAME = 'Inbox';

const TEXTS = {
  en: {
    inbox: 'Inbox',
    today: 'Today',
    tomorrow: 'Tomorrow',
    late: 'Late',
    priority: { low: 'Low', medium: 'Medium', high: 'High' },
  },
  fr: {
    inbox: 'Boîte de réception',
    today: "Aujourd'hui",
    tomorrow: 'Demain',
    late: 'En retard',
    priority: { low: 'Basse', medium: 'Moyenne', high: 'Haute' },
  },
};

/**
 * Snap a requested language to a supported one, English otherwise.
 * @param {string} [language] - ISO 639-1 code, e.g. from a widget request.
 * @returns {'en'|'fr'} A supported language.
 * @example
 * resolveLanguage('de'); // 'en'
 */
export function resolveLanguage(language) {
  return LANGUAGES.includes(language) ? language : 'en';
}

/**
 * @param {import('./ticktick/snapshot.js').Task} task - The task.
 * @param {string} [language] - Viewer language; omitted for scenes.
 * @returns {string} The name of the task's list.
 * @example
 * listLabel(task, 'fr'); // 'Boîte de réception'
 */
export function listLabel(task, language) {
  if (task.listName) {
    return task.listName;
  }
  return language === undefined ? INBOX_NAME : TEXTS[resolveLanguage(language)].inbox;
}

/**
 * @param {number} priority - TickTick priority (0, 1, 3, 5).
 * @param {string} language - Viewer language.
 * @returns {string|null} The label, null for no priority.
 * @example
 * priorityLabel(5, 'fr'); // 'Haute'
 */
export function priorityLabel(priority, language) {
  const code = PRIORITIES[priority];
  return code && code !== 'none' ? TEXTS[resolveLanguage(language)].priority[code] : null;
}

/**
 * When a task is due, for a widget row: "Today 14:00", "Tomorrow",
 * "Late · Wed, Oct 7", "Fri, Oct 9 18:30"...
 * @param {import('./ticktick/snapshot.js').Task} task - A task with a due date.
 * @param {string} language - Viewer language.
 * @param {Date} now - Reference instant.
 * @param {boolean} overdue - Whether the task is overdue.
 * @param {string} [timeZone] - IANA time zone, for tests.
 * @returns {string} The text.
 * @example
 * dueText(task, 'en', new Date(), false); // 'Today 14:00'
 */
export function dueText(task, language, now, overdue, timeZone) {
  const resolved = resolveLanguage(language);
  const texts = TEXTS[resolved];
  const today = localDay(now, timeZone);
  let day;
  if (task.dueDay === today) {
    day = texts.today;
  } else if (task.dueDay === addDays(today, 1)) {
    day = texts.tomorrow;
  } else {
    // Noon UTC of the day: the same calendar day whatever the zone.
    day = new Date(`${task.dueDay}T12:00:00Z`).toLocaleDateString(resolved, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  }
  const when = task.allDay ? day : `${day} ${formatLocalTime(task.due, timeZone)}`;
  return overdue ? `${texts.late} · ${when}` : when;
}

/**
 * Language-neutral due values for scenes.
 * @param {import('./ticktick/snapshot.js').Task} task - The task.
 * @param {string} [timeZone] - IANA time zone, for tests.
 * @returns {{due_date: string, due_time: string}} 'YYYY-MM-DD' and 'HH:MM' ('' when all-day or no date).
 * @example
 * sceneDue(task); // { due_date: '2026-10-09', due_time: '14:00' }
 */
export function sceneDue(task, timeZone) {
  if (!task.due) {
    return { due_date: '', due_time: '' };
  }
  return {
    due_date: task.dueDay,
    due_time: task.allDay ? '' : formatLocalTime(task.due, timeZone),
  };
}
