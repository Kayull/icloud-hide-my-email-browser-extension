/* eslint-env es2020 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mockBrowser, runtime } = require('./helpers');

const service = {
  premiummailsettings: {
    url: 'https://p01-maildomainws.icloud.com',
    status: 'active',
  },
};
const response = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const sessionCookie = (overrides = {}) => ({
  name: 'X-APPLE-WEBAUTH-TOKEN',
  value: 'token',
  domain: '.icloud.com',
  hostOnly: false,
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'no_restriction',
  session: true,
  storeId: '0',
  ...overrides,
});

test('iCloud session cookies are re-set with an expiry when iCloud sets them', async () => {
  const { browser } = mockBrowser();
  const sets = [];
  browser.cookies.set = async (details) => sets.push(details);
  const load = runtime(browser, async () => response(503));
  load('src/pages/Background/index.ts');
  await browser.cookies.onChanged.emit({
    removed: false,
    cause: 'explicit',
    cookie: sessionCookie(),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sets.length, 1);
  assert.equal(sets[0].url, 'https://icloud.com/');
  assert.equal(sets[0].domain, '.icloud.com');
  assert.equal(sets[0].value, 'token');
  assert.equal(sets[0].httpOnly, true);
  assert.equal(sets[0].storeId, '0');
  assert.ok(sets[0].expirationDate > Date.now() / 1000 + 29 * 24 * 60 * 60);
});

test('host-only, persistent, removed and non-iCloud cookies are handled correctly', async () => {
  const { browser } = mockBrowser();
  const sets = [];
  browser.cookies.set = async (details) => sets.push(details);
  const load = runtime(browser, async () => response(503));
  load('src/pages/Background/index.ts');
  const changes = [
    { removed: false, cookie: sessionCookie({ session: false }) },
    { removed: true, cookie: sessionCookie() },
    { removed: false, cookie: sessionCookie({ domain: '.example.com' }) },
    { removed: false, cookie: sessionCookie({ domain: '.noticloud.com' }) },
    {
      removed: false,
      cookie: sessionCookie({
        domain: 'setup.icloud.com.cn',
        hostOnly: true,
        path: '/setup',
      }),
    },
  ];
  for (const change of changes) await browser.cookies.onChanged.emit(change);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sets.length, 1);
  assert.equal(sets[0].url, 'https://setup.icloud.com.cn/setup');
  assert.equal('domain' in sets[0], false);
});

test('existing iCloud session cookies are persisted when the background starts', async () => {
  const { browser } = mockBrowser();
  const sets = [];
  browser.cookies.getAll = async ({ domain }) =>
    domain === 'icloud.com'
      ? [sessionCookie(), sessionCookie({ name: 'kept', session: false })]
      : [];
  browser.cookies.set = async (details) => sets.push(details);
  const load = runtime(browser, async () => response(503));
  load('src/pages/Background/index.ts');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    sets.map(({ name }) => name),
    ['X-APPLE-WEBAUTH-TOKEN']
  );
});

test('keep-alive alarm is created once and validates the session', async () => {
  const { browser, data } = mockBrowser({
    clientState: {
      setupUrl: 'https://setup.icloud.com/setup/ws/1',
      webservices: service,
    },
  });
  const alarms = [];
  browser.alarms.create = async (...args) => alarms.push(args);
  const calls = [];
  const load = runtime(browser, async (url) => {
    calls.push(url);
    return response(200, { webservices: service });
  });
  load('src/pages/Background/index.ts');
  const { KEEP_ALIVE_ALARM_NAME } = load('src/sessionPersistence.ts');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0][0], KEEP_ALIVE_ALARM_NAME);
  assert.ok(alarms[0][1].periodInMinutes > 0);

  await browser.alarms.onAlarm.emit({ name: KEEP_ALIVE_ALARM_NAME });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['https://setup.icloud.com/setup/ws/1/validate']);
  assert.equal(
    data.clientState.setupUrl,
    'https://setup.icloud.com/setup/ws/1'
  );
});

test('keep-alive does not sign out on connection failures', async () => {
  const saved = {
    setupUrl: 'https://setup.icloud.com/setup/ws/1',
    webservices: service,
  };
  const { browser, data } = mockBrowser({ clientState: saved, popupState: 0 });
  const load = runtime(browser, async () => response(503));
  load('src/pages/Background/index.ts');
  const { KEEP_ALIVE_ALARM_NAME } = load('src/sessionPersistence.ts');
  await browser.alarms.onAlarm.emit({ name: KEEP_ALIVE_ALARM_NAME });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(data.clientState, saved);
  assert.equal(data.popupState, 0);
});
