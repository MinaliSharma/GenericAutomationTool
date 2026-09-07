const TRANSIENT_NAVIGATION_ERROR = /ERR_SOCKET_NOT_CONNECTED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_FAILED|chrome-error:\/\/|interrupted by another navigation/;

export async function gotoWithTransientRetry(page, url, options = {}) {
  const attempts = options.attempts || 3;
  const retryDelayMs = options.retryDelayMs === undefined ? 500 : options.retryDelayMs;
  const { attempts: _attempts, retryDelayMs: _retryDelayMs, ...gotoOptions } = options;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await page.goto(url, gotoOptions);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (!TRANSIENT_NAVIGATION_ERROR.test(message) || attempt === attempts) {
        throw error;
      }
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
}