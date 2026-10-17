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
const saved = {
  setupUrl: 'https://setup.icloud.com.cn/setup/ws/1',
  webservices: service,
};
const response = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('sends and accepts iCloud session cookies; keeps the selected region and refreshes service URLs', async () => {
  const { browser, data } = mockBrowser({ clientState: saved });
  const calls = [];
  const fresh = {
    premiummailsettings: {
      ...service.premiummailsettings,
      url: 'https://p02-maildomainws.icloud.com.cn',
    },
  };
  const load = runtime(browser, async (url, options) => {
    calls.push({ url, options });
    return response(200, { webservices: fresh });
  });
  const client = await load('src/session.ts').getAuthenticatedClient();
  assert.equal(calls[0].url, `${saved.setupUrl}/validate`);
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(
    client.webserviceUrl('premiummailsettings'),
    fresh.premiummailsettings.url
  );
  assert.equal(
    data.clientState.webservices.premiummailsettings.url,
    fresh.premiummailsettings.url
  );
});

for (const status of [401, 403, 421, 450]) {
  test(`expired session (${status}) requires sign-in while preserving region`, async () => {
    const { browser, data } = mockBrowser({ clientState: saved });
    const load = runtime(browser, async () => response(status));
    assert.equal(
      await load('src/session.ts').getAuthenticatedClient(),
      undefined
    );
    assert.deepEqual(data.clientState, saved);
  });
}

for (const failure of [429, 500, 503, 'offline', 'timeout', 'invalid-json']) {
  test(`${failure} remains a retryable error and keeps the saved session`, async () => {
    const { browser, data } = mockBrowser({
      clientState: saved,
      popupState: 0,
    });
    const load = runtime(browser, async () => {
      if (failure === 'offline') throw new TypeError('Failed to fetch');
      if (failure === 'timeout')
        throw new DOMException('Timed out', 'TimeoutError');
      if (failure === 'invalid-json')
        return {
          ok: true,
          json: async () => {
            throw new SyntaxError('invalid');
          },
        };
      return response(failure);
    });
    await assert.rejects(load('src/session.ts').getAuthenticatedClient());
    assert.deepEqual(data.clientState, saved);
    assert.equal(data.popupState, 0);
  });
}

test('recovers browser authentication with no saved extension session, including China', async () => {
  const { browser, data } = mockBrowser();
  const calls = [];
  const load = runtime(browser, async (url) => {
    calls.push(url);
    return url.includes('.com.cn')
      ? response(200, { webservices: service })
      : response(421);
  });
  const client = await load('src/session.ts').getAuthenticatedClient();
  assert.equal(calls.length, 2);
  assert.equal(client.setupUrl, saved.setupUrl);
  assert.equal(data.clientState.setupUrl, saved.setupUrl);
});

test('simultaneous requests share validation; the next request checks the browser session again', async () => {
  const { browser } = mockBrowser({ clientState: saved });
  let calls = 0;
  const load = runtime(browser, async () => {
    calls++;
    return response(200, { webservices: service });
  });
  const { getAuthenticatedClient } = load('src/session.ts');
  await Promise.all([getAuthenticatedClient(), getAuthenticatedClient()]);
  assert.equal(calls, 1);
  await getAuthenticatedClient();
  assert.equal(calls, 2);
});

test('background replies to the originating tab and frame even if another tab is active', async () => {
  const { browser } = mockBrowser({ clientState: saved });
  const replies = [];
  browser.tabs.sendMessage = async (...args) => replies.push(args);
  const load = runtime(browser, async (url) =>
    response(
      200,
      url.endsWith('/validate')
        ? { webservices: service }
        : { success: true, result: { hme: 'private@icloud.com' } }
    )
  );
  load('src/pages/Background/index.ts');
  const { MessageType } = load('src/messages.ts');
  await browser.runtime.onMessage.emit(
    { type: MessageType.GenerateRequest, data: 'request-1' },
    { tab: { id: 17 }, frameId: 3 }
  );
  assert.equal(replies.length, 1);
  assert.equal(replies[0][0], 17);
  assert.equal(replies[0][2].frameId, 3);
  assert.equal(replies[0][1].data.hme, 'private@icloud.com');
});

test('background connection failures do not sign out the user', async () => {
  const { browser, data } = mockBrowser({ clientState: saved, popupState: 0 });
  const replies = [];
  browser.tabs.sendMessage = async (...args) => replies.push(args);
  const load = runtime(browser, async () => response(503));
  load('src/pages/Background/index.ts');
  const { MessageType } = load('src/messages.ts');
  await browser.runtime.onMessage.emit(
    { type: MessageType.GenerateRequest, data: 'request-1' },
    { tab: { id: 17 }, frameId: 0 }
  );
  assert.equal(replies[0][1].data.signedOut, false);
  assert.equal(data.popupState, 0);
  assert.deepEqual(data.clientState, saved);
});

test('failed iCloud logout responses do not erase the session', async () => {
  const { browser, data } = mockBrowser({ clientState: saved, popupState: 0 });
  const load = runtime(browser, async () =>
    response(200, { webservices: service })
  );
  load('src/pages/Background/index.ts');
  await browser.webRequest.onCompleted.emit({
    statusCode: 503,
    url: `${saved.setupUrl}/logout`,
  });
  assert.deepEqual(data.clientState, saved);
});
