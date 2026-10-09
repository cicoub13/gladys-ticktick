# TickTick

> **Requires Gladys 5.1 or later.** This integration is made of a dashboard
> widget and scene triggers and actions, which ship with Gladys 5.1; on an
> earlier version it cannot be installed.

Bring your [TickTick](https://ticktick.com) tasks into Gladys: a dashboard
widget with the tasks due today and the overdue ones, a scene action to create
a task (from a button, a voice command, a sensor...), another one to read your
tasks out loud or send them in a notification, and a scene trigger that fires
when a task reaches its due time.

## Requirements

- A TickTick account (free or Premium).
- Internet access from the machine running Gladys: the integration talks to
  the TickTick cloud API.

## Connecting your account

Two ways, pick one.

### Option 1: TickTick app (recommended)

1. Open the [TickTick developer site](https://developer.ticktick.com/manage),
   sign in with your TickTick account and click **New App**. Any name will do,
   e.g. "Gladys".
2. Open the new app and click **Edit**. In **OAuth redirect URL**, paste the
   **redirect URI** shown in the Gladys configuration screen, under the
   **Connect** button (usually `https://my.gladysassistant.com/redirect/oauth`),
   and save.
3. Copy the app's **Client ID** and **Client secret** into the Gladys
   configuration screen and click **Save**.
4. Click **Connect**: TickTick asks you to allow access to your tasks. Accept.
   You are brought back to Gladys, and the status turns to connected.

The access granted lasts several months. When TickTick ends it, the status of
the integration says so: click **Connect** again.

### Option 2: personal API token

If your TickTick account offers a personal API token (**Settings > Account >
API Token** in the TickTick web app), paste it in **Personal API token** and
click **Save**. No developer app is needed.

When both are set, the connected account is used first, and the token takes
over if TickTick refuses the account.

## Configuration

| Field                      | Description                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Client ID / secret**     | From your TickTick developer app (option 1).                                                                 |
| **TickTick account**       | The **Connect** button (option 1).                                                                           |
| **Personal API token**     | Option 2.                                                                                                    |
| **Refresh frequency**      | How often TickTick is read: 1 minute, 5 minutes (default) or 15 minutes.                                     |
| **Hour for all-day tasks** | Hour (0-23, default 9) at which the "TickTick task due" trigger fires for a task that has a day but no time. |

**Test the connection** checks the access and shows how many lists were found.
It also resumes the refresh after a refused access was fixed.

## Dashboard widget

Add the **TickTick tasks** widget to a dashboard. It shows:

- two counters: overdue tasks and tasks due today;
- up to 8 tasks, overdue first, with their list, due time and priority. Tap a
  task to see its notes and a link to open it in TickTick;
- a line saying how many more tasks did not fit.

The **Tasks shown** setting of each widget chooses between _Today and
overdue_ (default), _Today_, _Overdue_ and _Next 7 days and overdue_.

Tasks without a date are never shown. Tasks are completed in TickTick, not
from the widget.

## Scenes

### Trigger: TickTick task due

Fires when an undone task reaches its due time: at its time for a task with a
time, at the **Hour for all-day tasks** for a task with only a day. Optional
filters: the **priority**, and the **list** (its exact name, `Inbox` for the
inbox).

Variables for the next actions: `title`, `list_name`, `priority` (`none`,
`low`, `medium`, `high`), `due_date` (`YYYY-MM-DD`), `due_time` (`HH:MM`, empty
for an all-day task), `all_day` and `content` (the task notes).

The schedule follows the refresh: a task created or moved less than one
refresh period before its due time may be missed. A task already past due when
Gladys starts does not fire.

### Action: Create a TickTick task

- **Title** (required, can use scene variables);
- **List**: name of a TickTick list, case does not matter. Empty or unknown:
  the inbox;
- **Due**: no date, today or tomorrow, with an optional **Due time** (`18:30`);
  without a time the task is for the whole day;
- **Priority**: none, low, medium or high.

Outputs: `task_id` and `list_name` (the list the task landed in).

### Action: Get TickTick tasks

Reads the tasks of a scope (same choices as the widget) from the last refresh.
Outputs: `count`, `titles` (one task per line, with its time when it has one),
and the first task's `next_title`, `next_list`, `next_due_date` and
`next_due_time`. Example: every morning at 7:30, if `count` is above 0, send
"Today: {{titles}}" in a notification.

## Troubleshooting

| Message                                                    | What to do                                                                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| _Connect your TickTick account, or enter a personal token_ | Nothing is connected yet: follow "Connecting your account".                                                                            |
| _Enter the Client ID..._ / _Enter the Client secret..._    | Fill them in and **Save** before clicking **Connect**.                                                                                 |
| _There was an error starting the connection_ (Gladys)      | Gladys does not show the cause: it is in the integration logs ("TickTick connection failed"). Usually the Client ID was not saved.     |
| _TickTick refused the access_                              | The access was revoked or expired, or the token is wrong: click **Connect** again (or paste a new token). Refreshing waits until then. |
| _The TickTick authorization expired or does not match_     | More than 15 minutes passed on the TickTick page, or the integration restarted meanwhile: click **Connect** again.                     |
| TickTick says the redirect URL is invalid                  | The **OAuth redirect URL** of your developer app must be exactly the redirect URI shown in Gladys.                                     |
| _TickTick cannot be reached_ / _did not answer in time_    | Check the Internet connection of the Gladys machine. The integration retries at every refresh.                                         |
| _TickTick limits the number of requests_                   | Choose a longer refresh frequency.                                                                                                     |

The integration logs (Supervision tab of the integration) give the details of
every failure; your token never appears in them.
