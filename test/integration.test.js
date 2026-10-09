import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TickTickIntegration, bilingual } from '../src/integration.js';
import { TickTickError } from '../src/ticktick/client.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
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
 * An integration on a fake Gladys. `outcomes` scripts fetchSnapshot: a
 * snapshot to resolve or an Error to throw, one per call (the last one repeats).
 */
function setup({ config = {}, outcomes = [snapshotOf()], deps = {} } = {}) {
  const gladys = createFakeGladys(config);
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

test('without any token the integration asks to connect and does not poll', async () => {
  const { gladys, integration, calls } = setup({ config: {} });
  await integration.applyConfig({});
  assert.equal(calls(), 0);
  assert.equal(gladys.calls.connectionStatuses.length, 1);
  assert.equal(gladys.calls.connectionStatuses[0].connected, false);
  assert.match(gladys.calls.connectionStatuses[0].message.en, /Connect your TickTick account/);
  assert.deepEqual(gladys.calls.widgetRefreshes, ['tasks']);
  assert.throws(() => integration.sceneTasksSummary({}), /Connect your TickTick/);
  await assert.rejects(integration.testConnection(), /Connect your TickTick/);
  assert.match(integration.widgetTasks({ language: 'en' }).components[0].text, /Connect/);
});

test('a successful poll reports the connection, nudges the widget and schedules the trigger', async () => {
  const { gladys, integration, timers, clients } = setup();
  await integration.applyConfig({ api_token: 'tp', poll_frequency: '60' });
  assert.equal(clients[0].token, 'tp');
  assert.deepEqual(gladys.calls.connectionStatuses, [{ connected: true, message: undefined }]);
  assert.deepEqual(gladys.calls.widgetRefreshes, ['tasks']);
  // The trigger timer (task due at 14:00, in 4 h) and the next poll (60 s).
  assert.deepEqual(
    timers.map(({ delay }) => delay),
    [4 * 3600 * 1000, 60 * 1000],
  );

  // Same tasks: no new nudge, no new status.
  await integration.poll();
  assert.equal(gladys.calls.widgetRefreshes.length, 1);
  assert.equal(gladys.calls.connectionStatuses.length, 1);

  // The trigger fires a scene event.
  await timers[0].fn();
  assert.equal(gladys.calls.sceneEvents.length, 1);
  assert.equal(gladys.calls.sceneEvents[0].key, 'task_due');
  assert.equal(gladys.calls.sceneEvents[0].data.title, 'Buy milk');
});

test('a TickTick outage is reported once, shown in the widget, and polling goes on', async () => {
  const outage = new TickTickError('unreachable', 'down');
  const { gladys, integration, timers } = setup({
    outcomes: [outage, outage, snapshotOf()],
  });
  await integration.applyConfig({ api_token: 'tp' });
  await integration.poll();
  assert.equal(gladys.calls.connectionStatuses.length, 1);
  assert.equal(gladys.calls.connectionStatuses[0].connected, false);
  assert.match(integration.widgetTasks({}).components[0].text, /cannot be reached/);
  assert.equal(timers.length, 1);
  assert.throws(() => integration.sceneTasksSummary({}), /cannot be reached/);

  await integration.poll();
  assert.equal(gladys.calls.connectionStatuses.at(-1).connected, true);
  assert.equal(integration.sceneTasksSummary({}).count, 1);
});

test('a refused OAuth token falls back to the API token right away', async () => {
  const { gladys, integration, clients } = setup({
    outcomes: [(client) => (client.token === 'oauth' ? Promise.reject(authError()) : snapshotOf())],
  });
  await integration.applyConfig({ oauth_access_token: 'oauth', api_token: 'tp' });
  assert.deepEqual(
    clients.map((client) => client.token),
    ['oauth', 'tp'],
  );
  assert.deepEqual(gladys.calls.connectionStatuses, [{ connected: true, message: undefined }]);
});

test('a refused last token suspends polling until a successful test', async () => {
  const { gladys, integration, timers } = setup({ outcomes: [authError(), snapshotOf()] });
  await integration.applyConfig({ api_token: 'tp' });
  assert.equal(timers.length, 0);
  assert.match(gladys.calls.connectionStatuses[0].message.fr, /suspendues/);
  assert.equal(integration.poller.stopped, true);

  const message = await integration.testConnection();
  assert.match(message.en, /Connected to TickTick \(1 lists/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.calls.connectionStatuses.at(-1).connected, true);
});

test('testConnection reports a TickTick failure in both languages', async () => {
  const { integration, clients } = setup();
  await integration.applyConfig({ api_token: 'tp' });
  clients[0].listProjects = async () => {
    throw authError();
  };
  await assert.rejects(integration.testConnection(), /refused the access.*\/.*refusé/);
});

test('Gladys-side failures during a poll are only logged', async () => {
  const { gladys, integration } = setup();
  gladys.failNext('setConnectionStatus', 1);
  gladys.failNext('requestWidgetRefresh', 1);
  await integration.applyConfig({ api_token: 'tp' });
  assert.equal(gladys.calls.connectionStatuses.length, 0);
  await integration.poll();
  assert.equal(gladys.calls.connectionStatuses.length, 1);

  gladys.failNext('publishSceneEvent', 1);
  await integration.fireTaskDue(task());
  assert.equal(gladys.calls.sceneEvents.length, 0);
});

test('a poll resolving after a config change publishes nothing', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { gladys, integration } = setup({ outcomes: [() => pending, snapshotOf([])] });
  const first = integration.applyConfig({ api_token: 'old' });
  await integration.applyConfig({ api_token: 'new' });
  release(snapshotOf());
  await first;
  assert.equal(integration.snapshot.tasks.length, 0);
  assert.equal(gladys.calls.connectionStatuses.length, 1);
});

test('OAuth: the authorize URL needs the client credentials and carries a fresh state', async () => {
  const { integration } = setup({ config: { client_id: 'cid' } });
  await assert.rejects(integration.oauthAuthorizeUrl('ticktick_account', REDIRECT), /Client ID/);

  const ready = setup({ config: { client_id: 'cid', client_secret: 'cs' } });
  const url = new URL(await ready.integration.oauthAuthorizeUrl('ticktick_account', REDIRECT));
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
});

test('OAuth: the callback exchanges the code, stores the token and starts polling', async () => {
  const exchanges = [];
  const { gladys, integration, clients } = setup({
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
  assert.deepEqual(gladys.calls.setConfigs, [{ oauth_access_token: 'oauth-token' }]);
  assert.equal(clients[0].token, 'oauth-token');
  assert.equal(gladys.calls.connectionStatuses.at(-1).connected, true);
});

test('OAuth: a wrong, reused or expired state is refused', async () => {
  const clock = { now: NOW };
  const { integration } = setup({
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
  const { integration, gladys } = setup({
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
  assert.equal(gladys.calls.setConfigs.length, 0);
});

test('scene actions: create a task, then refresh; failures are readable', async () => {
  const { integration, clients, calls } = setup();
  await integration.applyConfig({ api_token: 'tp' });
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

test('the widget and the summary read the last snapshot', async () => {
  const { integration } = setup();
  await integration.applyConfig({ api_token: 'tp' });
  const content = integration.widgetTasks({ settings: { scope: 'today' }, language: 'fr' });
  assert.equal(content.components[2].items[0].title, 'Buy milk');
  assert.equal(integration.widgetTasks().components[2].items.length, 1);
  assert.deepEqual(integration.sceneTasksSummary({ scope: 'today' }).count, 1);
});

test('bilingual joins both languages', () => {
  assert.equal(bilingual({ en: 'A', fr: 'B' }), 'A / B');
});
