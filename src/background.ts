import { activeHeaders, buildRules } from './rules';
import { getAllTabConfigs, getPaused, isPausedChange, removeTab, setTabErrors } from './storage';

const dnr = chrome.declarativeNetRequest;

/**
 * Replaces every session rule with ones built from storage. Storage is the source of truth;
 * rules are always rebuilt from scratch so they can never drift from what the popup shows.
 */
async function sync(): Promise<void> {
  const [configs, paused, existing] = await Promise.all([getAllTabConfigs(), getPaused(), dnr.getSessionRules()]);
  const { rules, tabOf } = paused ? { rules: [], tabOf: new Map<number, number>() } : buildRules(configs);
  const removeRuleIds = existing.map((r) => r.id);
  const errors = new Map<number, string>();

  try {
    await dnr.updateSessionRules({ removeRuleIds, addRules: rules });
  } catch {
    // The batch is atomic, so one bad header would block every tab. Fall back to one rule at a time
    // and pin the failure on the tab that caused it.
    await dnr.updateSessionRules({ removeRuleIds });
    for (const rule of rules) {
      try {
        await dnr.updateSessionRules({ addRules: [rule] });
      } catch (err) {
        errors.set(tabOf.get(rule.id)!, err instanceof Error ? err.message : String(err));
      }
    }
  }

  await setTabErrors(errors);
  await updateBadges();
}

async function updateBadges(): Promise<void> {
  const [configs, paused, tabs] = await Promise.all([getAllTabConfigs(), getPaused(), chrome.tabs.query({})]);
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const count = paused
      ? 0
      : activeHeaders(configs.get(tab.id) ?? { enabled: false, headers: [], domains: '' }).length;
    await chrome.action.setBadgeText({ tabId: tab.id, text: count ? String(count) : '' });
  }
  await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  await chrome.action.setTitle({ title: paused ? 'TabHeaders (paused)' : 'TabHeaders' });
}

// Storage events can arrive in bursts (typing in the popup); run syncs one at a time.
let queue: Promise<void> = Promise.resolve();
const scheduleSync = () => {
  queue = queue.then(sync).catch((err) => console.error('tab-headers: sync failed', err));
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && Object.keys(changes).some((k) => k.startsWith('tab:'))) scheduleSync();
  if (isPausedChange(changes, area)) scheduleSync();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeTab(tabId);
});

// Chrome may reset per-tab badge text when a tab navigates.
chrome.tabs.onUpdated.addListener((_tabId, info) => {
  if (info.status === 'loading') queue = queue.then(updateBadges).catch(() => {});
});

// The popup asks for a sync before reloading a tab, so the reload is guaranteed to carry the new headers.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'sync') return false;
  scheduleSync();
  queue.then(() => sendResponse(true));
  return true;
});

chrome.runtime.onInstalled.addListener(scheduleSync);
chrome.runtime.onStartup.addListener(scheduleSync);
