import { readJson, writeJson } from "./persist.js";

export type ProviderName = "openai" | "anthropic" | "gemini" | "openrouter";

export interface ProviderOverride {
  url: string;
  apiKey: string;
}

export type ProviderOverrides = Record<ProviderName, ProviderOverride>;

export interface ServerSettings {
  sillyTavernMode: boolean;
  reverseProxyEnabled: boolean;
  reverseProxyUrl: string;
  reverseProxyApiKey: string;
  providerOverrides: ProviderOverrides;
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
  reverseProxyUrl: "",
  reverseProxyApiKey: "",
  providerOverrides: EMPTY_OVERRIDES,
};

let _settings: ServerSettings | null = null;

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

export function getSettings(): ServerSettings {
  if (_settings === null) {
    const loaded = readJson<Partial<ServerSettings>>("server_settings.json", DEFAULTS);
    _settings = {
      ...DEFAULTS,
      ...loaded,
      providerOverrides: normalizeOverrides(loaded.providerOverrides),
    };
  }
  return _settings;
}

export function updateSettings(patch: Partial<ServerSettings>): ServerSettings {
  const current = getSettings();
  const next: ServerSettings = { ...current, ...patch };
  if (typeof next.reverseProxyUrl === "string") {
    next.reverseProxyUrl = next.reverseProxyUrl.trim().replace(/\/+$/, "");
  }
  if (patch.providerOverrides) {
    // Merge per-provider so callers can patch a single provider.
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
  _settings = next;
  writeJson("server_settings.json", _settings);
  return _settings;
}
