import browser from 'webextension-polyfill';

// iCloud only issues long-lived cookies when "Keep me signed in" is ticked,
// which is not offered when signing in with a passkey. The remaining session
// cookies are dropped whenever the browser quits, so we give them an expiry.
const ICLOUD_COOKIE_DOMAINS = ['icloud.com', 'icloud.com.cn'];
const PERSISTED_COOKIE_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export const KEEP_ALIVE_ALARM_NAME = 'icloud-session-keep-alive';
export const KEEP_ALIVE_PERIOD_MINUTES = 20;

export function isICloudCookie(cookie: browser.Cookies.Cookie): boolean {
  const domain = cookie.domain.replace(/^\./, '');
  return ICLOUD_COOKIE_DOMAINS.some(
    (icloudDomain) =>
      domain === icloudDomain || domain.endsWith(`.${icloudDomain}`)
  );
}

export async function persistCookie(
  cookie: browser.Cookies.Cookie
): Promise<void> {
  if (!cookie.session || !isICloudCookie(cookie)) return;

  const host = cookie.domain.replace(/^\./, '');
  await browser.cookies.set({
    url: `https://${host}${cookie.path}`,
    name: cookie.name,
    value: cookie.value,
    // Host-only cookies (including __Host- ones) must not be given a domain.
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    storeId: cookie.storeId,
    ...(cookie.firstPartyDomain
      ? { firstPartyDomain: cookie.firstPartyDomain }
      : {}),
    ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
    expirationDate:
      Math.floor(Date.now() / 1000) + PERSISTED_COOKIE_LIFETIME_SECONDS,
  });
}

export async function persistSessionCookies(): Promise<void> {
  const stores = await browser.cookies.getAllCookieStores();
  for (const { id: storeId } of stores) {
    for (const domain of ICLOUD_COOKIE_DOMAINS) {
      const cookies = await browser.cookies.getAll({ domain, storeId });
      await Promise.all(cookies.map((cookie) => persistCookie(cookie)));
    }
  }
}
