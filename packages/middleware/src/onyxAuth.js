import superagent from 'superagent';

// Ported from the Volto add-on's src/middleware.js. This is the reason the proxy
// exists at all: Onyx service-account credentials stay here and never reach the
// browser.

const API_PREFIX = '/api';
const DEFAULT_MAX_AGE_SECONDS = 3600;
const EXPIRY_MARGIN_SECONDS = 60; // renew a little early rather than racing expiry

let cached = null; // { cookie, expiresAt }

export function __resetCache() {
  cached = null;
}

export function parseLoginResponse(response) {
  const setCookie = response?.headers?.['set-cookie']?.[0];
  if (!setCookie) {
    throw new Error('Onyx login returned no set-cookie header');
  }
  const maxAgeMatch = setCookie.match(/Max-Age=(\d+)/i);
  return {
    cookie: setCookie.split(';')[0],
    maxAge: maxAgeMatch ? Number(maxAgeMatch[1]) : DEFAULT_MAX_AGE_SECONDS,
  };
}

export async function loginToOnyx({ baseUrl, username, password }) {
  const response = await superagent
    .post(`${baseUrl}${API_PREFIX}/auth/login`)
    .type('form')
    .send({ username, password });
  return parseLoginResponse(response);
}

export async function getAuthHeaders(creds, login = loginToOnyx) {
  if (creds.apiKey) {
    return { Authorization: `Bearer ${creds.apiKey}` };
  }
  if (!(creds.username && creds.password)) {
    throw new Error(
      'Invalid configuration: set DANSWER_API_KEY, or DANSWER_USERNAME and DANSWER_PASSWORD',
    );
  }

  const now = Date.now();
  if (!cached || cached.expiresAt <= now) {
    const { cookie, maxAge } = await login(creds);
    cached = { cookie, expiresAt: now + (maxAge - EXPIRY_MARGIN_SECONDS) * 1000 };
  }
  return { Cookie: cached.cookie };
}
