import { readJson, writeJson } from "./persist.js";

export type ProviderName = "openai" | "anthropic" | "gemini" | "openrouter";

export type ReverseProxyMode = "round-robin" | "sticky";

export interface PoolEntry {
  url: string;
  apiKey: string;
}

export interface ServerSettings {
  sillyTavernMode: boolean;
  reverseProxyMode: ReverseProxyMode;
  reverseProxyPool: PoolEntry[];
}

const DEFAULTS: ServerSettings = {
  sillyTavernMode: false,
  reverseProxyMode: "sticky",
  reverseProxyPool: [],
};

let _settings: ServerSettings | null = null;

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

function normalizeMode(raw: unknown): ReverseProxyMode {
  return raw === "round-robin" ? "round-robin" : "sticky";
}

export function getSettings(): ServerSettings {
  if (_settings === null) {
    const loaded = readJson<Record<string, unknown>>("server_settings.json", {});
    _settings = {
      ...DEFAULTS,
      sillyTavernMode:
        typeof loaded["sillyTavernMode"] === "boolean" ? loaded["sillyTavernMode"] : DEFAULTS.sillyTavernMode,
      reverseProxyMode: normalizeMode(loaded["reverseProxyMode"]),
      reverseProxyPool: normalizePool(loaded["reverseProxyPool"]),
    };
  }
  return _settings;
}

export function updateSettings(patch: Partial<ServerSettings>): ServerSettings {
  const current = getSettings();
  const next: ServerSettings = { ...current, ...patch };

  if (patch.reverseProxyPool) {
    // Pool is replaced atomically; the route layer handles
    // null-vs-empty key semantics before reaching this point.
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

  if (patch.reverseProxyMode !== undefined) {
    next.reverseProxyMode = normalizeMode(patch.reverseProxyMode);
  }

  _settings = next;
  writeJson("server_settings.json", _settings);
  return _settings;
}
