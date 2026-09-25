export interface HeaderRow {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
}

/** Headers applied to one tab. Lives in chrome.storage.session, because tab ids do not survive a browser restart. */
export interface TabConfig {
  enabled: boolean;
  headers: HeaderRow[];
  /** Comma-separated domains; empty means every request the tab makes. Subdomains match too. */
  domains: string;
}

/** A reusable, named set of headers. Lives in chrome.storage.local so it survives restarts. */
export interface Profile {
  id: string;
  name: string;
  headers: HeaderRow[];
  domains: string;
}
