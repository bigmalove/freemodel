import { Router } from "express";
import {
  createCcUpstreamKeyId,
  getCcUpstreamApiKey,
  getSettings,
  updateSettings,
  type CcUpstreamKeyEntry,
  type ProviderName,
  type ProviderOverrides,
  type PoolEntry,
  type ReverseProxyMode,
  type ServerSettings,
} from "../lib/settings.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

const PROVIDERS: readonly ProviderName[] = ["openai", "anthropic", "gemini", "openrouter"];

interface PublicPoolEntry {
  url: string;
  apiKeySet: boolean;
}

interface PublicProviderOverride {
  url: string;
  apiKeySet: boolean;
}

interface PublicCcKeyEntry {
  id: string;
  apiKeySet: boolean;
}

interface PublicDisabledCcKey {
  id: string;
  disabledReason: string;
  disabledAt?: string;
  lastError?: string;
  upstreamStatus?: number;
}

interface PublicDisabledNode {
  url: string;
  type: string;
  disabledReason: string;
  disabledAt?: string;
  lastError?: string;
  upstreamReason?: string;
  upstreamStatus?: number;
}

interface PublicSettings {
  sillyTavernMode: boolean;
  reverseProxyEnabled: boolean;
  reverseProxyMode: ReverseProxyMode;
  reverseProxyPool: PublicPoolEntry[];
  providerOverrides: Record<ProviderName, PublicProviderOverride>;
  disabledUpstreamNodes: PublicDisabledNode[];
  ccUpstreamApiKeySet: boolean;
  ccUpstreamKeyPool: PublicCcKeyEntry[];
  disabledCcUpstreamKeys: PublicDisabledCcKey[];
}

function toPublic(s: ServerSettings): PublicSettings {
  const overrides = {} as Record<ProviderName, PublicProviderOverride>;
  for (const p of PROVIDERS) {
    overrides[p] = {
      url: s.providerOverrides[p].url,
      apiKeySet: !!s.providerOverrides[p].apiKey,
    };
  }
  return {
    sillyTavernMode: s.sillyTavernMode,
    reverseProxyEnabled: s.reverseProxyEnabled,
    reverseProxyMode: s.reverseProxyMode,
    reverseProxyPool: s.reverseProxyPool.map((e) => ({ url: e.url, apiKeySet: !!e.apiKey })),
    providerOverrides: overrides,
    ccUpstreamApiKeySet: !!getCcUpstreamApiKey(),
    ccUpstreamKeyPool: s.ccUpstreamKeyPool.map((e) => ({ id: e.id, apiKeySet: !!e.apiKey })),
    disabledCcUpstreamKeys: s.disabledCcUpstreamKeys.map((e) => ({
      id: e.id,
      disabledReason: e.disabledReason,
      disabledAt: e.disabledAt,
      lastError: e.lastError,
      upstreamStatus: e.upstreamStatus,
    })),
    disabledUpstreamNodes: s.disabledUpstreamNodes.map((n) => ({
      url: n.url,
      type: n.type,
      disabledReason: n.disabledReason,
      disabledAt: n.disabledAt,
      lastError: n.lastError,
      upstreamReason: n.upstreamReason,
      upstreamStatus: n.upstreamStatus,
    })),
  };
}

function validateUrl(url: string, fieldName: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (trimmed === "") return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${fieldName} must be a valid absolute URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${fieldName} must use http: or https:`);
  }
  return trimmed;
}

router.get("/api/settings", requireAuth, (_req, res) => {
  res.json(toPublic(getSettings()));
});

router.post("/api/settings", requireAuth, (req, res) => {
  const body = (req.body ?? {}) as {
    sillyTavernMode?: boolean;
    reverseProxyEnabled?: boolean;
    reverseProxyMode?: ReverseProxyMode;
    reverseProxyPool?: Array<{ url?: string; apiKey?: string | null }>;
    reverseProxyUrl?: string;
    reverseProxyApiKey?: string | null;
    providerOverrides?: Partial<
      Record<ProviderName, { url?: string; apiKey?: string | null }>
    >;
    ccUpstreamApiKey?: string | null;
    ccUpstreamKeyPool?: Array<{ id?: string; apiKey?: string | null }>;
  };
  const patch: Partial<ServerSettings> = {};
  const current = getSettings();

  if (typeof body.sillyTavernMode === "boolean") {
    patch.sillyTavernMode = body.sillyTavernMode;
  }
  if (typeof body.reverseProxyEnabled === "boolean") {
    patch.reverseProxyEnabled = body.reverseProxyEnabled;
  }
  if (body.reverseProxyMode !== undefined) {
    if (body.reverseProxyMode !== "round-robin" && body.reverseProxyMode !== "sticky") {
      res.status(400).json({
        error: { message: 'reverseProxyMode must be "round-robin" or "sticky"', type: "validation_error" },
      });
      return;
    }
    patch.reverseProxyMode = body.reverseProxyMode;
  }

  if (Array.isArray(body.ccUpstreamKeyPool)) {
    const existingKeyById = new Map<string, string>();
    for (const entry of current.ccUpstreamKeyPool) existingKeyById.set(entry.id, entry.apiKey);

    const cleaned: CcUpstreamKeyEntry[] = [];
    const seenIds = new Set<string>();
    for (let i = 0; i < body.ccUpstreamKeyPool.length; i++) {
      const incoming = body.ccUpstreamKeyPool[i] ?? {};
      let id = typeof incoming.id === "string" ? incoming.id.trim() : "";
      if (id && seenIds.has(id)) {
        res.status(400).json({ error: { message: `ccUpstreamKeyPool[${i}].id is duplicated`, type: "validation_error" } });
        return;
      }

      let apiKey = "";
      if (typeof incoming.apiKey === "string" && incoming.apiKey.length > 0) {
        apiKey = incoming.apiKey.trim();
      } else if (id && incoming.apiKey !== null) {
        apiKey = existingKeyById.get(id) ?? "";
      }

      if (!apiKey) {
        res.status(400).json({ error: { message: `第 ${i + 1} 条 cc 上游 Key 不能为空`, type: "validation_error" } });
        return;
      }

      if (!id) id = createCcUpstreamKeyId();
      seenIds.add(id);
      cleaned.push({ id, apiKey });
    }
    patch.ccUpstreamKeyPool = cleaned;
    if (cleaned.length > 0 && body.reverseProxyEnabled === undefined) {
      patch.reverseProxyEnabled = true;
    }
  }

  if (typeof body.ccUpstreamApiKey === "string" && body.ccUpstreamApiKey.length > 0) {
    const apiKey = body.ccUpstreamApiKey.trim();
    patch.ccUpstreamApiKey = apiKey;
    if (!Array.isArray(body.ccUpstreamKeyPool)) {
      const firstId = current.ccUpstreamKeyPool[0]?.id ?? createCcUpstreamKeyId();
      patch.ccUpstreamKeyPool = [{ id: firstId, apiKey }];
      if (body.reverseProxyEnabled === undefined) patch.reverseProxyEnabled = true;
    }
  } else if (body.ccUpstreamApiKey === null) {
    patch.ccUpstreamApiKey = "";
    if (!Array.isArray(body.ccUpstreamKeyPool)) {
      patch.ccUpstreamKeyPool = [];
      if (body.reverseProxyEnabled === undefined) patch.reverseProxyEnabled = false;
    }
  }

  if (Array.isArray(body.reverseProxyPool)) {
    const cleaned: PoolEntry[] = [];
    const seen = new Set<string>();
    const existingKeyByUrl = new Map<string, string>();
    for (const e of current.reverseProxyPool) existingKeyByUrl.set(e.url, e.apiKey);

    for (let i = 0; i < body.reverseProxyPool.length; i++) {
      const incoming = body.reverseProxyPool[i] ?? {};
      let url: string;
      try {
        url = validateUrl(incoming.url ?? "", `reverseProxyPool[${i}].url`);
      } catch (e) {
        res.status(400).json({ error: { message: (e as Error).message, type: "validation_error" } });
        return;
      }
      if (!url) {
        res.status(400).json({
          error: { message: `reverseProxyPool[${i}].url is required`, type: "validation_error" },
        });
        return;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      let apiKey = existingKeyByUrl.get(url) ?? "";
      if (typeof incoming.apiKey === "string" && incoming.apiKey.length > 0) {
        apiKey = incoming.apiKey;
      } else if (incoming.apiKey === null) {
        apiKey = "";
      }
      cleaned.push({ url, apiKey });
    }
    patch.reverseProxyPool = cleaned;
  }

  if (body.reverseProxyUrl !== undefined || body.reverseProxyApiKey !== undefined) {
    let url = current.reverseProxyPool[0]?.url ?? "";
    let apiKey = current.reverseProxyPool[0]?.apiKey ?? "";
    if (typeof body.reverseProxyUrl === "string") {
      try {
        url = validateUrl(body.reverseProxyUrl, "reverseProxyUrl");
      } catch (e) {
        res.status(400).json({ error: { message: (e as Error).message, type: "validation_error" } });
        return;
      }
    }
    if (typeof body.reverseProxyApiKey === "string" && body.reverseProxyApiKey.length > 0) {
      apiKey = body.reverseProxyApiKey;
    } else if (body.reverseProxyApiKey === null) {
      apiKey = "";
    }
    patch.reverseProxyPool = url ? [{ url, apiKey }] : [];
  }

  if (body.providerOverrides && typeof body.providerOverrides === "object") {
    const merged: ProviderOverrides = { ...current.providerOverrides };
    for (const p of PROVIDERS) {
      const incoming = body.providerOverrides[p];
      if (!incoming) continue;
      if (incoming.url !== undefined) {
        try {
          merged[p].url = validateUrl(incoming.url, `providerOverrides.${p}.url`);
        } catch (e) {
          res.status(400).json({ error: { message: (e as Error).message, type: "validation_error" } });
          return;
        }
      }
      if (typeof incoming.apiKey === "string" && incoming.apiKey.length > 0) {
        merged[p].apiKey = incoming.apiKey;
      } else if (incoming.apiKey === null) {
        merged[p].apiKey = "";
      }
    }
    patch.providerOverrides = merged;
  }

  const wantEnabled = patch.reverseProxyEnabled ?? current.reverseProxyEnabled;
  const nextCcPool = patch.ccUpstreamKeyPool ?? current.ccUpstreamKeyPool;
  const nextLegacyCcKey = patch.ccUpstreamApiKey ?? current.ccUpstreamApiKey;
  const hasCcKey = nextCcPool.length > 0 || !!nextLegacyCcKey.trim() || !!process.env["CC_UPSTREAM_API_KEY"]?.trim();
  if (wantEnabled && !hasCcKey) {
    res.status(400).json({
      error: {
        message: "ccUpstreamKeyPool must contain at least one upstream API Key before enabling cc upstream mode",
        type: "validation_error",
      },
    });
    return;
  }

  const updated = updateSettings(patch);
  res.json(toPublic(updated));
});

export default router;
