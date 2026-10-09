# AGENTS.md: gladys-ticktick

Project-specific notes. Generic rules (SDK contract, commands, kit-owned files, runtime) are in
`CLAUDE.md`; the module tree and user-facing features are in `README.md`.

## Data flow

- `index.js` -> `TickTickIntegration` (`src/integration.js`) holds everything: `client`,
  `poller`, last `snapshot`, `lastError` ({en, fr}), `oauthState`, `scheduler`
  (`TaskDueScheduler`), `fingerprint` of the tasks last shown.
- `applyConfig()` resets all state, bumps `generation`, builds a client for the OAuth token,
  starts a `Poller`. A poll whose `generation` is stale when it resolves publishes nothing.
- `poll()`: `fetchSnapshot()` -> `scheduler.reschedule()` -> `requestWidgetRefresh('tasks')` only
  when the fingerprint changed or after a failure -> `reportConnection(true)`. Never throws.
- Provider type: no device, no state published. The widget and `tasks_summary` read the last
  snapshot (no API call); `create_task` writes, then `poller.refreshNow()`.

## Auth

- OAuth only (a personal API token path existed briefly and was dropped before the first
  release). The token is `oauth_access_token`, stored by `setConfig` under a key OUTSIDE
  `config_schema`, never shown in the UI. An `auth` failure stops polling until a config
  change, a new OAuth connection or a successful `test_connection`.
- OAuth2 (`src/oauth.js`): authorize `https://ticktick.com/oauth/authorize`, token
  `POST https://ticktick.com/oauth/token` (form-urlencoded, client id/secret in HTTP Basic),
  scopes `tasks:read tasks:write`. The `redirectUri` comes from Gladys and is reused byte for
  byte; never hardcode it. TickTick documents no refresh token nor `expires_in` (community:
  about 6 months), so there is no refresh: on 401 the user reconnects.
- `oauthState` is in memory, single-use, 15 min TTL: a restart between Connect and the callback
  means clicking Connect again.
- **The Connect button of Gladys does not save the form**, and the authorize handler can only
  read the saved config (`getConfig()`): a Client ID typed but not saved is invisible. Hence the
  `save_before_connect` section right above the `oauth2` field (`test/manifest.test.js` keeps
  it there) and the "No saved Client ID" message. Only the Client ID is needed for the URL; the
  secret is checked on the callback.
- The SDK does not log a failing handler and Gladys shows a generic "error starting the
  connection": `logOAuthFailure` logs every OAuth failure in the integration logs.
- TickTick refuses the authorize step ("At least one redirect_uri must be registered with the
  client") when the developer app has no OAuth redirect URL.
- `setConfig` from the integration is NOT echoed as `config-updated` by Gladys, hence the
  explicit `applyConfig` at the end of `oauthCallback`.
- Verified on a real account (2026-10-09): the full OAuth round trip through
  `my.gladysassistant.com` (TickTick accepts the long wrapped `state`) and the widget.

## TickTick API (`src/ticktick/client.js`)

- Base `https://api.ticktick.com/open/v1`, Bearer token, docs
  https://developer.ticktick.com/docs#/openapi. No documented rate limit: lists are read one at
  a time, default period 5 min.
- Reads: `GET /project` (keep `kind == TASK`, not `closed`), `GET /project/{id}/data` (undone
  tasks only), `GET /project/inbox/data` for the inbox (not in `/project`; a 404 there means no
  inbox tasks, anything else fails the poll). Writes: `POST /task` only.
- `TickTickError.kind`: `unreachable` | `timeout` | `auth` (401/403) | `not_found` |
  `rate_limited` (429) | `http` | `invalid_response`. `describeError()` -> {en, fr}. The token
  lives in a private field and never reaches an error; `test/client.test.js` asserts it.
- Dates are `yyyy-MM-dd'T'HH:mm:ssZ` with `+0000` (no colon): `parseTickTickDate` /
  `formatTickTickDate` in `snapshot.js`. Task `status` 0 undone, 2 done, -1 abandoned;
  `priority` 0/1/3/5 (`PRIORITIES`).
- All-day tasks store the midnight of their day in the task's `timeZone`: their `dueDay` is read
  in that zone, timed tasks' in the Gladys `TZ`. `create_task` writes all-day dates at local
  midnight with `isAllDay: true` and the Gladys `timeZone`, `startDate` = `dueDate`.

## Scenes and widget: keys are forever

- Widget `tasks` (setting `scope`), trigger `task_due` (filters `priority`, `list_name`),
  actions `create_task` and `tasks_summary`, action `test_connection`. Never rename a key,
  an option value or a variable/output key; never add a required field without a default.
- `SCOPES` (`src/tasks.js`), `DUE_OPTIONS` / `PRIORITY_OPTIONS` (`src/scene-actions.js`) and
  `PRIORITIES` must equal the manifest options in the same order (`test/manifest.test.js`).
- Scene values are language-neutral (no language in a scene): `HH:MM`, `YYYY-MM-DD`, priority
  codes, `Inbox` for the inbox. The widget is written in the viewer's language.
- `task_due` fires at the due time (timed) or `all_day_hour` (all-day), only for tasks due
  within 24 h at the last poll; never late after a restart; at most once per task and due time
  (`fired` map, pruned after a day).
- A card-list row cannot carry a button: no "complete" from the widget.

## Tests

- `test/helpers/fakeGladys.js` records calls; `failNext(method, n)` simulates host 429s.
- `test/fixtures/ticktick.js`: raw API factories, normalized `task()` and a route-table
  `fakeFetch`. `test/integration.test.js` injects `createClient`, a scripted `fetchSnapshot`
  (outcomes list), `exchangeCode`, clock, state generator and timers.
- Time-dependent tests pin `Europe/Paris` (explicit `timeZone` or `process.env.TZ`) and
  `2026-10-09T08:00:00Z` (10:00 in Paris).
- `test/widgets.test.js` asserts `validateWidgetContent(content)` is empty.
- `npm run coverage`: lines 90 %, branches/functions 85 % (needs Node >= 22.8).
