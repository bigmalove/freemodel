import { getSettings, type ProviderName } from "./settings.js";

export type { ProviderName };

export type ProviderEndpointSource = "upstream" | "local-env" | "per-provider override";

export interface ProviderEndpoint {
  baseUrl: string;
  apiKey: string;
  source: ProviderEndpointSource;
}

const ENV_BY_PROVIDER: Record<ProviderName, { baseUrl: string; apiKey: string }> = {
  openai:     { baseUrl: "AI_INTEGRATIONS_OPENAI_BASE_URL",     apiKey: "AI_INTEGRATIONS_OPENAI_API_KEY" },
  anthropic:  { baseUrl: "AI_INTEGRATIONS_ANTHROPIC_BASE_URL",  apiKey: "AI_INTEGRATIONS_ANTHROPIC_API_KEY" },
  gemini:     { baseUrl: "AI_INTEGRATIONS_GEMINI_BASE_URL",     apiKey: "AI_INTEGRATIONS_GEMINI_API_KEY" },
  openrouter: { baseUrl: "AI_INTEGRATIONS_OPENROUTER_BASE_URL", apiKey: "AI_INTEGRATIONS_OPENROUTER_API_KEY" },
};

// Upstream `/modelfarm/<segment>` segment per provider. Note `gemini` → `google`.
const UPSTREAM_SEGMENT: Record<ProviderName, string> = {
  openai:     "openai",
  anthropic:  "anthropic",
  gemini:     "google",
  openrouter: "openrouter",
};

/**
 * Resolve the upstream endpoint for a provider.
 *
 * Resolution order when reverse-proxy mode is enabled:
 *   1. Per-provider override URL (with per-provider key, falling back to global key)
 *   2. Global upstream URL + global key
 *   3. Local Replit AI Integration env vars
 *
 * When reverse-proxy mode is disabled, only env vars are consulted.
 *
 * Throws when no source is available.
 */
export function resolveProviderEndpoint(provider: ProviderName): ProviderEndpoint {
  const settings = getSettings();
  if (settings.reverseProxyEnabled) {
    const override = settings.providerOverrides[provider];
    const overrideUrl = override.url.trim().replace(/\/+$/, "");
    const baseUrl = overrideUrl || settings.reverseProxyUrl;
    if (baseUrl) {
      const trimmed = baseUrl.replace(/\/+$/, "");
      const apiKey = override.apiKey || settings.reverseProxyApiKey || "";
      return {
        baseUrl: `${trimmed}/modelfarm/${UPSTREAM_SEGMENT[provider]}`,
        apiKey,
        source: overrideUrl ? "per-provider override" : "upstream",
      };
    }
  }

  const envKeys = ENV_BY_PROVIDER[provider];
  const baseUrl = process.env[envKeys.baseUrl];
  const apiKey = process.env[envKeys.apiKey];
  if (!baseUrl || !apiKey) {
    throw new Error(
      `Provider "${provider}" is not configured. Either set ${envKeys.baseUrl} and ${envKeys.apiKey}, or enable reverse-proxy mode in the admin portal.`,
    );
  }
  return { baseUrl, apiKey, source: "local-env" };
}

export function isReverseProxyActive(): boolean {
  const s = getSettings();
  if (!s.reverseProxyEnabled) return false;
  if (s.reverseProxyUrl) return true;
  // Also active if any per-provider override URL is set.
  return Object.values(s.providerOverrides).some((o) => !!o.url);
}

/**
 * Resolve only the source label per provider, without throwing when env is
 * missing. Useful for the setup-status endpoint.
 */
export function resolveProviderSource(provider: ProviderName): ProviderEndpointSource | null {
  const settings = getSettings();
  if (settings.reverseProxyEnabled) {
    const override = settings.providerOverrides[provider];
    const overrideUrl = override.url.trim();
    if (overrideUrl) return "per-provider override";
    if (settings.reverseProxyUrl) return "upstream";
  }
  const envKeys = ENV_BY_PROVIDER[provider];
  if (process.env[envKeys.baseUrl] && process.env[envKeys.apiKey]) return "local-env";
  return null;
}
