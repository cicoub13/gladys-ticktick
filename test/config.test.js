import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, listTokens, normalizeConfig } from '../src/config.js';

test('normalizeConfig falls back to the defaults on a missing or null config', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
});

test('normalizeConfig trims strings and coerces the select and number values', () => {
  const config = normalizeConfig({
    client_id: ' id ',
    client_secret: ' secret ',
    api_token: ' tp_1 ',
    poll_frequency: '60',
    all_day_hour: '7',
    oauth_access_token: ' oauth ',
  });
  assert.deepEqual(config, {
    client_id: 'id',
    client_secret: 'secret',
    api_token: 'tp_1',
    poll_frequency: 60,
    all_day_hour: 7,
    oauth_access_token: 'oauth',
  });
});

test('normalizeConfig snaps unknown frequencies and out-of-range hours back to the defaults', () => {
  const config = normalizeConfig({ poll_frequency: '5', all_day_hour: 24, client_id: 42 });
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.equal(config.all_day_hour, DEFAULT_CONFIG.all_day_hour);
  assert.equal(config.client_id, '');
  assert.equal(normalizeConfig({ all_day_hour: 7.5 }).all_day_hour, DEFAULT_CONFIG.all_day_hour);
  assert.equal(normalizeConfig({ all_day_hour: 0 }).all_day_hour, 0);
});

test('listTokens puts the OAuth token before the API token', () => {
  assert.deepEqual(listTokens(normalizeConfig({ api_token: 'b', oauth_access_token: 'a' })), [
    { source: 'oauth', token: 'a' },
    { source: 'api_token', token: 'b' },
  ]);
  assert.deepEqual(listTokens(normalizeConfig({ api_token: 'b' })), [
    { source: 'api_token', token: 'b' },
  ]);
  assert.deepEqual(listTokens(normalizeConfig({})), []);
});
