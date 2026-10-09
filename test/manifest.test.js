// -----------------------------------------------------------------------------
// The manifest and the code state some facts twice (config defaults, widget,
// trigger and scene action keys, option lists, event and output keys).
// Nothing links them at runtime, and a divergence fails at the worst possible
// moment. These tests are that link.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG, OAUTH_TOKEN_KEY, POLL_FREQUENCY_OPTIONS } from '../src/config.js';
import { OAUTH_FIELD_KEY } from '../src/oauth.js';
import { TASKS_WIDGET_KEY } from '../src/widgets.js';
import { SCOPES, DEFAULT_SCOPE } from '../src/tasks.js';
import {
  CREATE_TASK_KEY,
  DUE_OPTIONS,
  PRIORITY_OPTIONS,
  TASKS_SUMMARY_KEY,
  buildTasksSummary,
} from '../src/scene-actions.js';
import { TASK_DUE_KEY, buildTaskDueEventData } from '../src/scene-events.js';
import { PRIORITIES } from '../src/ticktick/snapshot.js';
import { task } from './fixtures/ticktick.js';

// The Gladys release that ships the provider type, the dashboard widgets and
// the scene triggers/actions this integration is made of.
const MIN_GLADYS_VERSION = '>=5.1.0';
// INTEGRATION_CATALOG_CATEGORIES in the core. The manifest schema has no enum
// (an unknown key is dropped with a warning), so a typo here would silently
// land the integration in the uncategorized bucket.
const CATALOG_CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
];

const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));

const manifest = readJson('gladys-assistant-integration.json');
const pkg = readJson('package.json');
const configField = (key) => manifest.config_schema.find((entry) => entry.key === key);
const sceneAction = (key) => manifest.scene_actions.find((entry) => entry.key === key);
const values = (field) => field.options.map((option) => option.value);

test('the manifest version matches package.json and the image tag', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/cicoub13/gladys-ticktick:${manifest.version}`);
});

test('the manifest is a provider integration on the Gladys release that ships its capabilities', () => {
  assert.equal(manifest.type, 'provider');
  assert.equal(manifest.gladys_version, MIN_GLADYS_VERSION);
  assert.deepEqual(manifest.transports, ['cloud']);
});

test('the name and descriptions fit the store limits', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${language} is ${text.length} chars`,
    );
  }
  for (const widget of manifest.widgets) {
    for (const text of Object.values(widget.description)) {
      assert.ok(text.length <= 100, `widget description "${text}"`);
    }
  }
});

test('the catalog categories are declared and come from the core vocabulary', () => {
  assert.ok(manifest.categories?.length >= 1 && manifest.categories.length <= 3);
  for (const category of manifest.categories) {
    assert.ok(CATALOG_CATEGORIES.includes(category), `unknown catalog category: ${category}`);
  }
});

test('no permission is requested that the integration does not use', () => {
  for (const key of ['location', 'network_wake', 'network_discovery', 'containers', 'webhooks']) {
    assert.equal(manifest[key], undefined, `${key} is declared but unused`);
  }
});

test('credentials are secrets, the account is an oauth2 field, the token stays off-schema', () => {
  assert.equal(configField('client_id').type, 'string');
  assert.equal(configField('client_secret').type, 'secret');
  assert.equal(configField(OAUTH_FIELD_KEY).type, 'oauth2');
  assert.equal(configField(OAUTH_TOKEN_KEY), undefined);
});

test('the reminder to save comes right before the Connect button', () => {
  // The Connect button does not save the form, and the integration only sees
  // saved values: the reminder must sit where the user is about to click.
  const keys = manifest.config_schema.map((entry) => entry.key);
  assert.equal(keys[keys.indexOf(OAUTH_FIELD_KEY) - 1], 'save_before_connect');
  assert.ok(keys.indexOf('client_secret') < keys.indexOf('save_before_connect'));
});

test('sections hold no value and only https links', () => {
  for (const section of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    for (const key of ['required', 'default', 'placeholder']) {
      assert.equal(section[key], undefined, `${section.key}.${key}`);
    }
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
    for (const text of Object.values(section.description)) {
      assert.ok(text.length <= 1000, `${section.key} description is too long`);
    }
  }
});

test('the config defaults and options are the ones the code falls back to', () => {
  const pollFrequency = configField('poll_frequency');
  assert.deepEqual(values(pollFrequency).map(Number), POLL_FREQUENCY_OPTIONS);
  assert.equal(Number(pollFrequency.default), DEFAULT_CONFIG.poll_frequency);
  const allDayHour = configField('all_day_hour');
  assert.equal(allDayHour.default, DEFAULT_CONFIG.all_day_hour);
  assert.deepEqual([allDayHour.min, allDayHour.max], [0, 23]);
});

test('the widget, trigger, scene action and action keys are the ones the code registers', () => {
  // The SDK routes every widget.get / scene-action.run by key: a key declared
  // here but registered under another name reaches no handler at all.
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    [TASKS_WIDGET_KEY],
  );
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key),
    [TASK_DUE_KEY],
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key),
    [CREATE_TASK_KEY, TASKS_SUMMARY_KEY],
  );
  assert.deepEqual(
    manifest.actions.map((action) => action.key),
    ['test_connection'],
  );
});

test('index.js registers a handler for every declared widget, scene action, action and OAuth step', () => {
  const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(index, /onWidgetGet\(TASKS_WIDGET_KEY/);
  assert.match(index, /onSceneAction\(CREATE_TASK_KEY/);
  assert.match(index, /onSceneAction\(TASKS_SUMMARY_KEY/);
  assert.match(index, /onAction\('test_connection'/);
  assert.match(index, /onOAuthAuthorizeUrl\(/);
  assert.match(index, /onOAuthCallback\(/);
});

test('the scope options of the widget and the summary action are the code scopes', () => {
  const widgetScope = manifest.widgets[0].settings.find((entry) => entry.key === 'scope');
  const actionScope = sceneAction(TASKS_SUMMARY_KEY).fields.find((entry) => entry.key === 'scope');
  for (const field of [widgetScope, actionScope]) {
    assert.deepEqual(values(field), SCOPES);
    assert.equal(field.default, DEFAULT_SCOPE);
  }
});

test('the create_task options are the ones the code reads', () => {
  const fields = sceneAction(CREATE_TASK_KEY).fields;
  const field = (key) => fields.find((entry) => entry.key === key);
  assert.deepEqual(values(field('due')), DUE_OPTIONS);
  assert.deepEqual(values(field('priority')), Object.keys(PRIORITY_OPTIONS));
  assert.equal(field('title').required, true);
  // A required field added later without a default would break existing scenes.
  for (const entry of fields.filter((item) => item.key !== 'title')) {
    assert.notEqual(entry.required, true, entry.key);
  }
  assert.deepEqual(
    sceneAction(CREATE_TASK_KEY).outputs.map((output) => output.key),
    ['task_id', 'list_name'],
  );
});

test('the task_due trigger declares exactly the keys the event carries', () => {
  const [trigger] = manifest.scene_triggers;
  const data = buildTaskDueEventData(task());
  assert.deepEqual(
    trigger.variables.map((variable) => variable.key).sort(),
    Object.keys(data).sort(),
  );
  for (const field of trigger.fields) {
    assert.ok(Object.hasOwn(data, field.key), `filter ${field.key} is not in the event`);
  }
  const priority = trigger.fields.find((field) => field.key === 'priority');
  assert.deepEqual(values(priority), Object.values(PRIORITIES));
  for (const variable of trigger.variables) {
    assert.equal(variable.type, typeof data[variable.key], variable.key);
  }
});

test('the tasks_summary outputs are exactly the keys the action can return', () => {
  const outputs = sceneAction(TASKS_SUMMARY_KEY).outputs;
  const result = buildTasksSummary([task()], { scope: 'week' }, new Date('2026-10-09T08:00:00Z'));
  assert.deepEqual(outputs.map((output) => output.key).sort(), Object.keys(result).sort());
  for (const output of outputs) {
    assert.equal(output.type, typeof result[output.key], output.key);
  }
});

test('every label shown to the user is translated (en + fr)', () => {
  const labeledEntries = [
    ...manifest.config_schema,
    ...manifest.actions,
    ...manifest.widgets.flatMap((widget) => [widget, ...(widget.settings ?? [])]),
    ...manifest.scene_triggers.flatMap((trigger) => [
      trigger,
      ...trigger.fields,
      ...trigger.variables,
    ]),
    ...manifest.scene_actions.flatMap((action) => [action, ...action.fields, ...action.outputs]),
  ];
  const options = labeledEntries.flatMap((entry) => entry.options ?? []);
  for (const entry of [...labeledEntries, ...options]) {
    assert.ok(entry.label.en, `missing English label on ${JSON.stringify(entry)}`);
    assert.ok(entry.label.fr, `missing French label on ${JSON.stringify(entry)}`);
  }
});

test('widget labels fit the 3-30 characters the core accepts', () => {
  for (const widget of manifest.widgets) {
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, `widget label "${text}"`);
    }
  }
});
