import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCOPES, TOKEN_URL, buildAuthorizeUrl, exchangeCode } from '../src/oauth.js';
import { fakeFetch } from './fixtures/ticktick.js';

const REDIRECT = 'https://my.gladysassistant.com/redirect/oauth';

test('buildAuthorizeUrl carries the client id, scopes, state and redirect URI as given', () => {
  const url = new URL(buildAuthorizeUrl({ clientId: 'cid', redirectUri: REDIRECT, state: 's1' }));
  assert.equal(url.origin + url.pathname, 'https://ticktick.com/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('scope'), SCOPES);
  assert.equal(url.searchParams.get('state'), 's1');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(url.searchParams.get('response_type'), 'code');
});

const exchange = (route) => {
  const fetchImpl = fakeFetch({ 'POST /oauth/token': route });
  const promise = exchangeCode({
    clientId: 'cid',
    clientSecret: 'csecret',
    code: 'the-code',
    redirectUri: REDIRECT,
    fetchImpl,
  });
  return { promise, fetchImpl };
};

test('exchangeCode sends Basic auth and the same redirect URI, and returns the token', async () => {
  const { promise, fetchImpl } = exchange({ body: { access_token: 'tok', token_type: 'bearer' } });
  assert.equal(await promise, 'tok');
  const [request] = fetchImpl.requests;
  assert.equal(request.url, TOKEN_URL);
  assert.equal(
    request.headers.Authorization,
    `Basic ${Buffer.from('cid:csecret').toString('base64')}`,
  );
  const body = new URLSearchParams(request.body);
  assert.equal(body.get('code'), 'the-code');
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('redirect_uri'), REDIRECT);
  assert.equal(body.get('scope'), SCOPES);
});

test('exchangeCode turns a refused code or secret into an auth error', async () => {
  await assert.rejects(exchange({ status: 400, body: { error: 'invalid_grant' } }).promise, {
    kind: 'auth',
  });
  await assert.rejects(exchange({ status: 401, body: '' }).promise, { kind: 'auth' });
  await assert.rejects(exchange({ status: 503, body: '' }).promise, { kind: 'http' });
});

test('exchangeCode rejects an answer without an access token', async () => {
  await assert.rejects(exchange({ body: { token_type: 'bearer' } }).promise, {
    kind: 'invalid_response',
  });
  await assert.rejects(exchange({ body: 'not json' }).promise, { kind: 'invalid_response' });
});

test('exchangeCode classifies network failures', async () => {
  await assert.rejects(
    exchangeCode({
      clientId: 'cid',
      clientSecret: 'csecret',
      code: 'c',
      redirectUri: REDIRECT,
      fetchImpl: async () => {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      },
    }),
    { kind: 'unreachable', code: 'ECONNRESET' },
  );
});
