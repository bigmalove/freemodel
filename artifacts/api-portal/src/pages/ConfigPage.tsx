import { useState, useEffect } from "react";
import {
  fetchSetupStatus,
  fetchSettings,
  updateSettings,
  type SetupStatus,
  type Settings,
  type ProviderName,
  type ProviderSource,
  type SettingsPatch,
} from "../lib/api";

const PROVIDERS: readonly ProviderName[] = ["openai", "anthropic", "gemini", "openrouter"];

const PROVIDER_LABEL: Record<ProviderName, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

function Badge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
      }`}
    >
      <span className="size-1.5 rounded-full inline-block" style={{ background: ok ? "#4ade80" : "#f87171" }} />
      {ok ? "Configured" : "Not set"}
    </span>
  );
}

function SourcePill({ source }: { source: ProviderSource | null | undefined }) {
  if (!source) return null;
  const styles: Record<ProviderSource, string> = {
    "upstream": "bg-blue-500/15 text-blue-400",
    "local-env": "bg-zinc-500/15 text-zinc-300",
    "per-provider override": "bg-purple-500/15 text-purple-400",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${styles[source]}`}>
      {source}
    </span>
  );
}

type OverrideDraft = { url: string; apiKey: string };

function emptyDraft(): OverrideDraft {
  return { url: "", apiKey: "" };
}

function emptyDrafts(): Record<ProviderName, OverrideDraft> {
  return {
    openai: emptyDraft(),
    anthropic: emptyDraft(),
    gemini: emptyDraft(),
    openrouter: emptyDraft(),
  };
}

export default function ConfigPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState(localStorage.getItem("gateway_api_key") ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  // Reverse-proxy form state
  const [rpUrl, setRpUrl] = useState("");
  const [rpKey, setRpKey] = useState("");
  const [rpSaving, setRpSaving] = useState(false);
  const [rpSaved, setRpSaved] = useState(false);
  const [rpErr, setRpErr] = useState("");

  // Per-provider override form state (drafts; URL syncs from server, key is write-only).
  const [overrideDrafts, setOverrideDrafts] = useState<Record<ProviderName, OverrideDraft>>(emptyDrafts());
  const [ovSavingProvider, setOvSavingProvider] = useState<ProviderName | null>(null);
  const [ovSavedProvider, setOvSavedProvider] = useState<ProviderName | null>(null);
  const [ovErr, setOvErr] = useState<Partial<Record<ProviderName, string>>>({});

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  function syncFormsFromSettings(cfg: Settings) {
    setRpUrl(cfg.reverseProxyUrl ?? "");
    setRpKey("");
    const next: Record<ProviderName, OverrideDraft> = emptyDrafts();
    for (const p of PROVIDERS) {
      next[p] = { url: cfg.providerOverrides?.[p]?.url ?? "", apiKey: "" };
    }
    setOverrideDrafts(next);
  }

  useEffect(() => {
    fetchSetupStatus().then(setStatus).catch((e) => setLoadErr(String(e)));
    fetchSettings()
      .then((cfg) => {
        setSettings(cfg);
        syncFormsFromSettings(cfg);
      })
      .catch(() => {
        // Likely 401 — admin key not yet entered. Silent; user will save key.
      });
  }, []);

  async function refreshAll() {
    const [s, cfg] = await Promise.all([fetchSetupStatus(), fetchSettings()]);
    setStatus(s);
    setSettings(cfg);
    syncFormsFromSettings(cfg);
  }

  async function toggleReverseProxy() {
    if (!settings) return;
    setRpSaving(true);
    setRpErr("");
    try {
      const updated = await updateSettings({ reverseProxyEnabled: !settings.reverseProxyEnabled });
      setSettings(updated);
      const s = await fetchSetupStatus();
      setStatus(s);
    } catch (e) {
      setRpErr(String(e));
    } finally {
      setRpSaving(false);
    }
  }

  async function saveReverseProxyEndpoint() {
    setRpSaving(true);
    setRpErr("");
    try {
      const url = rpUrl.trim().replace(/\/+$/, "");
      if (url && !/^https?:\/\//i.test(url)) {
        throw new Error("URL must start with http:// or https://");
      }
      const patch: SettingsPatch = { reverseProxyUrl: url };
      if (rpKey.length > 0) patch.reverseProxyApiKey = rpKey;
      const updated = await updateSettings(patch);
      setSettings(updated);
      setRpUrl(updated.reverseProxyUrl);
      setRpKey("");
      const s = await fetchSetupStatus();
      setStatus(s);
      setRpSaved(true);
      setTimeout(() => setRpSaved(false), 2000);
    } catch (e) {
      setRpErr(String(e));
    } finally {
      setRpSaving(false);
    }
  }

  async function clearReverseProxyKey() {
    setRpSaving(true);
    setRpErr("");
    try {
      const updated = await updateSettings({ reverseProxyApiKey: null });
      setSettings(updated);
      setRpKey("");
    } catch (e) {
      setRpErr(String(e));
    } finally {
      setRpSaving(false);
    }
  }

  async function saveOverride(provider: ProviderName) {
    setOvSavingProvider(provider);
    setOvErr((prev) => ({ ...prev, [provider]: "" }));
    try {
      const draft = overrideDrafts[provider];
      const url = draft.url.trim().replace(/\/+$/, "");
      if (url && !/^https?:\/\//i.test(url)) {
        throw new Error("URL must start with http:// or https://");
      }
      const patch: SettingsPatch = { providerOverrides: { [provider]: { url } } };
      if (draft.apiKey.length > 0) {
        patch.providerOverrides![provider]!.apiKey = draft.apiKey;
      }
      await updateSettings(patch);
      await refreshAll();
      setOvSavedProvider(provider);
      setTimeout(() => setOvSavedProvider((p) => (p === provider ? null : p)), 2000);
    } catch (e) {
      setOvErr((prev) => ({ ...prev, [provider]: String(e) }));
    } finally {
      setOvSavingProvider(null);
    }
  }

  async function clearOverrideKey(provider: ProviderName) {
    setOvSavingProvider(provider);
    setOvErr((prev) => ({ ...prev, [provider]: "" }));
    try {
      await updateSettings({ providerOverrides: { [provider]: { apiKey: null } } });
      await refreshAll();
    } catch (e) {
      setOvErr((prev) => ({ ...prev, [provider]: String(e) }));
    } finally {
      setOvSavingProvider(null);
    }
  }

  async function saveApiKey() {
    if (apiKey.trim()) {
      localStorage.setItem("gateway_api_key", apiKey.trim());
    } else {
      localStorage.removeItem("gateway_api_key");
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    try {
      await refreshAll();
    } catch (e) {
      setLoadErr(String(e));
    }
  }

  async function toggleSillyTavern() {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await updateSettings({ sillyTavernMode: !settings.sillyTavernMode });
      setSettings(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Configuration</h2>
        <p className="text-sm text-muted-foreground">Manage gateway settings and API key authentication.</p>
      </div>

      {loadErr && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {loadErr}
        </div>
      )}

      {/* Base URL */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Gateway Base URL</h3>
        <div className="flex items-center gap-2 rounded-md bg-secondary/50 px-3 py-2 font-mono text-sm text-foreground">
          {baseUrl}
        </div>
        <p className="text-xs text-muted-foreground">
          Use this URL as the base for all API calls. For OpenAI-compatible clients, append <code className="bg-secondary/60 px-1 rounded">/v1</code>.
        </p>
      </div>

      {/* Gateway API Key */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Gateway API Key (for this browser)</h3>
        <p className="text-xs text-muted-foreground">
          If you set <code className="bg-secondary/60 px-1 rounded">PROXY_API_KEY</code> as an environment variable on the server, enter it here to authenticate admin requests. Stored in local storage only.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="flex-1 rounded-md border border-input bg-secondary/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={saveApiKey}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {saved ? "Saved!" : "Save"}
          </button>
        </div>
      </div>

      {/* Gateway Auth Status */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Gateway Auth Status</h3>
        {status ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">PROXY_API_KEY</span>
            <Badge ok={status.providers.proxyKey} />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Loading...</div>
        )}
        <p className="text-xs text-muted-foreground">
          Set <code className="bg-secondary/60 px-1 rounded">PROXY_API_KEY</code> as an environment variable to require authentication on all <code className="bg-secondary/60 px-1 rounded">/v1/*</code> requests. If not set, the gateway is open.
        </p>
      </div>

      {/* Reverse Proxy / Upstream Forwarding */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Upstream Reverse Proxy</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Forward all 4 providers to a remote upstream gateway's{" "}
              <code className="bg-secondary/60 px-1 rounded">/modelfarm/&#123;openai,anthropic,google,openrouter&#125;</code> endpoints
              instead of using this Repl's local Replit AI Integration keys. Useful for piggybacking on a central Repl.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings?.reverseProxyEnabled ?? false}
            disabled={rpSaving || !settings}
            onClick={toggleReverseProxy}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 ${
              settings?.reverseProxyEnabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                settings?.reverseProxyEnabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted-foreground">Global Upstream Base URL</label>
          <input
            type="text"
            value={rpUrl}
            onChange={(e) => setRpUrl(e.target.value)}
            placeholder="https://your-upstream.replit.dev"
            className="w-full rounded-md border border-input bg-secondary/30 px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Trailing slash is stripped. The path <code className="bg-secondary/60 px-1 rounded">/modelfarm/&lt;provider&gt;</code> is appended automatically. Per-provider overrides below take precedence.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted-foreground">
            Global Upstream API Key <span className="opacity-60">(only needed if upstream sets PROXY_API_KEY)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="new-password"
              value={rpKey}
              onChange={(e) => setRpKey(e.target.value)}
              placeholder={settings?.reverseProxyApiKeySet ? "•••••••• (saved — leave blank to keep)" : "sk-..."}
              className="flex-1 rounded-md border border-input bg-secondary/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {settings?.reverseProxyApiKeySet && (
              <button
                type="button"
                onClick={clearReverseProxyKey}
                disabled={rpSaving}
                className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            The saved key is never sent back to the browser. Leave blank when saving to keep the existing one.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={saveReverseProxyEndpoint}
            disabled={rpSaving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {rpSaved ? "Saved!" : rpSaving ? "Saving..." : "Save Endpoint"}
          </button>
          {settings?.reverseProxyEnabled && (settings?.reverseProxyUrl || Object.values(settings?.providerOverrides ?? {}).some((o) => !!o.url)) && (
            <span className="text-xs text-green-400">Active</span>
          )}
          {!settings?.reverseProxyEnabled && (
            <span className="text-xs text-muted-foreground">
              Disabled — using local env keys
            </span>
          )}
        </div>

        {rpErr && <div className="text-xs text-destructive">{rpErr}</div>}
      </div>

      {/* Per-provider overrides */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Per-provider Overrides</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Optionally route individual providers to a different upstream URL or with a different API key. Blank fields fall back to the global upstream above; if the global is also blank, the provider falls back to its local Replit AI Integration env vars.
          </p>
        </div>

        <div className="space-y-4">
          {PROVIDERS.map((provider) => {
            const draft = overrideDrafts[provider];
            const stored = settings?.providerOverrides?.[provider];
            const source = status?.providerSources?.[provider] ?? null;
            return (
              <div key={provider} className="rounded-md border border-border/60 bg-secondary/10 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{PROVIDER_LABEL[provider]}</span>
                    <SourcePill source={source} />
                  </div>
                  <Badge ok={!!status?.providers[provider]} />
                </div>
                <input
                  type="text"
                  value={draft.url}
                  onChange={(e) =>
                    setOverrideDrafts((prev) => ({ ...prev, [provider]: { ...prev[provider], url: e.target.value } }))
                  }
                  placeholder="(blank — use global upstream)"
                  className="w-full rounded-md border border-input bg-secondary/30 px-3 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex gap-2">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={draft.apiKey}
                    onChange={(e) =>
                      setOverrideDrafts((prev) => ({ ...prev, [provider]: { ...prev[provider], apiKey: e.target.value } }))
                    }
                    placeholder={stored?.apiKeySet ? "•••••••• (saved — leave blank to keep)" : "(blank — use global key)"}
                    className="flex-1 rounded-md border border-input bg-secondary/30 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {stored?.apiKeySet && (
                    <button
                      type="button"
                      onClick={() => clearOverrideKey(provider)}
                      disabled={ovSavingProvider === provider}
                      className="rounded-md border border-border bg-secondary/30 px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
                    >
                      Clear key
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => saveOverride(provider)}
                    disabled={ovSavingProvider === provider}
                    className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {ovSavedProvider === provider
                      ? "Saved!"
                      : ovSavingProvider === provider
                        ? "Saving..."
                        : "Save"}
                  </button>
                </div>
                {ovErr[provider] && <div className="text-xs text-destructive">{ovErr[provider]}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Provider Status */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">AI Provider Status</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {status?.reverseProxy
              ? "Reverse-proxy mode active — providers forwarded to upstream gateway (with per-provider overrides where set)."
              : "All providers are connected via Replit AI Integrations — no external API keys required. Usage is billed to your Replit credits."}
          </p>
        </div>
        {status ? (
          <div className="space-y-2">
            {PROVIDERS.map((provider) => (
              <div key={provider} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{PROVIDER_LABEL[provider]}</span>
                <div className="flex items-center gap-2">
                  <SourcePill source={status.providerSources?.[provider] ?? null} />
                  <Badge ok={status.providers[provider]} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Loading...</div>
        )}
      </div>

      {/* SillyTavern Mode */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">SillyTavern Mode</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              When enabled, appends{" "}
              <code className="bg-secondary/60 px-1 rounded">{"{ role: \"user\", content: \"继续\" }"}</code> to
              Claude requests that have no tools. Useful for SillyTavern clients.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings?.sillyTavernMode ?? false}
            disabled={saving || !settings}
            onClick={toggleSillyTavern}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 ${
              settings?.sillyTavernMode ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                settings?.sillyTavernMode ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* System info */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">About This Gateway</h3>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li>• Single-instance AI gateway — no clusters, no nodes</li>
          <li>• Unified OpenAI-compatible interface for 4 providers</li>
          <li>• Powered by Replit AI Integrations — no external API keys needed</li>
          <li>• Supports streaming SSE and tool calling</li>
          <li>• Default model: <code className="bg-secondary/60 px-1 rounded">gpt-4.1-mini</code></li>
        </ul>
      </div>
    </div>
  );
}
