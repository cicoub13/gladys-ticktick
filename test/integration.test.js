import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TickTickIntegration, bilingual } from '../src/integration.js';
import { TickTickError } from '../src/ticktick/client.js';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { task } from './fixtures/ticktick.js';

process.env.TZ = 'Europe/Paris';

const NOW = new Date('2026-10-09T08:00:00Z');
const REDIRECT = 'https://my.gladysassistant.com/redirect/oauth';

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

const snapshotOf = (tasks = [task()]) => ({
  projects: [{ id: 'p-groceries', name: 'Groceries' }],
  inboxId: 'inbox1',
  tasks,
});

/**
 * An integration on the SDK fake Gladys. `outcomes` scripts fetchSnapshot: a
 * snapshot to resolve or an Error to throw, one per call (the last one repeats).
 * Connected first: the SDK drops a widget refresh nudge while disconnected.
 */
async function setup({ config = {}, outcomes = [snapshotOf()], deps = {} } = {}) {
  const gladys = createFakeGladys({ config });
  await gladys.connect();
  const timers = [];
  const clients = [];
  let call = 0;
  const integration = new TickTickIntegration(gladys, {
    createClient: (token) => {
      const client = {
        token,
        created: [],
        async listProjects() {
          return [{ id: 'p-groceries', name: 'Groceries' }];
        },
        async createTask(payload) {
          this.created.push(payload);
          return { id: 'new-id' };
        },
      };
      clients.push(client);
      return client;
    },
    fetchSnapshot: async (client) => {
      const outcome = outcomes[Math.min(call, outcomes.length - 1)];
      call += 1;
      if (outcome instanceof Error) {
        throw outcome;
      }
      return typeof outcome === 'function' ? outcome(client) : outcome;
    },
    logger: silentLogger,
    now: () => NOW,
    createState: () => 'state-1',
    setTimer: (fn, delay) => {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimer: () => {},
    ...deps,
  });
  return { gladys, integration, timers, clients, calls: () => call };
}

const authError = () => new TickTickError('auth', 'refused', { status: 401 });

/** The setConfig calls Gladys received (POST /config bodies). */
const configWrites = (gladys) => gladys.fake.bodies('POST', '/config');

test('without any token the integration asks to connect and does not poll', async () => {
  const { gladys, integration, calls } = await setup({ config: {} });
  await integration.applyConfig({});
  assert.equal(calls(), 0);
  assert.equal(gladys.fake.connectionStatuses.length, 1);
  assert.equal(gladys.fake.connectionStatuses[0].connected, false);
  assert.match(gladys.fake.connectionStatuses[0].message.en, /Connect your TickTick account/);
  assert.deepEqual(gladys.fake.widgetRefreshes, ['tasks']);
  assert.throws(() => integration.sceneTasksSummary({}), /Connect your TickTick/);
  await assert.rejects(integration.testConnection(), /Connect your TickTick/);
  assert.match(integration.widgetTasks({ language: 'en' }).components[0].text, /Connect/);
});

test('a successful poll reports the connection, nudges the widget and schedules the trigger', async () => {
  const { gladys, integration, timers, clients } = await setup();
  await integration.applyConfig({ oauth_access_token: 'tp', poll_frequency: '60' });
  assert.equal(clients[0].token, 'tp');
  assert.deepEqual(gladys.fake.connectionStatuses, [{ connected: true }]);
  assert.deepEqual(gladys.fake.widgetRefreshes, ['tasks']);
  // The trigger timer (task due at 14:00, in 4 h) and the next poll (60 s).
  assert.deepEqual(
    timers.map(({ delay }) => delay),
    [4 * 3600 * 1000, 60 * 1000],
  );

  // Same tasks: no new nudge, no new status.
  await integration.poll();
  assert.equal(gladys.fake.widgetRefreshes.length, 1);
  assert.equal(gladys.fake.connectionStatuses.length, 1);

  // The trigger fires a scene event.
  await timers[0].fn();
  assert.equal(gladys.fake.sceneEvents.length, 1);
  assert.equal(gladys.fake.sceneEvents[0].key, 'task_due');
  assert.equal(gladys.fake.sceneEvents[0].data.title, 'Buy milk');
});

test('a TickTick outage is reported once, shown in the widget, and polling goes on', async () => {
  const outage = new TickTickError('unreachable', 'down');
  const { gladys, integration, timers } = await setup({
    outcomes: [outage, outage, snapshotOf()],
  });
  await integration.applyConfig({ oauth_access_token: 'tp' });
  await integration.poll();
  assert.equal(gladys.fake.connectionStatuses.length, 1);
  assert.equal(gladys.fake.connectionStatuses[0].connected, false);
  assert.match(integration.widgetTasks({}).components[0].text, /cannot be reached/);
  assert.equal(timers.length, 1);
  assert.throws(() => integration.sceneTasksSummary({}), /cannot be reached/);

  await integration.poll();
  assert.equal(gladys.fake.connectionStatuses.at(-1).connected, true);
  assert.equal(integration.sceneTasksSummary({}).count, 1);
});

test('a refused token suspends polling until a successful test', async () => {
  const { gladys, integration, timers } = await setup({ outcomes: [authError(), snapshotOf()] });
  await integration.applyConfig({ oauth_access_token: 'tp' });
  assert.equal(timers.length, 0);
  assert.match(gladys.fake.connectionStatuses[0].message.fr, /suspendues/);
  assert.equal(integration.poller.stopped, true);

  const message = await integration.testConnection();
  assert.match(message.en, /Connected to TickTick \(1 lists/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.connectionStatuses.at(-1).connected, true);
});

test('testConnection reports a TickTick failure in both languages', async () => {
  const { integration, clients } = await setup();
  await integration.applyConfig({ oauth_access_token: 'tp' });
  clients[0].listProjects = async () => {
    throw authError();
  };
  await assert.rejects(integration.testConnection(), /refused the access.*\/.*refusé/);
});

test('Gladys-side failures during a poll are only logged', async (t) => {
  const { gladys, integration } = await setup();
  const tooManyRequests = async () => {
    throw new GladysApiError(429, 'TOO_MANY_REQUESTS', 'Too Many Requests');
  };
  t.mock.method(gladys, 'setConnectionStatus', tooManyRequests, { times: 1 });
  t.mock.method(
    gladys,
    'requestWidgetRefresh',
    () => {
      throw new Error('refresh failed');
    },
    { times: 1 },
  );
  await integration.applyConfig({ oauth_access_token: 'tp' });
  assert.equal(gladys.fake.connectionStatuses.length, 0);
  assert.equal(gladys.fake.widgetRefreshes.length, 0);
  await integration.poll();
  assert.equal(gladys.fake.connectionStatuses.length, 1);

  t.mock.method(gladys, 'publishSceneEvent', tooManyRequests, { times: 1 });
  await integration.fireTaskDue(task());
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('a poll resolving after a config change publishes nothing', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { gladys, integration } = await setup({ outcomes: [() => pending, snapshotOf([])] });
  const first = integration.applyConfig({ oauth_access_token: 'old' });
  await integration.applyConfig({ oauth_access_token: 'new' });
  release(snapshotOf());
  await first;
  assert.equal(integration.snapshot.tasks.length, 0);
  assert.equal(gladys.fake.connectionStatuses.length, 1);
});

test('OAuth: the authorize URL needs the Client ID, logs a failure and carries a fresh state', async () => {
  const warnings = [];
  const logger = { ...silentLogger, warn: (message) => warnings.push(message) };
  const { integration } = await setup({ config: { client_secret: 'cs' }, deps: { logger } });
  await assert.rejects(integration.oauthAuthorizeUrl('ticktick_account', REDIRECT), /Client ID/);
  // The SDK does not log a handler failure, and Gladys shows a generic error.
  assert.match(warnings[0], /authorize URL.*Client ID/);

  // The secret is only needed for the code exchange.
  const ready = await setup({ config: { client_id: 'cid' } });
  const url = new URL(await ready.integration.oauthAuthorizeUrl('ticktick_account', REDIRECT));
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
});

test('OAuth: the callback needs the Client secret', async () => {
  const { integration, gladys } = await setup({
    config: { client_id: 'cid' },
    deps: { exchangeCode: async () => 'tok' },
  });
  await integration.oauthAuthorizeUrl('ticktick_account', REDIRECT);
  await assert.rejects(
    integration.oauthCallback('ticktick_account', {
      code: 'c',
      state: 'state-1',
      redirectUri: REDIRECT,
    }),
    /Client secret/,
  );
  assert.deepEqual(configWrites(gladys), []);
});

test('OAuth: the callback exchanges the code, stores the token and starts polling', async () => {
  const exchanges = [];
  const { gladys, integration, clients } = await setup({
    config: { client_id: 'cid', client_secret: 'cs' },
    deps: {
      exchangeCode: async (params) => {
        exchanges.push(params);
        return 'oauth-token';
      },
    },
  });
  await integration.oauthAuthorizeUrl('ticktick_account', REDIRECT);
  await integration.oauthCallback('ticktick_account', {
    code: 'code-1',
    state: 'state-1',
    redirectUri: REDIRECT,
  });
  assert.deepEqual(exchanges, [
    { clientId: 'cid', clientSecret: 'cs', code: 'code-1', redirectUri: REDIRECT },
  ]);
  assert.deepEqual(configWrites(gladys), [{ config: { oauth_access_token: 'oauth-token' } }]);
  assert.equal(gladys.fake.config.oauth_access_token, 'oauth-token');
  assert.equal(clients[0].token, 'oauth-token');
  assert.equal(gladys.fake.connectionStatuses.at(-1).connected, true);
});

test('OAuth: a wrong, reused or expired state is refused', async () => {
  const clock = { now: NOW };
  const { integration } = await setup({
    config: { client_id: 'cid', client_secret: 'cs' },
    deps: { now: () => clock.now, exchangeCode: async () => 'tok' },
  });
  const callback = (state) =>
    integration.oauthCallback('ticktick_account', { code: 'c', state, redirectUri: REDIRECT });

  await assert.rejects(callback('state-1'), /expired or does not match/);
  await integration.oauthAuthorizeUrl('ticktick_account', REDIRECT);
  await assert.rejects(callback('forged'), /expired or does not match/);
  // The state is single-use.
  await assert.rejects(callback('state-1'), /expired or does not match/);

  await integration.oauthAuthorizeUrl('ticktick_account', REDIRECT);
  clock.now = new Date(NOW.getTime() + 16 * 60 * 1000);
  await assert.rejects(callback('state-1'), /expired or does not match/);
});

test('OAuth: a refused code exchange is reported in both languages', async () => {
  const { integration, gladys } = await setup({
    config: { client_id: 'cid', client_secret: 'cs' },
    deps: {
      exchangeCode: async () => {
        throw authError();
      },
    },
  });
  await integration.oauthAuthorizeUrl('ticktick_account', REDIRECT);
  await assert.rejects(
    integration.oauthCallback('ticktick_account', {
      code: 'c',
      state: 'state-1',
      redirectUri: REDIRECT,
    }),
    /refused the access/,
  );
  assert.deepEqual(configWrites(gladys), []);
});

test('scene actions: create a task, then refresh; failures are readable', async () => {
  const { integration, clients, calls } = await setup();
  await integration.applyConfig({ oauth_access_token: 'tp' });
  const outputs = await integration.sceneCreateTask({ title: 'Buy bread', list_name: 'groceries' });
  assert.deepEqual(outputs, { task_id: 'new-id', list_name: 'Groceries' });
  assert.equal(clients[0].created[0].projectId, 'p-groceries');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls(), 2);

  clients[0].createTask = async () => {
    throw new TickTickError('rate_limited', 'x', { status: 429 });
  };
  await assert.rejects(integration.sceneCreateTask({ title: 'x' }), /limits the number/);
  await assert.rejects(integration.sceneCreateTask({ title: ' ' }), /empty/);
});

const formValues = (values = {}) => ({
  values: { title: 'Buy bread', due: 'none', priority: 'none', list: 'inbox', ...values },
});

test('widget Add task: creates the task typed in the form, in the list picked by id', async () => {
  const { integration, clients, calls } = await setup();
  await integration.applyConfig({ oauth_access_token: 'tp' });
  const toast = await integration.widgetAction(
    'add_task',
    {},
    formValues({ title: ' Buy bread ', due: 'tomorrow', priority: 'high', list: 'p-groceries' }),
  );
  assert.deepEqual(toast, {
    en: 'Task added to Groceries.',
    fr: 'Tâche ajoutée dans Groceries.',
  });
  assert.deepEqual(clients[0].created, [
    {
      title: 'Buy bread',
      projectId: 'p-groceries',
      priority: 5,
      // Tomorrow, all day, in the local time zone (Europe/Paris).
      startDate: '2026-10-09T22:00:00+0000',
      dueDate: '2026-10-09T22:00:00+0000',
      isAllDay: true,
      timeZone: 'Europe/Paris',
    },
  ]);
  // The new task shows up without waiting for the next period.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls(), 2);
});

test('widget Add task: the inbox by default, and when the picked list is gone', async () => {
  const { integration, clients } = await setup();
  await integration.applyConfig({ oauth_access_token: 'tp' });
  const toast = await integration.widgetAction('add_task', {}, formValues());
  assert.deepEqual(toast, {
    en: 'Task added to Inbox.',
    fr: 'Tâche ajoutée dans Boîte de réception.',
  });
  await integration.widgetAction('add_task', {}, formValues({ list: 'p-deleted' }));
  assert.deepEqual(
    clients[0].created.map((payload) => [payload.projectId, payload.priority, payload.dueDate]),
    [
      ['inbox1', 0, undefined],
      ['inbox1', 0, undefined],
    ],
  );
});

test('widget Add task: no values (Gladys < 5.2.0) or an empty title create nothing', async () => {
  const { integration, clients, calls } = await setup();
  await integration.applyConfig({ oauth_access_token: 'tp' });
  const older = await integration.widgetAction('add_task', {}, { settings: {} });
  assert.match(older.en, /needs Gladys 5\.2\.0/);
  assert.match(older.fr, /nécessite Gladys 5\.2\.0/);
  for (const title of ['', '   ', undefined]) {
    const empty = await integration.widgetAction('add_task', {}, formValues({ title }));
    assert.match(empty.en, /Enter a title/);
  }
  assert.deepEqual(clients[0].created, []);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls(), 1);
});

test('widget Add task: a TickTick failure or a missing account is a readable failure', async () => {
  const { integration, clients } = await setup();
  await assert.rejects(integration.widgetAction('add_task', {}, formValues()), /Connect your/);
  await integration.applyConfig({ oauth_access_token: 'tp' });
  clients[0].createTask = async () => {
    throw authError();
  };
  await assert.rejects(
    integration.widgetAction('add_task', {}, formValues()),
    /TickTick refused the access.* \/ TickTick a refusé/,
  );
  clients[0].createTask = async () => {
    throw new Error('boom');
  };
  await assert.rejects(integration.widgetAction('add_task', {}, formValues()), /boom/);
  await assert.rejects(integration.widgetAction('mark_done', {}, formValues()), /Unknown/);
});

test('widget Add task through the SDK: toast on success, failed ack on error', async () => {
  const gladys = createFakeGladys();
  const created = [];
  const client = {
    async createTask(payload) {
      created.push(payload);
      return { id: 'new-id' };
    },
  };
  const integration = new TickTickIntegration(gladys, {
    createClient: () => client,
    fetchSnapshot: async () => snapshotOf(),
    logger: silentLogger,
    now: () => NOW,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  gladys.onWidgetGet('tasks', (options) => integration.widgetTasks(options));
  gladys.onWidgetAction('tasks', (actionKey, params, options) =>
    integration.widgetAction(actionKey, params, options),
  );
  await integration.applyConfig({ oauth_access_token: 'tp' });

  const got = await gladys.fake.widgetGet('tasks', { settings: {}, language: 'en' });
  const button = got.data.content.components.at(-1);
  assert.equal(button.action.key, 'add_task');

  const ok = await gladys.fake.widgetAction('tasks', 'add_task', {}, formValues({ title: 'Milk' }));
  assert.deepEqual(ok, {
    success: true,
    data: { message: { en: 'Task added to Inbox.', fr: 'Tâche ajoutée dans Boîte de réception.' } },
  });
  assert.equal(created[0].title, 'Milk');

  const older = await gladys.fake.widgetAction('tasks', 'add_task', {}, { settings: {} });
  assert.equal(older.success, true);
  assert.match(older.data.message.en, /needs Gladys 5\.2\.0/);
  assert.equal(created.length, 1);

  client.createTask = async () => {
    throw new TickTickError('rate_limited', 'x', { status: 429 });
  };
  const failed = await gladys.fake.widgetAction('tasks', 'add_task', {}, formValues());
  assert.equal(failed.success, false);
  assert.match(failed.error, /limits the number/);
});

test('the widget and the summary read the last snapshot', async () => {
  const { integration } = await setup();
  await integration.applyConfig({ oauth_access_token: 'tp' });
  const content = integration.widgetTasks({ settings: { scope: 'today' }, language: 'fr' });
  assert.equal(content.components[2].items[0].title, 'Buy milk');
  assert.equal(integration.widgetTasks().components[2].items.length, 1);
  assert.deepEqual(integration.sceneTasksSummary({ scope: 'today' }).count, 1);
});

test('bilingual joins both languages', () => {
  assert.equal(bilingual({ en: 'A', fr: 'B' }), 'A / B');
});
