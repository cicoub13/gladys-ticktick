# TickTick — Gladys Assistant external integration

Bring your [TickTick](https://ticktick.com) tasks into
[Gladys Assistant](https://gladysassistant.com): a dashboard widget, scene
actions to create and list tasks, and a scene trigger when a task is due.
Built as an external integration running in its own container, on the
JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

> **Requires Gladys ≥ 5.1.0** (provider integrations, dashboard widgets and
> scene triggers/actions). `gladys_version` in the manifest declares that floor.

## Features

- **Connection** through OAuth2 (a TickTick developer app, the **Connect**
  button of Gladys) or a personal API token; the token takes over when TickTick
  refuses the OAuth access.
- **TickTick tasks** widget: overdue / today counters and up to 8 tasks with
  their list, due time, priority, notes and a link to TickTick. Scope per
  widget: today and overdue, today, overdue, next 7 days.
- **TickTick task due** scene trigger, at the due time of a task (or at a
  configurable hour for all-day tasks), filterable by priority and list.
- **Create a TickTick task** scene action: title, list (by name, inbox by
  default), today or tomorrow with an optional time, priority.
- **Get TickTick tasks** scene action: count and titles of the tasks of a
  scope, for a notification or a voice message.
- Polling every 1, 5 or 15 minutes; the widget is only nudged when the tasks
  changed, and polling stops after a refused access until the user reconnects.

## Install

- **From Gladys**: install **TickTick** from the integration store (Gladys
  5.1.0 or later), then follow the configuration screen.
- **Development**: run it outside Docker against a local Gladys, see
  [Run locally](#run-locally).

## Configuration

| Field                  | Description                                                            |
| ---------------------- | ---------------------------------------------------------------------- |
| Client ID / secret     | From an app created at https://developer.ticktick.com/manage.          |
| TickTick account       | OAuth2 **Connect** button.                                             |
| Personal API token     | Alternative to the app, used when no OAuth access works.               |
| Refresh frequency      | 1 minute, 5 minutes (default) or 15 minutes.                           |
| Hour for all-day tasks | Hour (0-23, default 9) at which the trigger fires for an all-day task. |

The redirect URI to register in the TickTick app is shown by Gladys under the
**Connect** button. Full user documentation, including troubleshooting:
[`docs/en.md`](./docs/en.md) / [`docs/fr.md`](./docs/fr.md).

## Development

Requires Node.js 20 or later.

```bash
npm ci
npm test               # unit tests (node --test)
npm run lint           # ESLint
npm run format:check   # Prettier
npm run coverage       # tests + coverage thresholds (needs Node >= 22.8)
```

Validate the manifest with the store's checker:

```bash
npx github:GladysAssistant/integration-store .
```

### Run locally

Register the integration in development mode in a Gladys 5.1+ server to get
its token and selector, then:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="<selector>" \
LOG_LEVEL=debug \
npm start
```

Set `DEBUG=gladys-integration-sdk` as well to have the SDK validate every
widget content it sends.

## Architecture

```
├─ index.js                          # wires the SDK handlers to TickTickIntegration, no logic
├─ src/
│  ├─ integration.js                 # TickTickIntegration: tokens, OAuth round trip, polling, every SDK handler
│  ├─ config.js                      # config defaults, type coercion, token order
│  ├─ oauth.js                       # TickTick authorize URL and code exchange
│  ├─ poller.js                      # self-scheduling polling loop with refresh-after-command
│  ├─ tasks.js                       # overdue / today / week selection and order
│  ├─ widgets.js                     # tasks widget content
│  ├─ scene-actions.js               # create_task and tasks_summary scene actions
│  ├─ scene-events.js                # task_due trigger: timers and event payload
│  ├─ localize.js                    # widget texts (en, fr) and language-neutral scene values
│  ├─ time.js                        # local days and times (TZ)
│  ├─ lifecycle.js                   # init retry with backoff, unhandled-rejection exit
│  └─ ticktick/
│     ├─ client.js                   # TickTick Open API client, errors and user-facing messages
│     └─ snapshot.js                 # one polling round: lists and undone tasks, normalized
├─ test/                             # node:test unit tests (fake Gladys, fake TickTick)
├─ docs/{en,fr}.md                   # user documentation (shown in the Gladys catalog)
├─ gladys-assistant-integration.json # manifest
└─ Dockerfile                        # image run by the Gladys supervisor
```

## Synced files

`.github/workflows/`, `.github/dependabot.yml`, `SECURITY.md` and `CLAUDE.md`
are synced from
[cicoub13/integration-kit](https://github.com/cicoub13/integration-kit). Do not
edit them here: the next sync overwrites local changes. Change the templates in
integration-kit instead.

## License

Apache-2.0
