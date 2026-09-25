import type { HeaderRow, TabConfig } from './types';

type Rule = chrome.declarativeNetRequest.Rule;

// Listed explicitly: when resourceTypes is omitted Chrome matches everything *except* main_frame,
// which would leave the page's own document request without the headers.
const RESOURCE_TYPES: Rule['condition']['resourceTypes'] = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other'
];

// RFC 9110 token characters.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

export function headerNameError(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'Add a header name';
  if (/\s/.test(trimmed)) return 'Header names can’t contain spaces';
  if (trimmed.includes(':')) return 'Leave out the colon; the value goes in the next field';
  if (!HEADER_NAME.test(trimmed)) return 'Use letters, digits and - _ . only';
  return undefined;
}

export function headerValueError(value: string): string | undefined {
  if (/[\r\n\0]/.test(value)) return 'Values can’t contain line breaks';
  return undefined;
}

export const isUsableRow = (row: HeaderRow) =>
  row.enabled && !headerNameError(row.name) && !headerValueError(row.value);

/** Splits "a.com, b.org" into Chrome's requestDomains form, keeping aside anything that isn't a bare hostname. */
export function splitDomains(domains: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of domains.split(/[\s,]+/)) {
    if (!raw) continue;
    const d = raw.toLowerCase().replace(/^\*\./, '');
    if (DOMAIN.test(d)) valid.push(d);
    else invalid.push(raw);
  }
  return { valid, invalid };
}

export const parseDomains = (domains: string) => splitDomains(domains).valid;

/** Ids of enabled rows that a later row with the same name overrides. */
export function overriddenRowIds(headers: HeaderRow[]): Set<string> {
  const lastByName = new Map<string, string>();
  for (const row of headers) if (isUsableRow(row)) lastByName.set(row.name.trim().toLowerCase(), row.id);
  const overridden = new Set<string>();
  for (const row of headers) {
    if (isUsableRow(row) && lastByName.get(row.name.trim().toLowerCase()) !== row.id) overridden.add(row.id);
  }
  return overridden;
}

/** Headers a tab actually sends: enabled, valid, and de-duplicated by name (the last row wins). */
export function activeHeaders(config: TabConfig): HeaderRow[] {
  if (!config.enabled) return [];
  const byName = new Map<string, HeaderRow>();
  for (const row of config.headers) {
    if (isUsableRow(row)) byName.set(row.name.trim().toLowerCase(), row);
  }
  return [...byName.values()];
}

/** One session rule per tab, scoped to that tab with condition.tabIds. Returns the rules and which tab each belongs to. */
export function buildRules(configs: Map<number, TabConfig>): { rules: Rule[]; tabOf: Map<number, number> } {
  const rules: Rule[] = [];
  const tabOf = new Map<number, number>();
  for (const [tabId, config] of configs) {
    const headers = activeHeaders(config);
    if (!headers.length) continue;
    const id = rules.length + 1;
    const domains = parseDomains(config.domains);
    rules.push({
      id,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: headers.map((h) => ({ header: h.name.trim(), operation: 'set', value: h.value }))
      },
      condition: {
        tabIds: [tabId],
        resourceTypes: RESOURCE_TYPES,
        ...(domains.length ? { requestDomains: domains } : {})
      }
    });
    tabOf.set(id, tabId);
  }
  return { rules, tabOf };
}
