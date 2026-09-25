import type { Profile, TabConfig } from './types';

const TAB_PREFIX = 'tab:';
const ERROR_PREFIX = 'error:';
const PROFILES_KEY = 'profiles';
const PAUSED_KEY = 'paused';

export const tabKey = (tabId: number) => `${TAB_PREFIX}${tabId}`;
export const errorKey = (tabId: number) => `${ERROR_PREFIX}${tabId}`;

export const emptyTabConfig = (): TabConfig => ({ enabled: true, headers: [], domains: '' });

export async function getTabConfig(tabId: number): Promise<TabConfig> {
  const key = tabKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return (stored[key] as TabConfig | undefined) ?? emptyTabConfig();
}

export async function setTabConfig(tabId: number, config: TabConfig): Promise<void> {
  await chrome.storage.session.set({ [tabKey(tabId)]: config });
}

export async function removeTab(tabId: number): Promise<void> {
  await chrome.storage.session.remove([tabKey(tabId), errorKey(tabId)]);
}

export async function getAllTabConfigs(): Promise<Map<number, TabConfig>> {
  const all = await chrome.storage.session.get(null);
  const configs = new Map<number, TabConfig>();
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(TAB_PREFIX)) configs.set(Number(key.slice(TAB_PREFIX.length)), value as TabConfig);
  }
  return configs;
}

/** Errors Chrome reported when installing a tab's rule, keyed by tab, so the popup can show them. */
export async function setTabErrors(errors: Map<number, string>): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const stale = Object.keys(all).filter((k) => k.startsWith(ERROR_PREFIX));
  if (stale.length) await chrome.storage.session.remove(stale);
  if (errors.size) {
    await chrome.storage.session.set(Object.fromEntries([...errors].map(([tabId, msg]) => [errorKey(tabId), msg])));
  }
}

export async function getTabError(tabId: number): Promise<string | undefined> {
  const key = errorKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] as string | undefined;
}

export async function getProfiles(): Promise<Profile[]> {
  const stored = await chrome.storage.local.get(PROFILES_KEY);
  return (stored[PROFILES_KEY] as Profile[] | undefined) ?? [];
}

export async function setProfiles(profiles: Profile[]): Promise<void> {
  await chrome.storage.local.set({ [PROFILES_KEY]: profiles });
}

export async function getPaused(): Promise<boolean> {
  const stored = await chrome.storage.local.get(PAUSED_KEY);
  return stored[PAUSED_KEY] === true;
}

export async function setPaused(paused: boolean): Promise<void> {
  await chrome.storage.local.set({ [PAUSED_KEY]: paused });
}

export const isPausedChange = (changes: Record<string, unknown>, area: string) =>
  area === 'local' && PAUSED_KEY in changes;
