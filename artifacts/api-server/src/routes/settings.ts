import { Router } from "express";
import {
  getSettings,
  updateSettings,
  type ServerSettings,
  type ProviderName,
  type ProviderOverrides,
} from "../lib/settings.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

const PROVIDERS: readonly ProviderName[] = ["openai", "anthropic", "gemini", "openrouter"];

interface PublicProviderOverride {
  url: string;
  apiKeySet: boolean;
}

interface PublicSettings {
  sillyTavernMode: boolean;
  reverseProxyEnabled: boolean;
  reverseProxyUrl: string;
  reverseProxyApiKeySet: boolean;
  providerOverrides: Record<ProviderName, PublicProviderOverride>;
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
    reverseProxyUrl: s.reverseProxyUrl,
    reverseProxyApiKeySet: !!s.reverseProxyApiKey,
    providerOverrides: overrides,
  };
}

function validateUrl(url: string, fieldName = "reverseProxyUrl"): string {
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
  const body = (req.body ?? {}) as Partial<ServerSettings> & {
    providerOverrides?: Partial<
      Record<ProviderName, { url?: string; apiKey?: string | null }>
    >;
  };
  const patch: Partial<ServerSettings> = {};

  if (typeof body.sillyTavernMode === "boolean") {
    patch.sillyTavernMode = body.sillyTavernMode;
  }
  if (typeof body.reverseProxyEnabled === "boolean") {
    patch.reverseProxyEnabled = body.reverseProxyEnabled;
  }
  if (typeof body.reverseProxyUrl === "string") {
    try {
      patch.reverseProxyUrl = validateUrl(body.reverseProxyUrl);
    } catch (e) {
      res.status(400).json({ error: { message: (e as Error).message, type: "validation_error" } });
      return;
    }
  }
  // Only update the API key when a non-empty string is provided. Empty string
  // means "leave unchanged"; to clear it the client must send `null`.
  if (typeof body.reverseProxyApiKey === "string" && body.reverseProxyApiKey.length > 0) {
    patch.reverseProxyApiKey = body.reverseProxyApiKey;
  } else if (body.reverseProxyApiKey === null) {
    patch.reverseProxyApiKey = "";
  }

  if (body.providerOverrides && typeof body.providerOverrides === "object") {
    const current = getSettings();
    const merged: ProviderOverrides = {
      openai: { ...current.providerOverrides.openai },
      anthropic: { ...current.providerOverrides.anthropic },
      gemini: { ...current.providerOverrides.gemini },
      openrouter: { ...current.providerOverrides.openrouter },
    };
    for (const p of PROVIDERS) {
      const incoming = body.providerOverrides[p];
      if (!incoming) continue;
      if (typeof incoming.url === "string") {
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

  // Reject enabling reverse-proxy mode without a usable upstream URL — either
  // the global one or at least one per-provider override.
  const current = getSettings();
  const wantEnabled = patch.reverseProxyEnabled ?? current.reverseProxyEnabled;
  const nextUrl = patch.reverseProxyUrl ?? current.reverseProxyUrl;
  const nextOverrides = patch.providerOverrides ?? current.providerOverrides;
  const anyOverrideUrl = Object.values(nextOverrides).some((o) => !!o.url);
  if (wantEnabled && !nextUrl && !anyOverrideUrl) {
    res.status(400).json({
      error: {
        message:
          "reverseProxyUrl (or at least one providerOverrides.<provider>.url) must be set before enabling reverse-proxy mode",
        type: "validation_error",
      },
    });
    return;
  }

  const updated = updateSettings(patch);
  res.json(toPublic(updated));
});

export default router;
