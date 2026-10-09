// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
// Reproduces only the surface the integration relies on, recording every call
// (pattern borrowed from ../gladys-adguard-home/test/helpers/fakeGladys.js).
// -----------------------------------------------------------------------------

export function createFakeGladys(config = {}) {
  const calls = {
    connectionStatuses: [],
    widgetRefreshes: [],
    sceneEvents: [],
    setConfigs: [],
  };
  const failures = {};

  function maybeFail(method) {
    if (failures[method] > 0) {
      failures[method] -= 1;
      const err = new Error('Too Many Requests');
      err.status = 429;
      throw err;
    }
  }

  return {
    calls,
    config: { ...config },

    /** The next `times` calls of `method` reject like a host API 429. */
    failNext(method, times = 1) {
      failures[method] = times;
    },

    async getConfig() {
      maybeFail('getConfig');
      return { ...this.config };
    },

    async setConfig(partial) {
      maybeFail('setConfig');
      calls.setConfigs.push(partial);
      Object.assign(this.config, partial);
    },

    async setConnectionStatus(connected, message) {
      maybeFail('setConnectionStatus');
      calls.connectionStatuses.push({ connected, message });
    },

    async publishSceneEvent(key, data) {
      maybeFail('publishSceneEvent');
      calls.sceneEvents.push({ key, data });
    },

    requestWidgetRefresh(key) {
      maybeFail('requestWidgetRefresh');
      calls.widgetRefreshes.push(key);
    },
  };
}
