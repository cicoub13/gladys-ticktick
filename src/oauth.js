// -----------------------------------------------------------------------------
// TickTick OAuth2 (authorization code), relayed by Gladys.
//
// Gladys knows no provider: on "Connect" it asks the integration for the
// authorize URL (onOAuthAuthorizeUrl), opens it, and hands back the code
// (onOAuthCallback). The `redirect_uri` is chosen by Gladys (the fixed
// https://my.gladysassistant.com/redirect/oauth page, or the instance address)
// and must be used as received, byte for byte, in both steps.
//
// TickTick documents no refresh token and no `expires_in`: the access token
// is long-lived (about six months by community accounts). When TickTick
// refuses it, the user reconnects.
// Reference: https://developer.ticktick.com/docs#/openapi ("Authorization").
// -----------------------------------------------------------------------------

import { TickTickError, networkError, statusError } from './ticktick/client.js';

export const AUTHORIZE_URL = 'https://ticktick.com/oauth/authorize';
export const TOKEN_URL = 'https://ticktick.com/oauth/token';
export const SCOPES = 'tasks:read tasks:write';
// The `oauth2` field of the manifest `config_schema`.
export const OAUTH_FIELD_KEY = 'ticktick_account';

const TIMEOUT_MS = 15 * 1000;

/**
 * Build the TickTick authorize URL.
 * @param {object} params
 * @param {string} params.clientId - Client ID of the user's TickTick developer app.
 * @param {string} params.redirectUri - The redirect URI Gladys provided.
 * @param {string} params.state - Anti-CSRF state, checked on the callback.
 * @returns {string} The URL to open.
 * @example
 * buildAuthorizeUrl({ clientId: 'abc', redirectUri: 'https://my.gladysassistant.com/redirect/oauth', state: 'xyz' });
 */
export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

/**
 * Exchange an authorization code for an access token. The client credentials
 * go in HTTP Basic auth, as TickTick documents.
 * @param {object} params
 * @param {string} params.clientId - Client ID.
 * @param {string} params.clientSecret - Client secret.
 * @param {string} params.code - The authorization code.
 * @param {string} params.redirectUri - The redirect URI used for the authorize step.
 * @param {typeof fetch} [params.fetchImpl] - Injectable for tests.
 * @returns {Promise<string>} The access token.
 * @example
 * const token = await exchangeCode({ clientId, clientSecret, code, redirectUri });
 */
export async function exchangeCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  fetchImpl = globalThis.fetch,
}) {
  const label = 'POST /oauth/token';
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    scope: SCOPES,
    redirect_uri: redirectUri,
  });
  let response;
  let text;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await response.text();
  } catch (err) {
    throw networkError(err, label);
  }
  // A wrong client secret or an expired code is a 400/401 here: both mean
  // "the account is not linked", not a TickTick outage.
  if (response.status === 400) {
    throw new TickTickError('auth', `${label}: code or client credentials refused (HTTP 400)`, {
      status: 400,
    });
  }
  if (!response.ok) {
    throw statusError(response.status, label);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (typeof json?.access_token !== 'string' || json.access_token === '') {
    throw new TickTickError('invalid_response', `${label}: no access_token in the answer`, {
      status: response.status,
    });
  }
  return json.access_token;
}
