const API_BASE = "/api";
const V1_BASE = "/v1";

export type ProviderName = "openai" | "anthropic" | "gemini" | "openrouter";

export type ProviderSource = "upstream" | "local-env" | "per-provider override";

export type ReverseProxyMode = "round-robin" | "sticky";

export interface SetupStatus {
  configured: boolean;
  providers: {
    openai: boolean;
    anthropic: boolean;
    gemini: boolean;
    openrouter: boolean;
    proxyKey: boolean;
  };
  providerSources?: Record<ProviderName, ProviderSource | null>;
  reverseProxy?: boolean;
  pool?: { size: number; mode: ReverseProxyMode; nextIndex: number | null };
}

export interface PublicProviderOverride {
  url: string;
  apiKeySet: boolean;
}

export interface PublicPoolEntry {
  url: string;
  apiKeySet: boolean;
}

export interface DisabledUpstreamNode {
  url: string;
  type: string;
  disabledReason: string;
  disabledAt?: string;
  lastError?: string;
  upstreamReason?: string;
  upstreamStatus?: number;
}

export interface Settings {
  sillyTavernMode: boolean;
  reverseProxyEnabled: boolean;
  reverseProxyMode: ReverseProxyMode;
  reverseProxyPool: PublicPoolEntry[];
  providerOverrides: Record<ProviderName, PublicProviderOverride>;
  disabledUpstreamNodes: DisabledUpstreamNode[];
}

export interface ProviderOverridePatch {
  url?: string;
  // Empty string = leave unchanged; null = clear the stored key.
  apiKey?: string | null;
}

export interface PoolEntryPatch {
  url: string;
  // Empty string / undefined = preserve existing key for this URL; null = clear.
  apiKey?: string | null;
}

export interface SettingsPatch {
  sillyTavernMode?: boolean;
  reverseProxyEnabled?: boolean;
  reverseProxyMode?: ReverseProxyMode;
  reverseProxyPool?: PoolEntryPatch[];
  providerOverrides?: Partial<Record<ProviderName, ProviderOverridePatch>>;
}

export interface ModelEntry {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  provider: string;
  disabled: boolean;
}

export interface ModelsResponse {
  object: string;
  data: ModelEntry[];
}

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// In-memory store (primary) — works even when localStorage/cookies are blocked by iframe sandbox
let _inMemoryKey = "";

function getCookie(name: string): string {
  try {
    const match = document.cookie.split("; ").find((row) => row.startsWith(name + "="));
    return match ? decodeURIComponent(match.split("=")[1]!) : "";
  } catch {
    return "";
  }
}

function setCookie(name: string, value: string, days: number): void {
  try {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict`;
  } catch {
    // cookie access blocked — in-memory key is still set
  }
}

function deleteCookie(name: string): void {
  try {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Strict`;
  } catch {}
}

export function setClientKey(key: string): void {
  _inMemoryKey = key.trim();
  if (_inMemoryKey) {
    setCookie("gateway_api_key", _inMemoryKey, 7);
    try { window.localStorage.setItem("gateway_api_key", _inMemoryKey); } catch {}
  } else {
    deleteCookie("gateway_api_key");
    try { window.localStorage.removeItem("gateway_api_key"); } catch {}
  }
}

export function getApiKey(): string {
  if (_inMemoryKey) return _inMemoryKey;
  // Try cookie first (works in more iframe contexts than localStorage)
  const fromCookie = getCookie("gateway_api_key");
  if (fromCookie) {
    _inMemoryKey = fromCookie;
    return _inMemoryKey;
  }
  const fromStorage = safeLocalStorage()?.getItem("gateway_api_key") ?? "";
  if (fromStorage) {
    _inMemoryKey = fromStorage;
    return _inMemoryKey;
  }
  return "";
}

function authHeaders(): HeadersInit {
  const key = getApiKey();
  return key ? { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export async function verifyKey(): Promise<{ valid: boolean; keyRequired: boolean }> {
  const res = await fetch(`${API_BASE}/verify-key`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchSetupStatus(): Promise<SetupStatus> {
  const res = await fetch(`${API_BASE}/setup-status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchSettings(): Promise<Settings> {
  const res = await fetch(`${API_BASE}/settings`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchAdminModels(): Promise<ModelsResponse> {
  const res = await fetch(`${V1_BASE}/admin/models`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function patchModel(id: string, disabled: boolean): Promise<void> {
  const res = await fetch(`${V1_BASE}/admin/models`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ id, disabled }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function patchProviderModels(provider: string, all_disabled: boolean): Promise<void> {
  const res = await fetch(`${V1_BASE}/admin/models`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ provider, all_disabled }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function reEnableUpstreamNode(url: string): Promise<void> {
  const res = await fetch(`${API_BASE}/upstream-nodes/re-enable`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await res.text());
}
