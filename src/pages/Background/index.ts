import {
  getBrowserStorageValue,
  setBrowserStorageValue,
  Store,
  DEFAULT_STORE,
  Options,
} from '../../storage';
import ICloudClient, {
  PremiumMailSettings,
  DEFAULT_SETUP_URL,
  CN_SETUP_URL,
  UnsuccessfulRequestError,
} from '../../iCloudClient';
import {
  ActiveInputElementWriteData,
  Message,
  MessageType,
  ReservationRequestData,
  sendMessageToTab,
} from '../../messages';
import browser from 'webextension-polyfill';
import {
  CONTEXT_MENU_ITEM_ID,
  LOADING_COPY,
  NOTIFICATION_MESSAGE_COPY,
  NOTIFICATION_TITLE_COPY,
  SIGNED_IN_CTA_COPY,
  SIGNED_OUT_CTA_COPY,
} from './constants';
import { isFirefox } from '../../browserUtils';
import { getAuthenticatedClient } from '../../session';

const performDeauthSideEffects = async (clearSession = false) => {
  await setBrowserStorageValue('popupState', DEFAULT_STORE.popupState);
  if (clearSession) {
    await setBrowserStorageValue('clientState', DEFAULT_STORE.clientState);
  }

  browser.contextMenus
    .update(CONTEXT_MENU_ITEM_ID, {
      title: SIGNED_OUT_CTA_COPY,
      enabled: false,
    })
    .catch(console.debug);
};

const performAuthSideEffects = async (
  client: ICloudClient,
  options: { notification?: boolean } = {}
) => {
  const { notification = false } = options;

  await setBrowserStorageValue('clientState', {
    setupUrl: client.setupUrl,
    webservices: client.webservices,
  });

  browser.contextMenus
    .update(CONTEXT_MENU_ITEM_ID, {
      title: SIGNED_IN_CTA_COPY,
      enabled: true,
    })
    .catch(console.debug);

  if (notification) {
    browser.notifications
      .create({
        type: 'basic',
        title: NOTIFICATION_TITLE_COPY,
        message: NOTIFICATION_MESSAGE_COPY,
        iconUrl: 'icon-128.png',
      })
      .catch(console.debug);
  }
};

// ===== Message handling =====

browser.runtime.onMessage.addListener(
  async (uncastedMessage: unknown, sender: browser.Runtime.MessageSender) => {
    const message = uncastedMessage as Message<unknown>;

    if (message.type === MessageType.OpenSignIn) {
      const state = await getBrowserStorageValue('clientState');
      await browser.tabs.create({
        url:
          state?.setupUrl === CN_SETUP_URL
            ? 'https://www.icloud.com.cn/'
            : 'https://www.icloud.com/',
      });
      return;
    }

    if (
      message.type !== MessageType.GenerateRequest &&
      message.type !== MessageType.ReservationRequest
    ) {
      return;
    }
    if (sender.tab?.id === undefined) return;

    const isGeneration = message.type === MessageType.GenerateRequest;
    const elementId = isGeneration
      ? (message.data as string)
      : (message.data as ReservationRequestData).elementId;
    const responseType = isGeneration
      ? MessageType.GenerateResponse
      : MessageType.ReservationResponse;
    const reply = (data: Record<string, unknown>) =>
      browser.tabs.sendMessage(
        sender.tab!.id!,
        {
          type: responseType,
          data: { ...data, elementId },
        },
        { frameId: sender.frameId }
      );

    try {
      const client = await getAuthenticatedClient();
      if (!client) {
        await performDeauthSideEffects();
        await reply({ error: SIGNED_OUT_CTA_COPY, signedOut: true });
        return;
      }
      await performAuthSideEffects(client);
      const pms = new PremiumMailSettings(client);
      if (isGeneration) {
        await reply({ hme: await pms.generateHme() });
      } else {
        const { hme, label } = message.data as ReservationRequestData;
        await pms.reserveHme(hme, label);
        await reply({ hme });
      }
    } catch (error) {
      const signedOut =
        error instanceof UnsuccessfulRequestError &&
        error.isAuthenticationError;
      if (signedOut) await performDeauthSideEffects();
      await reply({
        error: signedOut
          ? SIGNED_OUT_CTA_COPY
          : 'Couldn’t reach iCloud. Try again.',
        signedOut,
      });
    }
  }
);

// ===== Context menu =====

const setupContextMenu = async () => {
  const options =
    (await getBrowserStorageValue('iCloudHmeOptions')) ||
    DEFAULT_STORE.iCloudHmeOptions;

  browser.contextMenus.create(
    {
      id: CONTEXT_MENU_ITEM_ID,
      title: LOADING_COPY,
      contexts: ['editable'],
      enabled: false,
      visible: options.autofill.contextMenu,
    },
    async () => {
      try {
        const client = await getAuthenticatedClient();
        if (client) await performAuthSideEffects(client);
        else await performDeauthSideEffects();
      } catch (error) {
        console.debug('iCloud session check temporarily unavailable', error);
      }
    }
  );
};

// At any given time, there should be 1 created context menu item. We want to prevent
// the creation of multiple items that serve the same purpose (i.e. the context menu having multiple
// "Generate and reserve Hide My Email address" rows). We also want to prevent the lack of creation of one.
// Chromium persists the context menu state across browser restarts. Hence in Chromium, the context menu item is
// created once in the lifecycle of the extenstion's installation.
// On Firefox though, the context menu state is not persisted across browser restarts, meaning that the menu item
// will disappear once the user exits their browser session. For this reason, on Firefox, we create the context
// menu item each time the background script is loaded.
browser.runtime.onInstalled.addListener(setupContextMenu);

type OptionsStorageChange = {
  [K in keyof browser.Storage.StorageChange]: browser.Storage.StorageChange[K] extends unknown
    ? Options
    : browser.Storage.StorageChange[K];
};

// The following callback detects changes in the autofill config of the user
// and acts accordingly. In particular:
// * it hides the context menu item when the user un-checks the context menu option.
// * it makes the context menu item visible when the user checks the context menu option.
browser.storage.onChanged.addListener((changes, namespace) => {
  const iCloudHmeOptions = changes['iCloudHmeOptions' as keyof Store];
  if (namespace !== 'local' || iCloudHmeOptions === undefined) {
    return;
  }

  const { oldValue, newValue } = iCloudHmeOptions as OptionsStorageChange;

  if (oldValue?.autofill.contextMenu === newValue?.autofill.contextMenu) {
    // No change has been made to the context menu autofilling config.
    // There is no need to create or remove a context menu item.
    return;
  }

  browser.contextMenus
    .update(CONTEXT_MENU_ITEM_ID, {
      visible: newValue?.autofill.contextMenu,
    })
    .catch(console.debug);
});

// Upon clicking on the context menu item, we generate an email, reserve it, and emit it back to the content script
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ITEM_ID) {
    return;
  }

  sendMessageToTab(
    MessageType.ActiveInputElementWrite,
    { text: LOADING_COPY } as ActiveInputElementWriteData,
    tab
  );

  const serializedUrl = info.pageUrl || tab?.url;
  const hostname = serializedUrl ? new URL(serializedUrl).hostname : '';

  try {
    const client = await getAuthenticatedClient();

    if (!client) {
      sendMessageToTab(
        MessageType.ActiveInputElementWrite,
        {
          text: SIGNED_OUT_CTA_COPY,
          copyToClipboard: false,
        } as ActiveInputElementWriteData,
        tab
      );
      performDeauthSideEffects();
      return;
    }

    const pms = new PremiumMailSettings(client);
    const hme = await pms.generateHme();
    await pms.reserveHme(hme, hostname);
    await sendMessageToTab(
      MessageType.ActiveInputElementWrite,
      { text: hme, copyToClipboard: true } as ActiveInputElementWriteData,
      tab
    );
  } catch (e) {
    sendMessageToTab(
      MessageType.ActiveInputElementWrite,
      {
        text: e.toString(),
        copyToClipboard: false,
      } as ActiveInputElementWriteData,
      tab
    );
  }
});

// ===== Non-blocking webrequest listeners (used for syncing the authentication state of the user) =====

// The extension needs to be in sync with the icloud.com authentication state of the browser.
// For example, when the user is authenticated we need to render the context menu item
// as enabled.
browser.webRequest.onCompleted.addListener(
  async (details: browser.WebRequest.OnCompletedDetailsType) => {
    const { statusCode, url } = details;
    if (statusCode < 200 || statusCode > 299) {
      console.debug('Request failed', details);
      return;
    }

    const setupUrl = url.split('/accountLogin')[0] as ICloudClient['setupUrl'];
    const client = new ICloudClient(setupUrl);
    try {
      if (await client.isAuthenticated()) {
        await performAuthSideEffects(client, { notification: true });
      }
    } catch (error) {
      console.debug('iCloud session check temporarily unavailable', error);
    }
  },
  {
    urls: [
      `${DEFAULT_SETUP_URL}/accountLogin*`,
      `${CN_SETUP_URL}/accountLogin*`,
    ],
  },
  []
);

// When the user signs out of their account through icloud.com, we should
// perform various side effects (e.g. disabling the context menu item)
browser.webRequest.onCompleted.addListener(
  async (details: browser.WebRequest.OnCompletedDetailsType) => {
    const { statusCode } = details;
    if (statusCode < 200 || statusCode > 299) {
      console.debug('Request failed', details);
      return;
    }

    await performDeauthSideEffects(true);
  },
  {
    urls: [`${DEFAULT_SETUP_URL}/logout*`, `${CN_SETUP_URL}/logout*`],
  },
  []
);

// ===== Post installation hooks =====

// Sync the extension with the authentication state of the browser.
// If the user is already authenticated, they should not need to
// log out and log back in in order to get the extension working.
browser.runtime.onInstalled.addListener(
  async (details: browser.Runtime.OnInstalledDetailsType) => {
    if (['install', 'update'].includes(details.reason)) {
      try {
        const client = await getAuthenticatedClient();
        if (client)
          await performAuthSideEffects(client, { notification: true });
        else await performDeauthSideEffects();
      } catch (error) {
        console.debug('iCloud session check temporarily unavailable', error);
      }
    }
  }
);

// Present the user with a getting-started guide.
browser.runtime.onInstalled.addListener(
  async (details: browser.Runtime.OnInstalledDetailsType) => {
    const userguideUrl = browser.runtime.getURL('userguide.html');

    if (details.reason === 'install') {
      chrome.tabs.create({ url: userguideUrl }).then(console.debug);
    }
  }
);

// On Firefox the context menu state is not persisted across browser restarts, meaning that the menu item
// will disappear once the user quits their browser. Hence on Firefox, we create the context
// menu item each time the background script is loaded.
if (isFirefox) {
  setupContextMenu();
}
