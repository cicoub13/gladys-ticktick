// -----------------------------------------------------------------------------
// Factories of TickTick Open API answers, shaped like the documented schemas
// (https://developer.ticktick.com/docs#/openapi), and of normalized tasks.
// -----------------------------------------------------------------------------

export const project = (overrides = {}) => ({
  id: 'p-groceries',
  name: 'Groceries',
  color: '#F18181',
  sortOrder: 0,
  closed: false,
  groupId: null,
  viewMode: 'list',
  permission: 'write',
  kind: 'TASK',
  ...overrides,
});

export const rawTask = (overrides = {}) => ({
  id: 't-milk',
  projectId: 'p-groceries',
  title: 'Buy milk',
  content: '',
  desc: '',
  isAllDay: false,
  startDate: '2026-10-09T12:00:00+0000',
  dueDate: '2026-10-09T12:00:00+0000',
  timeZone: 'Europe/Paris',
  priority: 0,
  status: 0,
  sortOrder: 0,
  kind: 'TEXT',
  etag: 'abc',
  ...overrides,
});

export const projectData = (tasks = [], overrides = {}) => ({
  project: project(overrides),
  tasks,
  columns: [],
});

/** A normalized task, as snapshot.js produces it. */
export const task = (overrides = {}) => ({
  id: 't-milk',
  projectId: 'p-groceries',
  listName: 'Groceries',
  title: 'Buy milk',
  content: '',
  priority: 0,
  allDay: false,
  due: new Date('2026-10-09T12:00:00Z'),
  dueDay: '2026-10-09',
  ...overrides,
});

/** A route table `fetch`: `{ 'GET /path': { status, body } | (init) => ... }`. */
export function fakeFetch(routes) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const { pathname, href } = new URL(url);
    const path = pathname.replace('/open/v1', '');
    requests.push({ url: href, path, ...init });
    const route = routes[`${init.method ?? 'GET'} ${path}`];
    if (route === undefined) {
      return response(404, '');
    }
    const result = typeof route === 'function' ? await route(init) : route;
    let text = '';
    if (typeof result.body === 'string') {
      text = result.body;
    } else if (result.body !== undefined) {
      text = JSON.stringify(result.body);
    }
    return response(result.status ?? 200, text);
  };
  fetchImpl.requests = requests;
  return fetchImpl;
}

function response(status, text) {
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}
