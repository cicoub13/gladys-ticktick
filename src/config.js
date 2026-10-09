// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of the manifest,
// plus one key OUTSIDE the schema: `oauth_access_token`, written by the
// integration itself after the OAuth2 flow (never shown in the UI, never sent
// to the browser). This module only provides defaults, trims and coerces the
// types (a form may hand back strings).
// -----------------------------------------------------------------------------

export const OAUTH_TOKEN_KEY = 'oauth_access_token';

export const DEFAULT_CONFIG = {
  client_id: '',
  client_secret: '',
  poll_frequency: 300,
  all_day_hour: 9,
  [OAUTH_TOKEN_KEY]: '',
};

// The only frequencies the manifest `select` offers (seconds): a stale or
// corrupted stored value snaps back to the default instead of flowing through.
export const POLL_FREQUENCY_OPTIONS = [60, 300, 900];

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Merge the user configuration with the defaults and coerce the types.
 * @param {Record<string, unknown>} [raw] - Configuration returned by the SDK.
 * @returns {typeof DEFAULT_CONFIG} The normalized configuration.
 * @example
 * normalizeConfig({ client_id: 'abc', poll_frequency: '60' });
 */
export function normalizeConfig(raw) {
  // `= {}` would not cover an explicit null, which getConfig() can return.
  const source = raw ?? {};
  const requestedFrequency = Number(source.poll_frequency);
  const requestedHour = Number(source.all_day_hour);
  return {
    client_id: trimmed(source.client_id),
    client_secret: trimmed(source.client_secret),
    poll_frequency: POLL_FREQUENCY_OPTIONS.includes(requestedFrequency)
      ? requestedFrequency
      : DEFAULT_CONFIG.poll_frequency,
    all_day_hour:
      Number.isInteger(requestedHour) && requestedHour >= 0 && requestedHour <= 23
        ? requestedHour
        : DEFAULT_CONFIG.all_day_hour,
    [OAUTH_TOKEN_KEY]: trimmed(source[OAUTH_TOKEN_KEY]),
  };
}
