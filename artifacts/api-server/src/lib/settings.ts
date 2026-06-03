import { randomUUID } from "node:crypto";
import { readJsonAsync, writeJson } from "./persist.js";

export type ProviderName = "openai" | "anthropic" | "gemini" | "openrouter";

export interface ProviderOverride {
  url: string;
  apiKey: string;
}

export type ProviderOverrides = Record<ProviderName, ProviderOverride>;

export type ReverseProxyMode = "round-robin" | "sticky";

export interface PoolEntry {
  url: string;
  apiKey: string;
}

export interface CcUpstreamKeyEntry {
  id: string;
  apiKey: string;
}

export type CcDisabledReason = "upstream-key-unavailable";

export interface DisabledCcUpstreamKey {
  id: string;
  apiKey: string;
  disabledReason: CcDisabledReason;
  upstreamStatus?: number;
  disabledAt?: string;
  lastError?: string;
}

export type UpstreamNodeType = "replit-app" | "replit-dev";

export type DisabledReason = "requires-wakeup" | "upstream-node-unavailable";

export interface DisabledUpstreamNode {
  url: string;
  type: UpstreamNodeType;
  disabledReason: DisabledReason;
  provider?: string;
  upstreamReason?: string;
  upstreamStatus?: number;
  disabledAt?: string;
  lastError?: string;
}

export interface ServerSettings {
  sillyTavernMode: boolean;
  reverseProxyEnabled: boolean;
  reverseProxyMode: ReverseProxyMode;
  reverseProxyPool: PoolEntry[];
  disabledUpstreamNodes: DisabledUpstreamNode[];
  providerOverrides: ProviderOverrides;
  ccUpstreamApiKey: string;
  ccUpstreamKeyPool: CcUpstreamKeyEntry[];
  disabledCcUpstreamKeys: DisabledCcUpstreamKey[];
}

const EMPTY_OVERRIDE: ProviderOverride = { url: "", apiKey: "" };

const EMPTY_OVERRIDES: ProviderOverrides = {
  openai: { ...EMPTY_OVERRIDE },
  anthropic: { ...EMPTY_OVERRIDE },
  gemini: { ...EMPTY_OVERRIDE },
  openrouter: { ...EMPTY_OVERRIDE },
};

const DEFAULTS: ServerSettings = {
  sillyTavernMode: false,
  reverseProxyEnabled: false,
  reverseProxyMode: "sticky",
  reverseProxyPool: [],
  disabledUpstreamNodes: [],
  providerOverrides: EMPTY_OVERRIDES,
  ccUpstreamApiKey: "",
  ccUpstreamKeyPool: [],
  disabledCcUpstreamKeys: [],
};

let _settings: ServerSettings | null = null;

export function createCcUpstreamKeyId(): string {
  return `cckey_${randomUUID()}`;
}

function normalizeOverrides(raw: unknown): ProviderOverrides {
  const out: ProviderOverrides = {
    openai: { ...EMPTY_OVERRIDE },
    anthropic: { ...EMPTY_OVERRIDE },
    gemini: { ...EMPTY_OVERRIDE },
    openrouter: { ...EMPTY_OVERRIDE },
  };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const p of ["openai", "anthropic", "gemini", "openrouter"] as const) {
    const v = r[p];
    if (v && typeof v === "object") {
      const vo = v as Record<string, unknown>;
      out[p] = {
        url: typeof vo["url"] === "string" ? vo["url"] : "",
        apiKey: typeof vo["apiKey"] === "string" ? vo["apiKey"] : "",
      };
    }
  }
  return out;
}

function normalizePool(raw: unknown): PoolEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PoolEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    const url = typeof v["url"] === "string" ? v["url"].trim().replace(/\/+$/, "") : "";
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      apiKey: typeof v["apiKey"] === "string" ? v["apiKey"] : "",
    });
  }
  return out;
}

function normalizeCcKeyPool(raw: unknown): CcUpstreamKeyEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CcUpstreamKeyEntry[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    const apiKey = typeof v["apiKey"] === "string" ? v["apiKey"].trim() : "";
    if (!apiKey) continue;
    let id = typeof v["id"] === "string" ? v["id"].trim() : "";
    if (!id || seenIds.has(id)) id = createCcUpstreamKeyId();
    seenIds.add(id);
    out.push({ id, apiKey });
  }
  return out;
}

function normalizeDisabledCcKeys(raw: unknown): DisabledCcUpstreamKey[] {
  if (!Array.isArray(raw)) return [];
  const out: DisabledCcUpstreamKey[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    const apiKey = typeof v["apiKey"] === "string" ? v["apiKey"].trim() : "";
    if (!apiKey) continue;
    let id = typeof v["id"] === "string" ? v["id"].trim() : "";
    if (!id || seenIds.has(id)) id = createCcUpstreamKeyId();
    seenIds.add(id);
    const entry: DisabledCcUpstreamKey = {
      id,
      apiKey,
      disabledReason: "upstream-key-unavailable",
    };
    if (typeof v["upstreamStatus"] === "number") entry.upstreamStatus = v["upstreamStatus"];
    if (typeof v["disabledAt"] === "string") entry.disabledAt = v["disabledAt"];
    if (typeof v["lastError"] === "string") entry.lastError = v["lastError"];
    out.push(entry);
  }
  return out;
}

function normalizeMode(raw: unknown): ReverseProxyMode {
  return raw === "round-robin" ? "round-robin" : "sticky";
}

function normalizeDisabledNodes(raw: unknown): DisabledUpstreamNode[] {
  if (!Array.isArray(raw)) return [];
  const out: DisabledUpstreamNode[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    const url = typeof v["url"] === "string" ? v["url"].trim().replace(/\/+$/, "") : "";
    const type = v["type"];
    if (!url || (type !== "replit-app" && type !== "replit-dev")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const reason = v["disabledReason"];
    const disabledReason: DisabledReason =
      reason === "upstream-node-unavailable" ? "upstream-node-unavailable" : "requires-wakeup";
    const entry: DisabledUpstreamNode = { url, type, disabledReason };
    if (typeof v["provider"] === "string") entry.provider = v["provider"];
    if (typeof v["upstreamReason"] === "string") entry.upstreamReason = v["upstreamReason"];
    if (typeof v["upstreamStatus"] === "number") entry.upstreamStatus = v["upstreamStatus"];
    if (typeof v["disabledAt"] === "string") entry.disabledAt = v["disabledAt"];
    if (typeof v["lastError"] === "string") entry.lastError = v["lastError"];
    out.push(entry);
  }
  return out;
}

export async function initSettings(): Promise<void> {
  const loaded = await readJsonAsync<Record<string, unknown>>("server_settings.json", {});
  let pool = normalizePool(loaded["reverseProxyPool"]);
  const legacyKey = typeof loaded["reverseProxyApiKey"] === "string" ? (loaded["reverseProxyApiKey"] as string) : "";
  if (pool.length === 0 && typeof loaded["reverseProxyUrl"] === "string") {
    const legacyUrl = (loaded["reverseProxyUrl"] as string).trim().replace(/\/+$/, "");
    if (legacyUrl) {
      pool = [{ url: legacyUrl, apiKey: legacyKey }];
    }
  }
  if (pool.length === 0 && legacyKey) {
    const overridesRaw = loaded["providerOverrides"];
    if (overridesRaw && typeof overridesRaw === "object") {
      const o = overridesRaw as Record<string, unknown>;
      for (const p of ["openai", "anthropic", "gemini", "openrouter"] as const) {
        const entry = o[p] as { url?: string; apiKey?: string } | undefined;
        if (entry && typeof entry.url === "string" && entry.url && (!entry.apiKey || entry.apiKey === "")) {
          entry.apiKey = legacyKey;
        }
      }
    }
  }

  const legacyCcKey = typeof loaded["ccUpstreamApiKey"] === "string" ? (loaded["ccUpstreamApiKey"] as string).trim() : "";
  let ccUpstreamKeyPool = normalizeCcKeyPool(loaded["ccUpstreamKeyPool"]);
  if (ccUpstreamKeyPool.length === 0 && legacyCcKey) {
    ccUpstreamKeyPool = [{ id: createCcUpstreamKeyId(), apiKey: legacyCcKey }];
  }

  _settings = {
    ...DEFAULTS,
    sillyTavernMode: typeof loaded["sillyTavernMode"] === "boolean" ? loaded["sillyTavernMode"] : DEFAULTS.sillyTavernMode,
    reverseProxyEnabled: typeof loaded["reverseProxyEnabled"] === "boolean" ? loaded["reverseProxyEnabled"] : ccUpstreamKeyPool.length > 0,
    reverseProxyMode: normalizeMode(loaded["reverseProxyMode"]),
    reverseProxyPool: pool,
    disabledUpstreamNodes: normalizeDisabledNodes(loaded["disabledUpstreamNodes"]),
    providerOverrides: normalizeOverrides(loaded["providerOverrides"]),
    ccUpstreamApiKey: legacyCcKey,
    ccUpstreamKeyPool,
    disabledCcUpstreamKeys: normalizeDisabledCcKeys(loaded["disabledCcUpstreamKeys"]),
  };
}

export function getSettings(): ServerSettings {
  if (_settings === null) {
    _settings = { ...DEFAULTS };
  }
  return _settings;
}

export function getCcUpstreamApiKey(): string {
  const settings = getSettings();
  if (settings.reverseProxyEnabled && settings.ccUpstreamKeyPool.length > 0) {
    return settings.ccUpstreamKeyPool[0]!.apiKey.trim();
  }
  return settings.ccUpstreamApiKey.trim() || process.env["CC_UPSTREAM_API_KEY"]?.trim() || "";
}

export function disableCcUpstreamKey(args: {
  id: string;
  upstreamStatus?: number;
  lastError?: string;
}): void {
  const settings = getSettings();
  const entry = settings.ccUpstreamKeyPool.find((e) => e.id === args.id);
  if (!entry) return;

  const nextPool = settings.ccUpstreamKeyPool.filter((e) => e.id !== args.id);
  const disabled: DisabledCcUpstreamKey = {
    id: entry.id,
    apiKey: entry.apiKey,
    disabledReason: "upstream-key-unavailable",
    disabledAt: new Date().toISOString(),
  };
  if (args.upstreamStatus !== undefined) disabled.upstreamStatus = args.upstreamStatus;
  if (args.lastError !== undefined) disabled.lastError = args.lastError;

  updateSettings({
    ccUpstreamKeyPool: nextPool,
    disabledCcUpstreamKeys: [
      ...settings.disabledCcUpstreamKeys.filter((e) => e.id !== args.id),
      disabled,
    ],
    reverseProxyEnabled: nextPool.length > 0,
  });
}

export function reEnableCcUpstreamKey(id: string): boolean {
  const settings = getSettings();
  const disabled = settings.disabledCcUpstreamKeys.find((e) => e.id === id);
  if (!disabled) return false;

  const nextDisabled = settings.disabledCcUpstreamKeys.filter((e) => e.id !== id);
  const alreadyActive = settings.ccUpstreamKeyPool.some((e) => e.id === id);
  const nextPool = alreadyActive
    ? settings.ccUpstreamKeyPool
    : [...settings.ccUpstreamKeyPool, { id: disabled.id, apiKey: disabled.apiKey }];

  updateSettings({
    ccUpstreamKeyPool: nextPool,
    disabledCcUpstreamKeys: nextDisabled,
    reverseProxyEnabled: true,
  });
  return true;
}

/**
 * Disable an upstream node. Removes it from the pool, records it in
 * disabledUpstreamNodes, and disables the proxy entirely if the pool empties.
 * Does NOT touch reverseProxyMode or providerOverrides.
 */
export function disableUpstreamNode(args: {
  url: string;
  disabledReason: DisabledReason;
  provider?: string;
  upstreamReason?: string;
  upstreamStatus?: number;
  lastError?: string;
}): void {
  const settings = getSettings();
  const url = args.url.trim().replace(/\/+$/, "");

  let type: UpstreamNodeType = "replit-app";
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname.endsWith(".replit.dev")) type = "replit-dev";
  } catch {
    // default to replit-app
  }

  const newPool = settings.reverseProxyPool.filter((e) => e.url !== url);

  const entry: DisabledUpstreamNode = {
    url,
    type,
    disabledReason: args.disabledReason,
    disabledAt: new Date().toISOString(),
  };
  if (args.provider !== undefined) entry.provider = args.provider;
  if (args.upstreamReason !== undefined) entry.upstreamReason = args.upstreamReason;
  if (args.upstreamStatus !== undefined) entry.upstreamStatus = args.upstreamStatus;
  if (args.lastError !== undefined) entry.lastError = args.lastError;

  const newDisabled = settings.disabledUpstreamNodes.filter((e) => e.url !== url);
  newDisabled.push(entry);

  const patch: Partial<ServerSettings> = {
    reverseProxyPool: newPool,
    disabledUpstreamNodes: newDisabled,
  };

  if (newPool.length === 0) {
    patch.reverseProxyEnabled = false;
  }

  updateSettings(patch);
}

export function updateSettings(patch: Partial<ServerSettings>): ServerSettings {
  const current = getSettings();
  const next: ServerSettings = { ...current, ...patch };

  if (patch.reverseProxyPool) {
    const seen = new Set<string>();
    const cleaned: PoolEntry[] = [];
    for (const e of patch.reverseProxyPool) {
      const url = (e.url ?? "").trim().replace(/\/+$/, "");
      if (!url || seen.has(url)) continue;
      seen.add(url);
      cleaned.push({ url, apiKey: e.apiKey ?? "" });
    }
    next.reverseProxyPool = cleaned;
  }

  if (patch.ccUpstreamKeyPool) {
    const seen = new Set<string>();
    const cleaned: CcUpstreamKeyEntry[] = [];
    for (const e of patch.ccUpstreamKeyPool) {
      const apiKey = (e.apiKey ?? "").trim();
      if (!apiKey) continue;
      let id = (e.id ?? "").trim();
      if (!id || seen.has(id)) id = createCcUpstreamKeyId();
      seen.add(id);
      cleaned.push({ id, apiKey });
    }
    next.ccUpstreamKeyPool = cleaned;
  }

  if (patch.disabledCcUpstreamKeys) {
    const seen = new Set<string>();
    const cleaned: DisabledCcUpstreamKey[] = [];
    for (const e of patch.disabledCcUpstreamKeys) {
      const apiKey = (e.apiKey ?? "").trim();
      if (!apiKey) continue;
      let id = (e.id ?? "").trim();
      if (!id || seen.has(id)) id = createCcUpstreamKeyId();
      seen.add(id);
      cleaned.push({ ...e, id, apiKey, disabledReason: "upstream-key-unavailable" });
    }
    next.disabledCcUpstreamKeys = cleaned;
  }

  if (patch.providerOverrides) {
    const merged: ProviderOverrides = { ...current.providerOverrides };
    for (const p of ["openai", "anthropic", "gemini", "openrouter"] as const) {
      const incoming = patch.providerOverrides[p];
      if (incoming) {
        merged[p] = {
          url: (incoming.url ?? current.providerOverrides[p].url).trim().replace(/\/+$/, ""),
          apiKey: incoming.apiKey ?? current.providerOverrides[p].apiKey,
        };
      }
    }
    next.providerOverrides = merged;
  }

  if (patch.reverseProxyMode !== undefined) {
    next.reverseProxyMode = normalizeMode(patch.reverseProxyMode);
  }

  if (patch.ccUpstreamApiKey !== undefined) {
    next.ccUpstreamApiKey = patch.ccUpstreamApiKey.trim();
  }

  _settings = next;
  writeJson("server_settings.json", _settings);
  return _settings;
}
