import { activeHeaders, headerNameError, headerValueError, overriddenRowIds, splitDomains } from './rules';
import {
  errorKey,
  getPaused,
  getProfiles,
  getTabConfig,
  getTabError,
  setPaused,
  setProfiles,
  setTabConfig
} from './storage';
import type { HeaderRow, Profile, TabConfig } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  globalOn: $<HTMLInputElement>('global-on'),
  globalLabel: $('global-label'),
  tabHost: $('tab-host'),
  status: $('status'),
  statusText: $('status-text'),
  reload: $<HTMLButtonElement>('reload'),
  tabOn: $<HTMLInputElement>('tab-on'),
  notice: $('notice'),
  noticeTitle: $('notice-title'),
  noticeBody: $('notice-body'),
  headers: $('headers'),
  rows: $<HTMLUListElement>('rows'),
  empty: $('empty'),
  add: $<HTMLButtonElement>('add'),
  domainsBox: $<HTMLDetailsElement>('domains-box'),
  domainsSummary: $('domains-summary'),
  domains: $<HTMLInputElement>('domains'),
  domainsHint: $('domains-hint'),
  profileSelect: $<HTMLSelectElement>('profile-select'),
  profileApply: $<HTMLButtonElement>('profile-apply'),
  profileDelete: $<HTMLButtonElement>('profile-delete'),
  profileForm: $<HTMLFormElement>('profile-form'),
  profileName: $<HTMLInputElement>('profile-name'),
  profileSave: $<HTMLButtonElement>('profile-save'),
  toast: $('toast'),
  toastText: $('toast-text'),
  toastUndo: $<HTMLButtonElement>('toast-undo'),
  rowTemplate: $<HTMLTemplateElement>('row-template')
};

const DOMAINS_HINT = 'Subdomains are included. Leave empty to send on every request.';

let tabId: number;
let isWebPage = false;
let config: TabConfig;
let profiles: Profile[] = [];
let paused = false;
let tabError: string | undefined;
/** What the tab's last page load was sent with; when it differs from now, the page needs a reload. */
let loadedSignature = '';

const newRow = (name = '', value = ''): HeaderRow => ({ id: crypto.randomUUID(), name, value, enabled: true });
const cloneHeaders = (headers: HeaderRow[]) => headers.map((h) => ({ ...h, id: crypto.randomUUID() }));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function signature(): string {
  if (paused) return '';
  const headers = activeHeaders(config).map((h) => [h.name.trim().toLowerCase(), h.value]);
  return headers.length ? JSON.stringify([headers, splitDomains(config.domains).valid]) : '';
}

// ---- Saving -------------------------------------------------------------------------------------

// Saving on every keystroke would rebuild Chrome's rules for each character typed.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingWrite: Promise<void> = Promise.resolve();

function save(immediate = false) {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const write = () => {
    saveTimer = undefined;
    pendingWrite = setTabConfig(tabId, config);
  };
  if (immediate) write();
  else saveTimer = setTimeout(write, 250);
  renderStatus();
}

async function flush() {
  if (saveTimer !== undefined) save(true);
  await pendingWrite;
}

// ---- Toast with undo ----------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let undoAction: (() => void) | undefined;

function toast(message: string, undo?: () => void) {
  clearTimeout(toastTimer);
  els.toastText.textContent = message;
  undoAction = undo;
  els.toastUndo.hidden = !undo;
  els.toast.hidden = false;
  toastTimer = setTimeout(hideToast, undo ? 6000 : 2500);
}

function hideToast() {
  els.toast.hidden = true;
  undoAction = undefined;
}

/** Replaces the tab's config and offers to put the previous one back. */
function replaceConfig(next: TabConfig, message: string) {
  const previous = structuredClone(config);
  config = next;
  save(true);
  renderTab();
  toast(message, () => {
    config = previous;
    save(true);
    renderTab();
  });
}

// ---- Rendering ----------------------------------------------------------------------------------

function renderStatus() {
  const count = activeHeaders(config).length;
  const { valid } = splitDomains(config.domains);
  let state: string;
  let text: string;

  if (paused) {
    state = 'paused';
    text = 'Paused in every tab';
  } else if (tabError) {
    state = 'error';
    text = 'Chrome refused these headers';
  } else if (!config.enabled) {
    state = 'off';
    text = 'Off in this tab';
  } else if (!count) {
    state = 'idle';
    text = config.headers.length ? 'No headers sent yet' : 'No headers yet';
  } else {
    state = 'sending';
    const where = valid.length
      ? `to ${valid[0]}${valid.length > 1 ? ` +${valid.length - 1}` : ''}`
      : 'on every request';
    text = `Sending ${plural(count, 'header')} ${where}`;
  }

  els.status.dataset.state = state;
  els.statusText.textContent = text;
  els.headers.classList.toggle('inactive', paused || !config.enabled);
  els.tabOn.checked = config.enabled;
  els.tabOn.setAttribute('aria-checked', String(config.enabled));
  els.tabOn.disabled = paused;

  const needsReload = isWebPage && signature() !== loadedSignature;
  els.reload.hidden = !needsReload;
}

function renderNotice() {
  const show = (tone: 'warn' | 'danger' | 'info', title: string, body: string) => {
    els.notice.hidden = false;
    els.notice.dataset.tone = tone;
    els.noticeTitle.textContent = title;
    els.noticeBody.textContent = body;
  };
  if (tabError) show('danger', 'Chrome refused this tab’s headers', tabError);
  else if (paused)
    show('warn', 'All tabs are paused', 'No headers are sent anywhere until you switch TabHeaders back on.');
  else if (!isWebPage)
    show(
      'info',
      'Chrome doesn’t let extensions change this page',
      'Your headers are kept and apply as soon as this tab opens a website.'
    );
  else els.notice.hidden = true;
}

function rowMessage(row: HeaderRow, overridden: Set<string>): { text: string; kind: 'error' | 'note' } | undefined {
  // A row being typed into isn't an error until it has a name.
  const nameError = row.name ? headerNameError(row.name) : undefined;
  const error = nameError ?? headerValueError(row.value);
  if (error) return { text: error, kind: 'error' };
  if (overridden.has(row.id)) return { text: `Not sent: a later ${row.name.trim()} row replaces it`, kind: 'note' };
  return undefined;
}

/** Updates a row's validation and override state without rebuilding it, so typing keeps focus. */
function refreshRowStates() {
  const overridden = overriddenRowIds(config.headers);
  for (const li of els.rows.children as HTMLCollectionOf<HTMLLIElement>) {
    const row = config.headers.find((h) => h.id === li.dataset.id);
    if (!row) continue;
    const msg = rowMessage(row, overridden);
    const p = li.querySelector<HTMLParagraphElement>('.row-msg')!;
    li.classList.toggle('off', !row.enabled);
    li.classList.toggle('invalid', msg?.kind === 'error');
    li.classList.toggle('overridden', msg?.kind === 'note');
    p.hidden = !msg;
    p.textContent = msg?.text ?? '';
    for (const input of li.querySelectorAll('input[type="text"]')) {
      input.setAttribute('aria-invalid', String(msg?.kind === 'error'));
    }
  }
  renderStatus();
}

function renderRow(row: HeaderRow): HTMLLIElement {
  const li = els.rowTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  li.dataset.id = row.id;
  const on = li.querySelector<HTMLInputElement>('.row-on')!;
  const name = li.querySelector<HTMLInputElement>('.row-name')!;
  const value = li.querySelector<HTMLInputElement>('.row-value')!;
  const remove = li.querySelector<HTMLButtonElement>('.row-remove')!;
  const msg = li.querySelector<HTMLParagraphElement>('.row-msg')!;
  msg.id = `msg-${row.id}`;
  name.setAttribute('aria-describedby', msg.id);
  value.setAttribute('aria-describedby', msg.id);

  on.checked = row.enabled;
  name.value = row.name;
  value.value = row.value;
  name.title = row.name;
  value.title = row.value;

  on.addEventListener('change', () => {
    row.enabled = on.checked;
    save(true);
    refreshRowStates();
  });
  name.addEventListener('input', () => {
    row.name = name.value;
    name.title = row.name;
    save();
    refreshRowStates();
  });
  value.addEventListener('input', () => {
    row.value = value.value;
    value.title = row.value;
    save();
    refreshRowStates();
  });
  name.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') ?? '';
    const pasted = parsePastedHeaders(text);
    if (!pasted.length) return;
    e.preventDefault();
    const index = config.headers.indexOf(row);
    // Fill this row with the first header if it's still blank, then insert the rest after it.
    const replaceThis = !row.name && !row.value;
    config.headers.splice(index, replaceThis ? 1 : 0, ...pasted.map((h) => newRow(h.name, h.value)));
    save(true);
    renderRows();
    toast(`Added ${plural(pasted.length, 'header')} from the clipboard`);
  });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (e.key === ':' && name.selectionStart === name.value.length)) {
      e.preventDefault();
      value.focus();
    }
  });
  value.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = li.nextElementSibling?.querySelector<HTMLInputElement>('.row-name');
    if (next) next.focus();
    else addRow();
  });
  remove.addEventListener('click', () => {
    const index = config.headers.indexOf(row);
    config.headers.splice(index, 1);
    save(true);
    renderRows();
    toast(`Removed ${row.name.trim() || 'header'}`, () => {
      config.headers.splice(index, 0, row);
      save(true);
      renderRows();
    });
  });
  return li;
}

/** Accepts "Name: value" lines (as copied from DevTools or curl -H) and returns them; empty if it isn't that shape. */
function parsePastedHeaders(text: string): { name: string; value: string }[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) =>
      l
        .trim()
        .replace(/^-H\s+/, '')
        .replace(/^['"]|['"]$/g, '')
    )
    .filter(Boolean);
  const parsed = lines.map((line) => {
    const colon = line.indexOf(':', 1);
    return colon > 0 ? { name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() } : undefined;
  });
  if (!parsed.length || parsed.some((h) => !h || headerNameError(h.name))) return [];
  return parsed as { name: string; value: string }[];
}

function renderRows() {
  els.rows.replaceChildren(...config.headers.map(renderRow));
  els.rows.hidden = config.headers.length === 0;
  els.empty.hidden = config.headers.length > 0;
  refreshRowStates();
}

function addRow() {
  config.headers.push(newRow());
  renderRows();
  els.rows.querySelector<HTMLInputElement>('li:last-child .row-name')?.focus();
}

function renderDomains() {
  const { valid, invalid } = splitDomains(config.domains);
  els.domainsSummary.textContent = valid.length ? `· ${valid.join(', ')}` : '';
  els.domainsSummary.title = valid.join(', ');
  els.domainsHint.textContent = invalid.length ? `Ignored, not a domain: ${invalid.join(', ')}` : DOMAINS_HINT;
  els.domainsHint.classList.toggle('warn', invalid.length > 0);
  renderStatus();
}

function renderTab() {
  els.domains.value = config.domains;
  els.domainsBox.open = config.domains.trim().length > 0;
  renderRows();
  renderDomains();
}

function renderPaused() {
  els.globalOn.checked = !paused;
  els.globalOn.setAttribute('aria-checked', String(!paused));
  els.globalLabel.textContent = paused ? 'Paused' : 'On';
  renderNotice();
  renderStatus();
}

function renderProfiles(selectedId?: string) {
  const placeholder = new Option(profiles.length ? 'Choose a profile…' : 'No saved profiles', '');
  els.profileSelect.replaceChildren(placeholder, ...profiles.map((p) => new Option(p.name, p.id)));
  els.profileSelect.value = selectedId ?? '';
  els.profileSelect.disabled = profiles.length === 0;
  updateProfileButtons();
}

function updateProfileButtons() {
  const hasSelection = Boolean(els.profileSelect.value);
  els.profileApply.disabled = !hasSelection;
  els.profileDelete.disabled = !hasSelection;
  const name = els.profileName.value.trim();
  const exists = profiles.some((p) => p.name.toLowerCase() === name.toLowerCase());
  els.profileSave.disabled = !name || !config.headers.some((h) => h.name.trim());
  els.profileSave.querySelector('span')!.textContent = exists ? 'Update' : 'Save';
}

function describeTab(url: string | undefined): string {
  if (!url) return 'This page';
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url;
  }
}

// ---- Setup --------------------------------------------------------------------------------------

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    els.tabHost.textContent = 'No active tab';
    return;
  }
  tabId = tab.id;
  // Without the "tabs" permission Chrome only reveals URLs we have host access to, i.e. websites.
  isWebPage = /^(https?|wss?):/.test(tab.url ?? '');
  els.tabHost.textContent = describeTab(tab.url);
  els.tabHost.title = tab.url ?? '';

  [config, profiles, paused, tabError] = await Promise.all([
    getTabConfig(tabId),
    getProfiles(),
    getPaused(),
    getTabError(tabId)
  ]);
  loadedSignature = signature();

  renderTab();
  renderPaused();
  renderProfiles();

  els.globalOn.addEventListener('change', () => {
    paused = !els.globalOn.checked;
    void setPaused(paused);
    renderPaused();
  });
  els.tabOn.addEventListener('change', () => {
    config.enabled = els.tabOn.checked;
    save(true);
  });
  els.add.addEventListener('click', addRow);
  els.domains.addEventListener('input', () => {
    config.domains = els.domains.value;
    save();
    renderDomains();
  });

  els.reload.addEventListener('click', async () => {
    els.reload.disabled = true;
    await flush();
    // Wait for the background worker to install the rules, or the reload could race them.
    await chrome.runtime.sendMessage({ type: 'sync' });
    await chrome.tabs.reload(tabId);
    loadedSignature = signature();
    els.reload.disabled = false;
    renderStatus();
    toast('Reloaded with the current headers');
  });

  els.profileSelect.addEventListener('change', updateProfileButtons);
  els.profileName.addEventListener('input', updateProfileButtons);

  els.profileApply.addEventListener('click', () => {
    const profile = profiles.find((p) => p.id === els.profileSelect.value);
    if (!profile) return;
    replaceConfig(
      { enabled: true, headers: cloneHeaders(profile.headers), domains: profile.domains },
      `Applied “${profile.name}”`
    );
  });

  els.profileDelete.addEventListener('click', async () => {
    const index = profiles.findIndex((p) => p.id === els.profileSelect.value);
    const [removed] = profiles.splice(index, 1);
    if (!removed) return;
    await setProfiles(profiles);
    renderProfiles();
    toast(`Deleted “${removed.name}”`, async () => {
      profiles.splice(index, 0, removed);
      await setProfiles(profiles);
      renderProfiles(removed.id);
    });
  });

  els.profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = els.profileName.value.trim();
    if (els.profileSave.disabled) return;
    const existing = profiles.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const profile: Profile = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      headers: cloneHeaders(config.headers.filter((h) => h.name.trim())),
      domains: config.domains
    };
    profiles = existing ? profiles.map((p) => (p.id === existing.id ? profile : p)) : [...profiles, profile];
    profiles.sort((a, b) => a.name.localeCompare(b.name));
    await setProfiles(profiles);
    els.profileName.value = '';
    renderProfiles(profile.id);
    toast(existing ? `Updated “${name}”` : `Saved “${name}”`);
  });

  els.toastUndo.addEventListener('click', () => {
    const undo = undoAction;
    hideToast();
    undo?.();
  });

  // The background worker reports rule errors after it applies our changes.
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[errorKey(tabId)];
    if (area !== 'session' || !change) return;
    tabError = change.newValue as string | undefined;
    renderNotice();
    renderStatus();
  });

  // Flush a pending debounced save when the popup closes.
  window.addEventListener('pagehide', () => {
    if (saveTimer !== undefined) save(true);
  });
}

void init();
