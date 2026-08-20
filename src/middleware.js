import superagent from 'superagent';
import fetch from 'node-fetch';
import debug from 'debug';
// pretagov fork: upgraded Onyx renamed the chat endpoint and replaced the flat
// packet stream with NDJSON Packet envelopes, so this proxy has to translate.
// The logic is shared with the hosted middleware rather than duplicated here.
import { translateRequest, createTranslateStream } from '../packages/middleware/src/protocol.js';
import { resolveOnyxPath } from '../packages/middleware/src/proxy.js';

const log = debug('volto-chatbot');

const apiPrefix = process.env.DANSWER_API_PREFIX ?? '/api';

let cached_auth_cookie = null;
let last_fetched = null;
let maxAge;

const MSG_INVALID_CONFIGURATION =
  'Invalid configuration: missing DANSWER username and password';
const MSG_FETCH_COOKIE = 'Error while fetching authentication cookie';
const MSG_ERROR_REQUEST = 'Error in processing request to Danswer';

async function get_login_cookie(username, password) {
  const url = `${process.env.DANSWER_URL}${apiPrefix}/auth/login`;
  const data = {
    username,
    password,
    scope: '',
    client_id: '',
    client_secret: '',
    grant_type: '',
  };
  try {
    const response = await superagent.post(url).type('form').send(data);
    const header = response.headers['set-cookie'][0];
    return header;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(MSG_FETCH_COOKIE, error);
  }
}

async function getAuthCookie(username, password) {
  cached_auth_cookie = await get_login_cookie(username, password);
  if (cached_auth_cookie) {
    const maxAgeMatch = cached_auth_cookie.match(/Max-Age=(\d+)/);
    maxAge = parseInt(maxAgeMatch[1]);
    last_fetched = new Date();
  }
}

async function login(username, password) {
  const diff = maxAge - (new Date() - last_fetched) / 1000;
  // eslint-disable-next-line no-console
  console.log('danswer auth still valid for seconds: ', diff);
  if (!cached_auth_cookie || diff < 0) {
    await getAuthCookie(username, password);
  }
}

async function check_credentials() {
  const reqUrl = `${process.env.DANSWER_URL}${apiPrefix}/persona/-1`;

  const options = {
    method: 'GET',
    headers: {
      Cookie: cached_auth_cookie,
      'Content-Type': 'application/json',
    },
  };

  log(`Fetching ${reqUrl}`);
  return await fetch(reqUrl, options);
}

async function send_danswer_request(
  req,
  res,
  { username, password, api_key, url },
) {
  let headers = {};
  if (!api_key) {
    await login(username, password);

    try {
      const resp = await check_credentials();
      if (resp.status !== 200) {
        await getAuthCookie(username, password);
      }
    } catch (error) {
      await getAuthCookie(username, password);
    }
    headers = {
      Cookie: cached_auth_cookie,
      'Content-Type': 'application/json',
    };
  } else {
    headers = {
      Authorization: 'Bearer ' + api_key,
      'Content-Type': 'application/json',
    };
  }

  const options = {
    method: req.method,
    headers: headers,
  };

  if (req.body && req.method === 'POST') {
    // pretagov fork: reshape for the new SendMessageRequest model.
    options.body = JSON.stringify(translateRequest(req.body, url));
  }
  try {
    log(`Fetching ${url}`);
    const response = await fetch(url, options, req.body);

    if (!api_key) {
      if (response.headers.get('transfer-encoding') === 'chunked') {
        res.set('Content-Type', 'text/event-stream');
      } else {
        res.set('Content-Type', 'application/json');
      }
    } else {
      res.set('Content-Type', response.headers.get('Content-Type'));
    }

    // pretagov fork: the chat turn now streams Packet envelopes; translate them
    // back to the flat shape the components parse. Still a pipe, so the answer
    // stays incremental.
    if (url.includes('send-chat-message')) {
      response.body.pipe(createTranslateStream()).pipe(res);
    } else {
      response.body.pipe(res);
    }
  } catch (error) {
    throw error;
  }
}

export default async function middleware(req, res, next) {
  // pretagov fork: chat/send-message no longer exists (it is send-chat-message
  // now) and health moved to the root, so the target is resolved rather than
  // assumed to be apiPrefix + path.
  const resolved = resolveOnyxPath(req.url);
  if (!resolved) {
    res.status(403).send({ error: 'path not allowed' });
    return;
  }

  const reqUrl = `${process.env.DANSWER_URL}${resolved}`;

  const username = process.env.DANSWER_USERNAME;
  const password = process.env.DANSWER_PASSWORD;

  const api_key = process.env.DANSWER_API_KEY;
  if (!(api_key || (username && password))) {
    res.send({
      error: MSG_INVALID_CONFIGURATION,
    });
    return;
  }

  try {
    await send_danswer_request(req, res, {
      url: reqUrl,
      username: username,
      password: password,
      api_key: api_key,
    });
  } catch (error) {
    // eslint-disable-next-line
    console.error(MSG_ERROR_REQUEST, error?.response?.text);

    res.send({ error: `Danswer error: ${error?.response?.text || 'error'}` });
  }
}
