// -----------------------------------------------------------------------------
// The integration itself: owns the TickTick client, the polling loop, the last
// snapshot, the OAuth2 round trip and the `task_due` schedule, and answers
// every SDK handler from them. index.js only wires these methods to the SDK,
// so everything here runs against a fake Gladys and a fake client in the
// tests. Structure borrowed from ../gladys-adguard-home/src/integration.js.
//
// When TickTick refuses the OAuth token, polling stops until the user
// reconnects (no point hammering a revoked token).
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { logger as defaultLogger } from '@gladysassistant/integration-sdk';
import { OAUTH_TOKEN_KEY, normalizeConfig } from './config.js';
import { TickTickClient, describeError } from './ticktick/client.js';
import { fetchSnapshot as defaultFetchSnapshot } from './ticktick/snapshot.js';
import { buildAuthorizeUrl, exchangeCode as defaultExchangeCode } from './oauth.js';
import { Poller } from './poller.js';
import { TASKS_WIDGET_KEY, buildTasksContent } from './widgets.js';
import { buildTasksSummary, runCreateTask } from './scene-actions.js';
import { TASK_DUE_KEY, TaskDueScheduler, buildTaskDueEventData } from './scene-events.js';

// How long the user has to consent at TickTick after clicking "Connect".
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

const NOT_CONNECTED = {
  en: 'Connect your TickTick account in the configuration.',
  fr: 'Connectez votre compte TickTick dans la configuration.',
};

// The Connect button does not save the form: the integration only sees the
// saved values, hence the insistence on Save.
const MISSING_CLIENT_ID = {
  en: 'No saved Client ID: enter it, click Save at the bottom of the form, then click Connect.',
  fr: 'Aucun Client ID enregistré : saisissez-le, cliquez sur Enregistrer en bas du formulaire, puis sur Connecter.',
};

const MISSING_CLIENT_SECRET = {
  en: 'No saved Client secret: enter it, click Save at the bottom of the form, then click Connect again.',
  fr: 'Aucun Client secret enregistré : saisissez-le, cliquez sur Enregistrer en bas du formulaire, puis à nouveau sur Connecter.',
};

const OAUTH_STATE_MISMATCH = {
  en: 'The TickTick authorization expired or does not match. Click Connect again.',
  fr: "L'autorisation TickTick a expiré ou ne correspond pas. Cliquez à nouveau sur Connecter.",
};

/**
 * Flatten a { en, fr } message into one string, for the places that only take
 * a string (a thrown Error shown under a button or in the scene logs).
 * @param {{en: string, fr: string}} message - The bilingual message.
 * @returns {string} "English / Français".
 * @example
 * bilingual({ en: 'Unreachable', fr: 'Injoignable' }); // 'Unreachable / Injoignable'
 */
export function bilingual(message) {
  return `${message.en} / ${message.fr}`;
}

// What the widget shows of a task: a change here is worth a refresh nudge.
const fingerprintOf = (snapshot) =>
  JSON.stringify(
    snapshot.tasks.map((task) => [
      task.id,
      task.title,
      task.listName,
      task.priority,
      task.due?.getTime() ?? null,
      task.allDay,
      task.content,
    ]),
  );

export class TickTickIntegration {
  /**
   * @param {object} gladys - The GladysIntegration SDK instance.
   * @param {object} [deps] - Injectable collaborators, for tests.
   * @param {(token: string) => object} [deps.createClient] - Builds the TickTick client of a token.
   * @param {typeof defaultFetchSnapshot} [deps.fetchSnapshot] - Reads everything the integration shows.
   * @param {typeof defaultExchangeCode} [deps.exchangeCode] - OAuth2 code exchange.
   * @param {object} [deps.logger] - The SDK logger.
   * @param {() => Date} [deps.now] - Injectable clock.
   * @param {() => string} [deps.createState] - Anti-CSRF state generator.
   * @param {typeof setTimeout} [deps.setTimer] - Injectable timer (polling, trigger).
   * @param {typeof clearTimeout} [deps.clearTimer] - Injectable timer (polling, trigger).
   */
  constructor(
    gladys,
    {
      createClient = (token) => new TickTickClient({ token }),
      fetchSnapshot = defaultFetchSnapshot,
      exchangeCode = defaultExchangeCode,
      logger = defaultLogger,
      now = () => new Date(),
      createState = randomUUID,
      setTimer = setTimeout,
      clearTimer = clearTimeout,
    } = {},
  ) {
    this.gladys = gladys;
    this.createClient = createClient;
    this.fetchSnapshot = fetchSnapshot;
    this.exchangeCode = exchangeCode;
    this.logger = logger;
    this.now = now;
    this.createState = createState;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;

    this.config = normalizeConfig();
    this.client = null;
    this.poller = null;
    this.snapshot = null;
    this.fingerprint = null;
    // { en, fr } message of the last failed poll, null once a poll succeeds.
    this.lastError = null;
    // Status last reported to Gladys: null (never), true or false.
    this.reportedConnected = null;
    this.reportedReason = null;
    // { value, expiresAt } between onOAuthAuthorizeUrl and onOAuthCallback.
    this.oauthState = null;
    // Bumped on every config change: a poll started under an older config
    // must not publish anything once it resolves.
    this.generation = 0;
    this.scheduler = new TaskDueScheduler({
      onDue: (task) => this.fireTaskDue(task),
      now,
      setTimer,
      clearTimer,
    });
  }

  /**
   * (Re)start from a configuration: tears down the previous client and loop.
   * @param {Record<string, unknown>} rawConfig - The configuration from the SDK.
   * @returns {Promise<void>} Settles once the first poll did.
   * @example
   * await integration.applyConfig(await gladys.getConfig());
   */
  async applyConfig(rawConfig) {
    this.stop();
    this.generation += 1;
    this.config = normalizeConfig(rawConfig);
    this.client = null;
    this.snapshot = null;
    this.fingerprint = null;
    this.lastError = null;
    this.reportedConnected = null;
    this.reportedReason = null;

    if (!this.config[OAUTH_TOKEN_KEY]) {
      this.logger.info('No TickTick account connected yet');
      this.lastError = NOT_CONNECTED;
      await this.reportConnection(false, NOT_CONNECTED);
      this.refreshWidget();
      return;
    }

    this.client = this.createClient(this.config[OAUTH_TOKEN_KEY]);
    this.logger.info(`Polling TickTick every ${this.config.poll_frequency}s`);
    this.poller = new Poller({
      run: () => this.poll(),
      intervalMs: this.config.poll_frequency * 1000,
      setTimer: this.setTimer,
      clearTimer: this.clearTimer,
    });
    await this.poller.start();
  }

  /**
   * One poll: read TickTick, report the connection, refresh the widget when
   * the tasks changed, reschedule the trigger. Never throws.
   * @returns {Promise<void>}
   * @example
   * await integration.poll();
   */
  async poll() {
    const { generation, client } = this;
    let snapshot;
    try {
      snapshot = await this.fetchSnapshot(client);
    } catch (err) {
      if (generation === this.generation) {
        await this.handlePollFailure(err);
      }
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    this.snapshot = snapshot;
    const recovered = this.lastError !== null;
    this.lastError = null;
    this.scheduler.reschedule(snapshot.tasks, this.config.all_day_hour);
    const fingerprint = fingerprintOf(snapshot);
    if (fingerprint !== this.fingerprint || recovered) {
      this.fingerprint = fingerprint;
      this.refreshWidget();
    }
    // Gladys-side failures (host API 429, WebSocket down) are not TickTick
    // failures: logged, retried naturally by the next poll.
    try {
      if (this.reportedConnected !== true) {
        this.logger.info(
          `TickTick reachable: ${snapshot.projects.length} lists, ${snapshot.tasks.length} undone tasks`,
        );
      }
      await this.reportConnection(true);
    } catch (err) {
      this.logger.error('Could not report the connection status to Gladys', err);
    }
  }

  async handlePollFailure(err) {
    this.lastError = describeError(err);
    if (err?.kind === 'auth') {
      this.poller?.stop();
      this.scheduler.stop();
      this.lastError = {
        en: `${this.lastError.en} Refreshing is suspended until then.`,
        fr: `${this.lastError.fr} Les actualisations sont suspendues d'ici là.`,
      };
    }
    // Loud once per outage, quiet while it lasts.
    if (this.reportedConnected !== false) {
      this.logger.warn(`TickTick poll failed: ${this.lastError.en}`, err);
    } else {
      this.logger.debug(`TickTick still failing: ${this.lastError.en}`);
    }
    this.refreshWidget();
    try {
      await this.reportConnection(false, this.lastError);
    } catch (statusErr) {
      this.logger.error('Could not report the connection status to Gladys', statusErr);
    }
  }

  /**
   * Report the connection to Gladys, only when it changed (a failure is sent
   * again when its reason changes: refused token -> unreachable...).
   */
  async reportConnection(connected, message) {
    const reason = message?.en ?? null;
    if (this.reportedConnected === connected && this.reportedReason === reason) {
      return;
    }
    await this.gladys.setConnectionStatus(connected, message);
    this.reportedConnected = connected;
    this.reportedReason = reason;
  }

  refreshWidget() {
    try {
      this.gladys.requestWidgetRefresh(TASKS_WIDGET_KEY);
    } catch (err) {
      this.logger.debug('Widget refresh request failed', err);
    }
  }

  async fireTaskDue(task) {
    try {
      await this.gladys.publishSceneEvent(TASK_DUE_KEY, buildTaskDueEventData(task));
    } catch (err) {
      this.logger.error(`Could not publish the ${TASK_DUE_KEY} event`, err);
    }
  }

  requireClient() {
    if (!this.client) {
      throw new Error(bilingual(NOT_CONNECTED));
    }
    return this.client;
  }

  // --- OAuth2 ------------------------------------------------------------------

  /**
   * Run an OAuth step, logging its failure: the SDK only hands the error
   * message back to Gladys, whose Configuration screen shows a generic
   * "could not start the connection", so without this the cause is nowhere.
   */
  async logOAuthFailure(step, run) {
    try {
      return await run();
    } catch (err) {
      this.logger.warn(`TickTick connection failed (${step}): ${err.message}`);
      throw err;
    }
  }

  /**
   * onOAuthAuthorizeUrl: the TickTick consent URL. The config is read fresh:
   * the user may have saved the Client ID just before clicking Connect. Only
   * the Client ID is needed here; the secret is checked on the callback.
   * @param {string} _key - The oauth2 field key (there is only one).
   * @param {string} redirectUri - Chosen by Gladys, used as is.
   * @returns {Promise<string>} The URL.
   */
  oauthAuthorizeUrl(_key, redirectUri) {
    return this.logOAuthFailure('authorize URL', async () => {
      const config = normalizeConfig(await this.gladys.getConfig());
      if (!config.client_id) {
        throw new Error(bilingual(MISSING_CLIENT_ID));
      }
      const state = this.createState();
      this.oauthState = { value: state, expiresAt: this.now().getTime() + OAUTH_STATE_TTL_MS };
      this.logger.info('Opening the TickTick authorization page');
      return buildAuthorizeUrl({ clientId: config.client_id, redirectUri, state });
    });
  }

  /**
   * onOAuthCallback: check the state, exchange the code, store the token
   * outside the config_schema, and restart with it.
   * @param {string} _key - The oauth2 field key.
   * @param {{code: string, state: string, redirectUri: string}} params - From the provider redirect.
   * @returns {Promise<void>}
   */
  oauthCallback(_key, params) {
    return this.logOAuthFailure('callback', () => this.completeOAuth(params));
  }

  async completeOAuth({ code, state, redirectUri }) {
    const expected = this.oauthState;
    this.oauthState = null;
    if (!expected || expected.value !== state || this.now().getTime() > expected.expiresAt) {
      throw new Error(bilingual(OAUTH_STATE_MISMATCH));
    }
    const rawConfig = await this.gladys.getConfig();
    const config = normalizeConfig(rawConfig);
    if (!config.client_secret) {
      throw new Error(bilingual(MISSING_CLIENT_SECRET));
    }
    let token;
    try {
      token = await this.exchangeCode({
        clientId: config.client_id,
        clientSecret: config.client_secret,
        code,
        redirectUri,
      });
    } catch (err) {
      const message = describeError(err);
      throw new Error(bilingual(message), { cause: err });
    }
    await this.gladys.setConfig({ [OAUTH_TOKEN_KEY]: token });
    this.logger.info('TickTick account connected');
    // setConfig from the integration is not echoed as a config-updated.
    await this.applyConfig({ ...rawConfig, [OAUTH_TOKEN_KEY]: token });
  }

  // --- Configuration screen ---------------------------------------------------

  /** Manifest action `test_connection`: throws (shown in red) on failure. */
  async testConnection() {
    const client = this.requireClient();
    let projects;
    try {
      projects = await client.listProjects();
    } catch (err) {
      throw new Error(bilingual(describeError(err)), { cause: err });
    }
    // Also recovers right away after a fixed issue, including polling
    // suspended by a refused token.
    if (this.poller?.stopped) {
      this.poller.start().catch(() => {});
    } else {
      this.poller?.refreshNow().catch(() => {});
    }
    const count = Array.isArray(projects) ? projects.length : 0;
    return {
      en: `Connected to TickTick (${count} lists, inbox not counted).`,
      fr: `Connecté à TickTick (${count} listes, hors boîte de réception).`,
    };
  }

  // --- Widget and scenes ------------------------------------------------------

  widgetTasks({ settings, language } = {}) {
    return buildTasksContent(this.snapshot, {
      settings: settings ?? {},
      language,
      error: this.lastError,
      now: this.now(),
    });
  }

  /** Scene action `create_task`. */
  async sceneCreateTask(fields) {
    const client = this.requireClient();
    let outputs;
    try {
      outputs = await runCreateTask(client, fields, this.snapshot, this.now());
    } catch (err) {
      if (err?.name === 'TickTickError') {
        throw new Error(bilingual(describeError(err)), { cause: err });
      }
      throw err;
    }
    // Show the new task on the dashboard without waiting for the next period.
    this.poller?.refreshNow().catch(() => {});
    return outputs;
  }

  /** Scene action `tasks_summary`: from the last snapshot, no API call. */
  sceneTasksSummary(fields) {
    if (!this.snapshot) {
      throw new Error(bilingual(this.lastError ?? NOT_CONNECTED));
    }
    return buildTasksSummary(this.snapshot.tasks, fields, this.now());
  }

  /** Shutdown / config change: no timer left behind. */
  stop() {
    this.poller?.stop();
    this.poller = null;
    this.scheduler.stop();
  }
}
