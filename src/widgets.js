// -----------------------------------------------------------------------------
// `tasks` dashboard widget: pure mapping Snapshot -> widget content.
//
// Two tiles (overdue, today), then the focal `card-list` (list display, 8 rows
// at most) of the tasks of the scope chosen in the widget settings, then a
// caption when more tasks did not fit, or an error text when the last poll
// failed. A row opens the core's detail panel with the task notes and a link
// to the task in the TickTick web app.
//
// A card-list row cannot carry a button, so tasks are completed in TickTick
// (or by a scene), not from the widget. Texts are written in the viewer's
// language and clipped to the vocabulary bounds, so the content reaches the
// dashboard exactly as sent (validateWidgetContent reports nothing, see the
// tests). Due dates go in the subtitle as local text rather than in the
// `date` field: an all-day task has a day, not an instant.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DEFAULT_SCOPE, SCOPES, bucketOf, countTasks, selectTasks } from './tasks.js';
import { dueText, listLabel, priorityLabel, resolveLanguage } from './localize.js';

export const TASKS_WIDGET_KEY = 'tasks';

const TTL_SECONDS = 60;
const MAX_ROWS = 8;

// Vocabulary bounds (SDK README, "Dashboard widgets").
const CARD_TITLE_MAX = 60;
const CARD_SUBTITLE_MAX = 60;
const CARD_DESCRIPTION_MAX = 2000;
const CAPTION_MAX = 80;
const BODY_MAX = 300;

const PRIORITY_COLORS = {
  1: WIDGET_COLORS.INFO,
  3: WIDGET_COLORS.WARNING,
  5: WIDGET_COLORS.DANGER,
};

const TEXTS = {
  en: {
    overdue: 'Overdue',
    today: 'Today',
    untitled: '(untitled)',
    open: 'Open in TickTick',
    more: (count) => `+${count} more ${count === 1 ? 'task' : 'tasks'} in TickTick`,
    empty: {
      today_and_overdue: 'Nothing due today. Well done!',
      today: 'Nothing due today.',
      overdue: 'No overdue task. Well done!',
      week: 'Nothing due this week.',
    },
    notConnected: 'Connect your TickTick account in the integration settings.',
  },
  fr: {
    overdue: 'En retard',
    today: "Aujourd'hui",
    untitled: '(sans titre)',
    open: 'Ouvrir dans TickTick',
    more: (count) => `+${count} ${count === 1 ? 'autre tâche' : 'autres tâches'} dans TickTick`,
    empty: {
      today_and_overdue: "Rien à faire aujourd'hui. Bravo !",
      today: "Rien de prévu aujourd'hui.",
      overdue: 'Aucune tâche en retard. Bravo !',
      week: 'Rien de prévu cette semaine.',
    },
    notConnected: "Connectez votre compte TickTick dans les paramètres de l'intégration.",
  },
};

const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/**
 * Link to a task in the TickTick web app.
 * @param {import('./ticktick/snapshot.js').Task} task - The task.
 * @returns {string} The https URL.
 * @example
 * taskUrl({ projectId: 'p1', id: 't1' }); // 'https://ticktick.com/webapp/#p/p1/tasks/t1'
 */
export function taskUrl(task) {
  return `https://ticktick.com/webapp/#p/${encodeURIComponent(task.projectId)}/tasks/${encodeURIComponent(task.id)}`;
}

function buildItem(task, language, now, timeZone) {
  const texts = TEXTS[language];
  const overdue = bucketOf(task, now, timeZone) === 'overdue';
  const item = {
    title: clip(task.title || texts.untitled, CARD_TITLE_MAX),
    subtitle: clip(
      `${listLabel(task, language)} · ${dueText(task, language, now, overdue, timeZone)}`,
      CARD_SUBTITLE_MAX,
    ),
    links: [{ url: taskUrl(task), label: texts.open }],
  };
  const priority = priorityLabel(task.priority, language);
  if (priority) {
    item.badge = { text: priority, color: PRIORITY_COLORS[task.priority] };
  }
  if (task.content) {
    item.description = clip(task.content, CARD_DESCRIPTION_MAX);
  }
  return item;
}

/**
 * Content of the `tasks` widget.
 * @param {import('./ticktick/snapshot.js').Snapshot|null} snapshot - Last snapshot, null before the first poll.
 * @param {object} options
 * @param {{scope?: string}} [options.settings] - Widget instance settings.
 * @param {string} [options.language] - Viewer language.
 * @param {{en: string, fr: string}|null} [options.error] - Message of the last failed poll.
 * @param {Date} [options.now] - Reference instant, for tests.
 * @param {string} [options.timeZone] - IANA time zone, for tests.
 * @returns {object} The widget content.
 * @example
 * buildTasksContent(snapshot, { settings: { scope: 'today' }, language: 'fr' });
 */
export function buildTasksContent(
  snapshot,
  { settings = {}, language, error = null, now = new Date(), timeZone } = {},
) {
  const resolved = resolveLanguage(language);
  const texts = TEXTS[resolved];
  const components = [];
  const errorText = error
    ? { type: 'text', variant: 'body', text: clip(error[resolved], BODY_MAX) }
    : null;

  if (!snapshot) {
    components.push(errorText ?? { type: 'text', variant: 'body', text: texts.notConnected });
    return { ttl_seconds: TTL_SECONDS, components };
  }

  const scope = SCOPES.includes(settings.scope) ? settings.scope : DEFAULT_SCOPE;
  const counts = countTasks(snapshot.tasks, now, timeZone);
  const tasks = selectTasks(snapshot.tasks, scope, now, timeZone);

  components.push(
    {
      type: 'value',
      label: texts.overdue,
      value: counts.overdue,
      icon: 'alert-circle',
      color: counts.overdue > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      label: texts.today,
      value: counts.today,
      icon: 'calendar',
      color: WIDGET_COLORS.PRIMARY,
    },
  );

  // Text budget: 2 texts, 1 body. The body is reserved for the error, the
  // captions (empty state, overflow) never come together.
  if (tasks.length === 0) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: clip(texts.empty[scope], CAPTION_MAX),
    });
  } else {
    components.push({
      type: 'card-list',
      display: 'list',
      items: tasks.slice(0, MAX_ROWS).map((task) => buildItem(task, resolved, now, timeZone)),
    });
    if (tasks.length > MAX_ROWS) {
      components.push({
        type: 'text',
        variant: 'caption',
        text: texts.more(tasks.length - MAX_ROWS),
      });
    }
  }
  if (errorText) {
    // The tasks shown are those of the last successful poll: say why they may be stale.
    components.push(errorText);
  }
  return { ttl_seconds: TTL_SECONDS, components };
}
