/* eslint-env browser, es2020 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { compile } = require('./helpers');

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});
const sources = Object.fromEntries(
  [
    'src/pages/Content/script.ts',
    'src/pages/Content/styles.ts',
    'src/messages.ts',
    'src/storage.ts',
    'src/pages/Popup/stateMachine.ts',
  ].map((file) => [file, compile(file)])
);
const hostSelector = '.d1691f0f-b8f0-495e-9ffb-fe4e6f84b518-host';

async function fixture(t, colorScheme = 'light') {
  const page = await browser.newPage({
    viewport: { width: 780, height: 600 },
    colorScheme,
  });
  t.after(() => page.close());
  await page.route('https://fixture.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<style>
      body { margin: 28px; background: ${
        colorScheme === 'dark' ? '#303030' : '#f3f5f8'
      }; font-family: system-ui; }
      input { padding: 16px; width: 440px; max-width: 90%; border: 1px solid #8793a4; border-radius: 14px; font-size: 18px; }
      button { background: magenta !important; font-size: 60px !important; }
      #second { display: block; margin-top: 100px; }
    </style><input id="first" type="email" placeholder="Email address"><input id="second" type="email" placeholder="Email address">`,
    })
  );
  await page.goto('https://fixture.test');
  await page.addStyleTag({
    content: fs.readFileSync(
      path.join(__dirname, '../src/pages/Content/index.css'),
      'utf8'
    ),
  });
  await page.evaluate(
    async ({ sources }) => {
      window.sent = [];
      window.listeners = new Set();
      window.storageListeners = new Set();
      window.roots = [];
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (options) {
        const root = attach.call(this, options);
        window.roots.push(root);
        return root;
      };
      const browser = {
        runtime: {
          sendMessage: async (message) => {
            window.sent.push(message);
          },
          onMessage: {
            addListener: (fn) => window.listeners.add(fn),
            removeListener: (fn) => window.listeners.delete(fn),
          },
        },
        storage: {
          local: { get: async () => ({}) },
          onChanged: {
            addListener: (fn) => window.storageListeners.add(fn),
            removeListener: (fn) => window.storageListeners.delete(fn),
          },
        },
      };
      const cache = {};
      const normalize = (file) => {
        const parts = [];
        file.split('/').forEach((part) => {
          if (part === '..') parts.pop();
          else if (part !== '.') parts.push(part);
        });
        return parts.join('/');
      };
      const load = (file) => {
        if (cache[file]) return cache[file].exports;
        const module = { exports: {} };
        cache[file] = module;
        const require = (name) => {
          if (name === 'webextension-polyfill') return browser;
          if (name === 'uuid') return { v4: () => crypto.randomUUID() };
          if (name.endsWith('.css')) return {};
          return load(
            normalize(file.slice(0, file.lastIndexOf('/') + 1) + name) + '.ts'
          );
        };
        new Function('require', 'module', 'exports', sources[file])(
          require,
          module,
          module.exports
        );
        return module.exports;
      };
      window.types = load('src/messages.ts').MessageType;
      window.start = load('src/pages/Content/script.ts').default;
      window.reply = (kind, data) => {
        const elementId = window.sent
          .filter((m) => m.type === window.types.GenerateRequest)
          .at(-1)?.data;
        for (const fn of window.listeners)
          fn({ type: window.types[kind], data: { elementId, ...data } });
      };
      await window.start();
    },
    { sources }
  );
  return page;
}

const buttonInfo = (page) =>
  page.evaluate(() => {
    const button = window.roots.at(-1).querySelector('button');
    return {
      state: button.dataset.state,
      text: button.textContent,
      disabled: button.getAttribute('aria-disabled') === 'true',
      color: getComputedStyle(button).backgroundColor,
      font: getComputedStyle(button).fontSize,
    };
  });
async function screenshot(page, name) {
  if (!process.env.HME_SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.HME_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(process.env.HME_SCREENSHOT_DIR, name),
    clip: { x: 0, y: 0, width: 520, height: 190 },
  });
}

const clickControl = (page) =>
  page.evaluate(() => window.roots.at(-1).querySelector('button').click());

test('one compact, isolated control survives refocus, moving fields, replacement, and reinjection', async (t) => {
  const page = await fixture(t);
  await page.locator('#first').focus();
  await page.evaluate(() =>
    window.reply('GenerateResponse', { hme: 'private@icloud.com' })
  );
  assert.equal((await buttonInfo(page)).state, 'ready');
  await screenshot(page, 'autofill-light.png');
  assert.equal((await buttonInfo(page)).font, '13px');
  assert.notEqual((await buttonInfo(page)).color, 'rgb(255, 0, 255)');
  assert.equal(await page.locator(hostSelector).count(), 1);
  const inputRect = await page.locator('#first').boundingBox();
  const rect = await page.locator(hostSelector).boundingBox();
  assert.ok(rect.width <= 360 && rect.height < 90);
  assert.ok(rect.y >= inputRect.y + inputRect.height);
  await page.locator('#second').focus();
  await page.locator('#first').focus();
  await page.evaluate(() =>
    document.body.append(document.querySelector('#first'))
  );
  await page.locator('#first').focus();
  await page.evaluate(async () => {
    await window.start();
    await window.start();
  });
  assert.equal(await page.locator(hostSelector).count(), 1);
  assert.equal(await page.evaluate(() => window.listeners.size), 1);
  await page.evaluate(() => {
    const old = document.querySelector('#first');
    old.replaceWith(old.cloneNode());
    document.querySelector('#first').focus();
  });
  await page.evaluate(() =>
    window.reply('GenerateResponse', { hme: 'new@icloud.com' })
  );
  assert.match((await buttonInfo(page)).text, /new@icloud.com/);
  assert.equal(await page.locator(hostSelector).count(), 1);
});

test('error retries and genuine expiry opens sign-in; authentication changes recover the control', async (t) => {
  const page = await fixture(t);
  await page.locator('#first').focus();
  await page.evaluate(() =>
    window.reply('GenerateResponse', { error: 'Temporary failure' })
  );
  assert.equal((await buttonInfo(page)).state, 'error');
  assert.equal((await buttonInfo(page)).disabled, false);
  await clickControl(page);
  assert.equal((await buttonInfo(page)).state, 'loading');
  await page.evaluate(() =>
    window.reply('GenerateResponse', { error: 'Sign in', signedOut: true })
  );
  assert.equal((await buttonInfo(page)).state, 'signed-out');
  await clickControl(page);
  assert.equal(
    await page.evaluate(() => window.sent.at(-1).type),
    await page.evaluate(() => window.types.OpenSignIn)
  );
  await page.evaluate(() => {
    for (const fn of window.storageListeners)
      fn({ clientState: { newValue: {} } }, 'local');
  });
  assert.equal((await buttonInfo(page)).state, 'loading');
});

test('stale responses cannot replace a newer field; reserving fills only the intended field and can be used again', async (t) => {
  const page = await fixture(t);
  await page.locator('#first').focus();
  const oldId = await page.evaluate(() => window.sent.at(-1).data);
  await page.locator('#second').focus();
  await page.evaluate(
    (elementId) =>
      window.reply('GenerateResponse', { elementId, hme: 'stale@icloud.com' }),
    oldId
  );
  assert.equal((await buttonInfo(page)).state, 'loading');
  await page.evaluate(() =>
    window.reply('GenerateResponse', { hme: 'private@icloud.com' })
  );
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal((await buttonInfo(page)).state, 'reserving');
  await page.evaluate(() =>
    window.reply('ReservationResponse', { hme: 'private@icloud.com' })
  );
  assert.equal(
    await page.locator('#second').inputValue(),
    'private@icloud.com'
  );
  assert.equal(await page.locator('#first').inputValue(), '');
  assert.equal(await page.locator(hostSelector).isVisible(), false);
  await page.locator('#first').focus();
  assert.equal(await page.locator(hostSelector).isVisible(), true);
});

test('dark theme, removal, escape dismissal, and changing autofill settings', async (t) => {
  const page = await fixture(t, 'dark');
  await page.locator('#first').focus();
  await page.evaluate(() =>
    window.reply('GenerateResponse', { hme: 'private@icloud.com' })
  );
  assert.equal((await buttonInfo(page)).color, 'rgb(32, 35, 41)');
  await screenshot(page, 'autofill-dark.png');
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await page.evaluate(() => Boolean(window.roots.at(-1).activeElement)),
    true
  );
  await page.keyboard.press('Escape');
  assert.equal(await page.locator(hostSelector).isVisible(), false);
  await page.locator('#second').focus();
  await page.evaluate(() => document.querySelector('#second').remove());
  await page.waitForFunction(
    (selector) => document.querySelector(selector).hidden,
    hostSelector
  );
  await page.evaluate(() => {
    for (const fn of window.storageListeners)
      fn(
        { iCloudHmeOptions: { newValue: { autofill: { button: false } } } },
        'local'
      );
  });
  await page.locator('#first').focus();
  assert.equal(await page.locator(hostSelector).isVisible(), false);
});

test('signing out invalidates pending replies and immediately offers sign-in', async (t) => {
  const page = await fixture(t);
  await page.locator('#first').focus();
  const elementId = await page.evaluate(() => window.sent.at(-1).data);
  await page.evaluate(() => {
    for (const fn of window.storageListeners)
      fn({ clientState: { oldValue: {} } }, 'local');
  });
  await page.evaluate(
    (elementId) =>
      window.reply('GenerateResponse', { elementId, hme: 'stale@icloud.com' }),
    elementId
  );
  assert.equal((await buttonInfo(page)).state, 'signed-out');
  assert.equal(await page.locator('#first').inputValue(), '');
});
