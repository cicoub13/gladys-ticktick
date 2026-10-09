import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TickTickClient, TickTickError, describeError } from '../src/ticktick/client.js';
import { fakeFetch, project } from './fixtures/ticktick.js';

const TOKEN = 'secret-token-123';

const clientWith = (routes) => {
  const fetchImpl = fakeFetch(routes);
  return { client: new TickTickClient({ token: TOKEN, fetchImpl }), fetchImpl };
};

test('requests carry the Bearer token and parse the JSON answer', async () => {
  const { client, fetchImpl } = clientWith({ 'GET /project': { body: [project()] } });
  assert.deepEqual(await client.listProjects(), [project()]);
  const [request] = fetchImpl.requests;
  assert.equal(request.url, 'https://api.ticktick.com/open/v1/project');
  assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(request.signal);
});

test('getProjectData escapes the id in the path, an empty body reads as undefined', async () => {
  const { client } = clientWith({
    'GET /project/inbox/data': { body: { tasks: [] } },
    'GET /project/p%201%2F2/data': { body: '' },
  });
  assert.deepEqual(await client.getProjectData('inbox'), { tasks: [] });
  assert.equal(await client.getProjectData('p 1/2'), undefined);
});

test('createTask posts the task as JSON', async () => {
  const { client, fetchImpl } = clientWith({
    'POST /task': (init) => ({ body: { id: 'new', ...JSON.parse(init.body) } }),
  });
  const created = await client.createTask({ title: 'Buy milk', projectId: 'inbox' });
  assert.equal(created.id, 'new');
  assert.equal(fetchImpl.requests[0].headers['Content-Type'], 'application/json');
});

test('HTTP statuses map to error kinds', async () => {
  const cases = [
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'http'],
  ];
  for (const [status, kind] of cases) {
    const { client } = clientWith({ 'GET /project': { status, body: 'nope' } });
    await assert.rejects(client.listProjects(), (err) => {
      assert.ok(err instanceof TickTickError);
      assert.equal(err.kind, kind);
      assert.equal(err.status, status);
      return true;
    });
  }
});

test('a non-JSON answer is an invalid_response', async () => {
  const { client } = clientWith({ 'GET /project': { body: '<html>' } });
  await assert.rejects(client.listProjects(), { kind: 'invalid_response' });
});

test('network failures and timeouts are classified without leaking the token', async () => {
  const unreachable = new TickTickClient({
    token: TOKEN,
    fetchImpl: async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND', token: TOKEN } });
    },
  });
  await assert.rejects(unreachable.listProjects(), (err) => {
    assert.equal(err.kind, 'unreachable');
    assert.equal(err.code, 'ENOTFOUND');
    assert.equal(err.cause, undefined);
    assert.ok(!JSON.stringify({ ...err, message: err.message }).includes(TOKEN));
    return true;
  });

  const timeout = new TickTickClient({
    token: TOKEN,
    fetchImpl: async () => {
      const err = new Error('timed out');
      err.name = 'TimeoutError';
      throw err;
    },
  });
  await assert.rejects(timeout.listProjects(), { kind: 'timeout' });

  const bare = new TickTickClient({
    token: TOKEN,
    fetchImpl: async () => {
      throw new Error('boom');
    },
  });
  await assert.rejects(bare.listProjects(), (err) => err.kind === 'unreachable' && !err.code);
});

test('the client never exposes the token through its properties', () => {
  const client = new TickTickClient({ token: TOKEN, fetchImpl: async () => {} });
  assert.ok(!JSON.stringify(client).includes(TOKEN));
});

test('describeError has a bilingual message for every kind', () => {
  const kinds = [
    'auth',
    'timeout',
    'not_found',
    'rate_limited',
    'http',
    'invalid_response',
    'unreachable',
  ];
  for (const kind of kinds) {
    const message = describeError(new TickTickError(kind, 'x', { status: 500 }));
    assert.ok(message.en && message.fr, kind);
  }
  assert.match(describeError(new Error('other')).en, /Unexpected/);
  assert.match(describeError(new TickTickError('http', 'x', { status: 502 })).fr, /502/);
});
