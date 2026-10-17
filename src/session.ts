import isEqual from 'lodash.isequal';
import ICloudClient, { CN_SETUP_URL, DEFAULT_SETUP_URL } from './iCloudClient';
import { getBrowserStorageValue, setBrowserStorageValue } from './storage';

// Only share an in-flight validation; never cache the authentication result.
let pendingValidation: Promise<ICloudClient | undefined> | undefined;

export function getAuthenticatedClient(): Promise<ICloudClient | undefined> {
  if (!pendingValidation) {
    pendingValidation = validateSession().finally(() => {
      pendingValidation = undefined;
    });
  }
  return pendingValidation;
}

async function validateSession(): Promise<ICloudClient | undefined> {
  const state = await getBrowserStorageValue('clientState');
  // Recover an existing browser session even after extension storage was reset.
  const setupUrls: ICloudClient['setupUrl'][] = state
    ? [state.setupUrl]
    : [DEFAULT_SETUP_URL, CN_SETUP_URL];
  for (const setupUrl of setupUrls) {
    const client = new ICloudClient(setupUrl);
    if (await client.isAuthenticated()) {
      const refreshedState = {
        setupUrl: client.setupUrl,
        webservices: client.webservices,
      };
      if (!isEqual(state, refreshedState)) {
        await setBrowserStorageValue('clientState', refreshedState);
      }
      return client;
    }
  }
  return undefined;
}
