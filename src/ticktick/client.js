// -----------------------------------------------------------------------------
// Minimal TickTick Open API client (https://api.ticktick.com/open/v1, JSON,
// Bearer token). Reference: https://developer.ticktick.com/docs#/openapi
//
// Every failure is thrown as a TickTickError whose `kind` tells what went
// wrong (unreachable, timeout, auth, not_found, rate_limited, http,
// invalid_response), so callers can turn it into an actionable message with
// describeError(). The token is kept in a private field and never copied into
// an error message: the client object and its errors can be logged safely.
// `fetchImpl` is injectable so unit tests never touch the real network.
// Pattern borrowed from ../gladys-adguard-home/src/adguard/client.js.
// -----------------------------------------------------------------------------

export const API_BASE_URL = 'https://api.ticktick.com/open/v1';
export const DEFAULT_TIMEOUT_MS = 10 * 1000;
// The pseudo project id TickTick accepts for the inbox, which GET /project
// does not list.
export const INBOX_PROJECT_ID = 'inbox';

/**
 * Error of a TickTick request.
 * `kind`: 'unreachable' | 'timeout' | 'auth' | 'not_found' | 'rate_limited' | 'http' | 'invalid_response'.
 */
export class TickTickError extends Error {
  /**
   * @param {string} kind - Failure category.
   * @param {string} message - Technical message (never contains the token).
   * @param {{status?: number, code?: string}} [details] - HTTP status, or system error code.
   */
  constructor(kind, message, { status, code } = {}) {
    super(message);
    this.name = 'TickTickError';
    this.kind = kind;
    if (status !== undefined) {
      this.status = status;
    }
    if (code !== undefined) {
      this.code = code;
    }
  }
}

/**
 * Convert a rejection of fetch (or of the body read) into a TickTickError.
 * Only the system error code is kept: the original error is dropped rather
 * than chained, so nothing from the request can leak through it.
 * @param {unknown} err - What fetch threw.
 * @param {string} label - `METHOD /path` of the request.
 * @returns {TickTickError} The normalized error.
 * @example
 * throw networkError(err, 'GET /project');
 */
export function networkError(err, label) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new TickTickError('timeout', `${label}: TickTick did not answer in time`);
  }
  // undici wraps the system error: TypeError('fetch failed', { cause }).
  const code = err?.cause?.code ?? err?.code;
  const suffix = typeof code === 'string' ? ` (${code})` : '';
  return new TickTickError('unreachable', `${label}: TickTick is unreachable${suffix}`, {
    code: typeof code === 'string' ? code : undefined,
  });
}

/**
 * Map a non-2xx HTTP status to a TickTickError.
 * @param {number} status - The HTTP status.
 * @param {string} label - `METHOD /path` of the request.
 * @returns {TickTickError} The error.
 * @example
 * throw statusError(401, 'GET /project');
 */
export function statusError(status, label) {
  if (status === 401 || status === 403) {
    return new TickTickError('auth', `${label}: token refused (HTTP ${status})`, { status });
  }
  if (status === 404) {
    return new TickTickError('not_found', `${label}: not found (HTTP 404)`, { status });
  }
  if (status === 429) {
    return new TickTickError('rate_limited', `${label}: too many requests (HTTP 429)`, { status });
  }
  return new TickTickError('http', `${label}: HTTP ${status}`, { status });
}

export class TickTickClient {
  #authorization;

  /**
   * @param {object} options
   * @param {string} options.token - OAuth access token.
   * @param {typeof fetch} [options.fetchImpl] - Injectable for tests.
   * @param {number} [options.timeoutMs] - Deadline of one request (headers AND body).
   */
  constructor({ token, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.#authorization = `Bearer ${token}`;
  }

  /**
   * Send one request to the API.
   * @param {string} method - HTTP method.
   * @param {string} path - Path under the API base, e.g. '/project'.
   * @param {unknown} [body] - JSON body.
   * @returns {Promise<any>} The parsed JSON, or undefined for an empty body.
   */
  async request(method, path, body) {
    const label = `${method} ${path}`;
    const headers = { Accept: 'application/json', Authorization: this.#authorization };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response;
    let text;
    try {
      // The same signal also aborts the body read below.
      response = await this.fetchImpl(`${API_BASE_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await response.text();
    } catch (err) {
      throw networkError(err, label);
    }

    if (!response.ok) {
      throw statusError(response.status, label);
    }
    // Some write endpoints answer an empty body.
    if (text.trim() === '') {
      return undefined;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new TickTickError('invalid_response', `${label}: the answer is not JSON`, {
        status: response.status,
      });
    }
  }

  /** @returns {Promise<object[]>} GET /project: the user's lists, inbox excluded. */
  listProjects() {
    return this.request('GET', '/project');
  }

  /**
   * @param {string} projectId - A project id, or INBOX_PROJECT_ID.
   * @returns {Promise<{project?: object, tasks?: object[]}>} The list and its undone tasks.
   * @example
   * await client.getProjectData('inbox');
   */
  getProjectData(projectId) {
    return this.request('GET', `/project/${encodeURIComponent(projectId)}/data`);
  }

  /**
   * @param {{title: string, projectId?: string, dueDate?: string, isAllDay?: boolean, timeZone?: string, priority?: number}} task - The task to create.
   * @returns {Promise<object>} The created task.
   * @example
   * await client.createTask({ title: 'Buy milk', projectId: 'inbox' });
   */
  createTask(task) {
    return this.request('POST', '/task', task);
  }
}

/**
 * User-facing, actionable message for any error (TickTickError or not).
 * @param {unknown} err - The error to describe.
 * @returns {{en: string, fr: string}} The message.
 * @example
 * describeError(new TickTickError('auth', '...', { status: 401 }));
 */
export function describeError(err) {
  if (!(err instanceof TickTickError)) {
    return {
      en: 'Unexpected error while talking to TickTick. Check the integration logs.',
      fr: "Erreur inattendue en communiquant avec TickTick. Consultez les journaux de l'intégration.",
    };
  }
  switch (err.kind) {
    case 'auth':
      return {
        en: 'TickTick refused the access. Click Connect again in the integration settings.',
        fr: "TickTick a refusé l'accès. Cliquez à nouveau sur Connecter dans les paramètres de l'intégration.",
      };
    case 'timeout':
      return {
        en: 'TickTick did not answer in time. It will be retried at the next refresh.',
        fr: "TickTick n'a pas répondu à temps. Nouvel essai à la prochaine actualisation.",
      };
    case 'not_found':
      return {
        en: 'TickTick does not know this task or list any more: it may have been deleted or moved.',
        fr: 'TickTick ne connaît plus cette tâche ou cette liste : elle a peut-être été supprimée ou déplacée.',
      };
    case 'rate_limited':
      return {
        en: 'TickTick limits the number of requests. Choose a longer refresh frequency.',
        fr: "TickTick limite le nombre de requêtes. Choisissez une fréquence d'actualisation plus longue.",
      };
    case 'http':
      return {
        en: `TickTick answered with an error (HTTP ${err.status}). It will be retried at the next refresh.`,
        fr: `TickTick a répondu par une erreur (HTTP ${err.status}). Nouvel essai à la prochaine actualisation.`,
      };
    case 'invalid_response':
      return {
        en: 'TickTick sent an unexpected answer. It will be retried at the next refresh.',
        fr: 'TickTick a envoyé une réponse inattendue. Nouvel essai à la prochaine actualisation.',
      };
    default:
      return {
        en: 'TickTick cannot be reached. Check the Internet connection of the Gladys host.',
        fr: 'TickTick est injoignable. Vérifiez la connexion Internet de la machine Gladys.',
      };
  }
}
