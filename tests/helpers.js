/* eslint-env es2020 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function compile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
}

function event() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) =>
      Promise.all([...listeners].map((listener) => listener(...args))),
  };
}

function mockBrowser(initial = {}) {
  const data = structuredClone(initial);
  const onChanged = event();
  const browser = {
    storage: {
      local: {
        get: async (key) => ({ [key]: data[key] }),
        set: async (values) => {
          for (const [key, value] of Object.entries(values)) {
            if (JSON.stringify(data[key]) === JSON.stringify(value)) continue;
            const oldValue = data[key];
            data[key] = value;
            await onChanged.emit(
              { [key]: { oldValue, newValue: value } },
              'local'
            );
          }
        },
        remove: async (key) => {
          const oldValue = data[key];
          delete data[key];
          await onChanged.emit({ [key]: { oldValue } }, 'local');
        },
      },
      onChanged,
    },
    runtime: {
      id: 'test',
      getURL: (p) => `chrome-extension://test/${p}`,
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
    },
    cookies: {
      getAllCookieStores: async () => [{ id: '0' }],
      getAll: async () => [],
      set: async (details) => details,
      onChanged: event(),
    },
    alarms: {
      get: async () => undefined,
      create: async () => {},
      onAlarm: event(),
    },
    tabs: { sendMessage: async () => {}, create: async () => {} },
    contextMenus: {
      update: async () => {},
      create: () => {},
      onClicked: event(),
    },
    notifications: { create: async () => {} },
    webRequest: { onResponseStarted: event(), onCompleted: event() },
  };
  return { browser, data };
}

function runtime(browser, fetch) {
  const cache = {};
  const context = vm.createContext({
    console,
    fetch,
    AbortSignal,
    chrome: browser,
  });
  function load(file) {
    if (cache[file]) return cache[file].exports;
    const module = { exports: {} };
    cache[file] = module;
    const requireModule = (name) => {
      if (name === 'webextension-polyfill') return browser;
      if (!name.startsWith('.')) return require(name);
      return load(
        path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) +
          '.ts'
      );
    };
    const run = vm.runInContext(
      `(function(require, module, exports) {${compile(file)}\n})`,
      context
    );
    run(requireModule, module, module.exports);
    return module.exports;
  }
  return load;
}

module.exports = { compile, mockBrowser, runtime };
