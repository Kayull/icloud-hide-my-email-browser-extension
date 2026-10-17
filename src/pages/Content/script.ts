import {
  ActiveInputElementWriteData,
  GenerationResponseData,
  Message,
  MessageType,
  ReservationRequestData,
} from '../../messages';
import { v4 as uuidv4 } from 'uuid';
import './index.css';
import browser from 'webextension-polyfill';
import { getBrowserStorageValue, Options } from '../../storage';
import { AUTOFILL_STYLES } from './styles';

const EMAIL_INPUT_QUERY =
  'input[type="email"], input[name="email"], input[id="email"], input[autocomplete="email"]';
const HOST_CLASS = 'd1691f0f-b8f0-495e-9ffb-fe4e6f84b518-host';
const controllerWindow = window as Window & {
  __icloudHmeCleanup?: () => void;
};

type ButtonState = 'loading' | 'ready' | 'signed-out' | 'error' | 'reserving';

function fillInput(input: HTMLInputElement, value: string): void {
  // Use the native setter so controlled inputs (including React) see the change.
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export default async function main(): Promise<void> {
  // Content scripts can be reinjected. Dispose the previous controller first.
  controllerWindow.__icloudHmeCleanup?.();
  let disposed = false;
  let enabled = true;
  let activeInput: HTMLInputElement | undefined;
  let requestId = '';
  let state: ButtonState = 'loading';
  let hme: string | undefined;
  let onCleanup = () => {
    disposed = true;
  };
  const cleanup = () => onCleanup();
  controllerWindow.__icloudHmeCleanup = cleanup;

  const options = await getBrowserStorageValue('iCloudHmeOptions');
  if (disposed) return;
  enabled = options?.autofill.button !== false;

  // A single shared control prevents duplicate buttons, even on dynamic forms.
  const host = document.createElement('div');
  host.className = HOST_CLASS;
  host.hidden = true;
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = AUTOFILL_STYLES;
  const button = document.createElement('button');
  button.type = 'button';
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '✉';
  const copy = document.createElement('span');
  copy.className = 'copy';
  const title = document.createElement('span');
  title.className = 'title';
  const detail = document.createElement('span');
  detail.className = 'detail';
  detail.setAttribute('aria-live', 'polite');
  const action = document.createElement('span');
  action.className = 'action';
  action.setAttribute('aria-hidden', 'true');
  copy.append(title, detail);
  button.append(icon, copy, action);
  shadow.append(style, button);
  document.documentElement.append(host);

  const render = (next: ButtonState, error?: string) => {
    state = next;
    const busy = state === 'loading' || state === 'reserving';
    // Native disabling drops keyboard focus and can lose the reservation target.
    button.setAttribute('aria-disabled', String(busy));
    button.dataset.state = state;
    button.setAttribute('aria-busy', String(busy));
    title.textContent =
      state === 'signed-out' ? 'Connect to iCloud' : 'Hide My Email';
    detail.textContent = {
      loading: 'Connecting to iCloud…',
      reserving: 'Creating your private address…',
      ready: hme || '',
      'signed-out': 'Sign in to create a private address',
      error: error || 'Couldn’t reach iCloud. Try again.',
    }[state];
    action.textContent = {
      loading: '•••',
      reserving: '•••',
      ready: 'Use',
      'signed-out': 'Sign in ↗',
      error: 'Retry ↻',
    }[state];
    button.title = state === 'ready' ? `Use ${hme}` : detail.textContent;
  };

  const hide = () => {
    host.hidden = true;
    activeInput = undefined;
    requestId = '';
  };

  const position = () => {
    if (!activeInput || host.hidden) return;
    if (
      !activeInput.isConnected ||
      activeInput.disabled ||
      activeInput.readOnly
    ) {
      hide();
      return;
    }
    const rect = activeInput.getBoundingClientRect();
    if (
      !rect.width ||
      !rect.height ||
      rect.bottom < 0 ||
      rect.top > innerHeight
    ) {
      hide();
      return;
    }
    const width = Math.min(360, Math.max(240, rect.width), innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
    host.style.setProperty('width', `${width}px`, 'important');
    host.style.setProperty('left', `${left}px`, 'important');
    const height = host.getBoundingClientRect().height;
    host.style.setProperty(
      'top',
      `${Math.max(
        8,
        rect.bottom + height + 8 > innerHeight
          ? rect.top - height - 6
          : rect.bottom + 6
      )}px`,
      'important'
    );
  };

  const generate = async () => {
    requestId = uuidv4();
    const id = requestId;
    hme = undefined;
    render('loading');
    try {
      await browser.runtime.sendMessage({
        type: MessageType.GenerateRequest,
        data: id,
      });
    } catch {
      if (requestId === id)
        render('error', 'Extension updated. Reload this page to reconnect.');
    }
  };

  const onFocus = (event: FocusEvent) => {
    const input = event.target;
    if (input === host) return;
    if (
      !enabled ||
      !(input instanceof HTMLInputElement) ||
      !input.matches(EMAIL_INPUT_QUERY) ||
      input.disabled ||
      input.readOnly
    ) {
      hide();
      return;
    }
    if (activeInput === input && !host.hidden) return;
    activeInput = input;
    host.hidden = false;
    render('loading');
    position();
    void generate();
  };

  const onBlur = () => {
    // Let focus reach the control before deciding whether to dismiss it.
    queueMicrotask(() => {
      if (document.activeElement !== activeInput && !shadow.activeElement)
        hide();
    });
  };

  button.addEventListener('mousedown', (event) => {
    // Keep the input focused for pointer use; native clicks also support keyboard use.
    if (event.button === 0) event.preventDefault();
  });
  button.addEventListener('click', async () => {
    if (!activeInput || state === 'loading' || state === 'reserving') return;
    if (state === 'signed-out') {
      try {
        await browser.runtime.sendMessage({ type: MessageType.OpenSignIn });
      } catch {
        render('error', 'Extension updated. Reload this page to reconnect.');
      }
      return;
    }
    if (state === 'error') {
      await generate();
      return;
    }
    if (!hme) return;
    render('reserving');
    const id = requestId;
    try {
      await browser.runtime.sendMessage({
        type: MessageType.ReservationRequest,
        data: { hme, label: location.host, elementId: id },
      } as Message<ReservationRequestData>);
    } catch {
      if (requestId === id) render('error');
    }
  });

  const onKeydown = (event: KeyboardEvent) => {
    if (host.hidden) return;
    if (
      event.key === 'ArrowDown' &&
      event.target === activeInput &&
      state !== 'loading' &&
      state !== 'reserving'
    ) {
      event.preventDefault();
      button.focus();
    }
    if (event.key === 'Escape') {
      activeInput?.focus();
      hide();
    }
  };

  const onMessage = (raw: unknown) => {
    const message = raw as Message<unknown>;
    if (message.type === MessageType.Autofill) {
      document
        .querySelectorAll<HTMLInputElement>(EMAIL_INPUT_QUERY)
        .forEach((input) => {
          if (!input.disabled && !input.readOnly)
            fillInput(input, message.data as string);
        });
      hide();
    } else if (message.type === MessageType.ActiveInputElementWrite) {
      const input = document.activeElement;
      if (!(input instanceof HTMLInputElement)) return;
      const { text, copyToClipboard } =
        message.data as ActiveInputElementWriteData;
      fillInput(input, text);
      if (copyToClipboard)
        void navigator.clipboard.writeText(text).catch(console.debug);
      hide();
    } else if (
      message.type === MessageType.GenerateResponse ||
      message.type === MessageType.ReservationResponse
    ) {
      const data = message.data as GenerationResponseData;
      if (data.elementId !== requestId || !activeInput?.isConnected) return;
      if (data.error) {
        render(data.signedOut ? 'signed-out' : 'error', data.error);
      } else if (data.hme) {
        if (message.type === MessageType.ReservationResponse) {
          fillInput(activeInput, data.hme);
          activeInput.focus();
          hide();
        } else {
          hme = data.hme;
          render('ready');
        }
      } else {
        render('error');
      }
      position();
    }
  };

  const onStorageChange = (
    changes: Record<string, browser.Storage.StorageChange>,
    area: string
  ) => {
    if (area !== 'local') return;
    if (changes.iCloudHmeOptions) {
      enabled =
        (changes.iCloudHmeOptions.newValue as Options | undefined)?.autofill
          .button !== false;
      if (!enabled) hide();
    }
    if (changes.clientState && activeInput) {
      if (!changes.clientState.newValue) {
        requestId = uuidv4();
        hme = undefined;
        render('signed-out');
      } else if (state === 'signed-out') {
        void generate();
      }
    }
  };
  const observer = new MutationObserver(position);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
  });
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onBlur);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('scroll', position, true);
  window.addEventListener('resize', position);
  browser.runtime.onMessage.addListener(onMessage);
  browser.storage.onChanged.addListener(onStorageChange);

  onCleanup = () => {
    disposed = true;
    hide();
    observer.disconnect();
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', onBlur);
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('scroll', position, true);
    window.removeEventListener('resize', position);
    browser.runtime.onMessage.removeListener(onMessage);
    browser.storage.onChanged.removeListener(onStorageChange);
    host.remove();
  };
  if (document.activeElement instanceof HTMLInputElement) {
    onFocus({ target: document.activeElement } as unknown as FocusEvent);
  }
}
