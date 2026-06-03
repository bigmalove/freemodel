import { useEffect, useState } from "react";
import {
  fetchCooldowns,
  fetchSettings,
  fetchSetupStatus,
  getApiKey,
  reEnableCcUpstreamKey,
  setClientKey,
  testCcConnection,
  updateSettings,
  verifyKey,
  type CcKeyEntryPatch,
  type ReverseProxyMode,
  type Settings,
  type SetupStatus,
} from "../lib/api";

type CcKeyDraftEntry = {
  id?: string;
  apiKey: string;
  apiKeyWasSet: boolean;
};

function Badge({ ok, okText = "已配置", badText = "未设置" }: { ok: boolean; okText?: string; badText?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ok ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
      <span className="size-1.5 rounded-full inline-block" style={{ background: ok ? "#4ade80" : "#f87171" }} />
      {ok ? okText : badText}
    </span>
  );
}

function keyLabel(id: string | undefined, index: number): string {
  return id ? `Key #${index + 1} (${id.slice(0, 10)})` : `Key #${index + 1}`;
}

export default function ConfigPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clientKey, setClientKeyState] = useState(() => getApiKey());
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [ccDraft, setCcDraft] = useState<CcKeyDraftEntry[]>([]);
  const [poolMode, setPoolMode] = useState<ReverseProxyMode>("sticky");
  const [loading, setLoading] = useState(true);
  const [savingClientKey, setSavingClientKey] = useState(false);
  const [savingPool, setSavingPool] = useState(false);
  const [savedClientKey, setSavedClientKey] = useState(false);
  const [savedPool, setSavedPool] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [poolErr, setPoolErr] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [reEnablingId, setReEnablingId] = useState<string | null>(null);
  const [reEnableErr, setReEnableErr] = useState("");
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  function syncFormsFromSettings(cfg: Settings) {
    setPoolMode(cfg.reverseProxyMode);
    setCcDraft(cfg.ccUpstreamKeyPool.map((e) => ({ id: e.id, apiKey: "", apiKeyWasSet: e.apiKeySet })));
  }

  async function refreshAll() {
    const setup = await fetchSetupStatus();
    setStatus(setup);
    try {
      const cfg = await fetchSettings();
      setSettings(cfg);
      syncFormsFromSettings(cfg);
    } catch {
      // 可能还未输入管理 Key，保留基础状态即可。
    }
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setLoadErr("");
      try {
        const setup = await fetchSetupStatus();
        if (!active) return;
        setStatus(setup);
        try {
          const cfg = await fetchSettings();
          if (!active) return;
          setSettings(cfg);
          syncFormsFromSettings(cfg);
        } catch {
          // 管理 Key 未输入或错误时，配置详情暂不加载。
        }
      } catch (e) {
        if (active) setLoadErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const data = await fetchCooldowns();
        if (active) setCooldowns(data);
      } catch {
        // 管理 Key 未输入时忽略。
      }
    }
    void poll();
    const id = window.setInterval(poll, 3000);
    return () => { active = false; window.clearInterval(id); };
  }, []);

  async function saveClientKey() {
    setSavingClientKey(true);
    setClientKey(clientKey);
    try {
      const result = await verifyKey();
      setKeyValid(result.valid || !result.keyRequired);
      setSavedClientKey(true);
      window.setTimeout(() => setSavedClientKey(false), 1800);
      await refreshAll();
    } catch {
      setKeyValid(false);
    } finally {
      setSavingClientKey(false);
    }
  }

  function addCcKeyRow() {
    setCcDraft((prev) => [...prev, { apiKey: "", apiKeyWasSet: false }]);
  }

  function removeCcKeyRow(index: number) {
    setCcDraft((prev) => prev.filter((_, i) => i !== index));
  }

  function moveCcKeyRow(index: number, dir: -1 | 1) {
    setCcDraft((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  async function saveCcPool() {
    setSavingPool(true);
    setPoolErr("");
    try {
      const entries: CcKeyEntryPatch[] = [];
      for (let i = 0; i < ccDraft.length; i++) {
        const row = ccDraft[i]!;
        const apiKey = row.apiKey.trim();
        if (!row.id && !apiKey) throw new Error(`第 ${i + 1} 条 cc 上游 Key 不能为空`);
        if (row.id && !row.apiKeyWasSet && !apiKey) throw new Error(`第 ${i + 1} 条 cc 上游 Key 不能为空`);
        const patch: CcKeyEntryPatch = row.id ? { id: row.id } : {};
        if (apiKey) patch.apiKey = apiKey;
        entries.push(patch);
      }

      const updated = await updateSettings({
        reverseProxyMode: poolMode,
        reverseProxyEnabled: entries.length > 0,
        ccUpstreamKeyPool: entries,
      });
      setSettings(updated);
      syncFormsFromSettings(updated);
      setStatus(await fetchSetupStatus());
      setSavedPool(true);
      window.setTimeout(() => setSavedPool(false), 1800);
    } catch (e) {
      setPoolErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPool(false);
    }
  }

  async function togglePoolEnabled() {
    if (!settings) return;
    setSavingPool(true);
    setPoolErr("");
    try {
      const updated = await updateSettings({ reverseProxyEnabled: !settings.reverseProxyEnabled });
      setSettings(updated);
      setStatus(await fetchSetupStatus());
    } catch (e) {
      setPoolErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPool(false);
    }
  }

  async function runTest() {
    setTestLoading(true);
    setTestResult("");
    try {
      const result = await testCcConnection();
      setTestResult(result.ok ? `连接成功：${result.model} 返回 ${result.content}` : `连接失败：${result.content ?? result.error ?? "unknown"}`);
      await refreshAll();
    } catch (e) {
      setTestResult(`连接失败：${e instanceof Error ? e.message : String(e)}`);
      try { await refreshAll(); } catch {}
    } finally {
      setTestLoading(false);
    }
  }

  async function handleReEnable(id: string) {
    setReEnablingId(id);
    setReEnableErr("");
    try {
      await reEnableCcUpstreamKey(id);
      await refreshAll();
    } catch (e) {
      setReEnableErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReEnablingId(null);
    }
  }

  async function toggleSillyTavern() {
    if (!settings) return;
    setSavingPool(true);
    try {
      const updated = await updateSettings({ sillyTavernMode: !settings.sillyTavernMode });
      setSettings(updated);
    } finally {
      setSavingPool(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">加载配置中...</div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">配置</h2>
        <p className="text-sm text-muted-foreground">管理网关 Key、cc 上游 Key 池与运行模式。</p>
      </div>

      {loadErr && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {loadErr}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">网关基础地址</h3>
        <div className="flex items-center gap-2 rounded-md bg-secondary/50 px-3 py-2 font-mono text-sm text-foreground">
          {baseUrl}
        </div>
        <p className="text-xs text-muted-foreground">
          OpenAI 兼容客户端请使用 <code className="bg-secondary/60 px-1 rounded">{baseUrl}/v1</code>。
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">网关访问 API Key</h3>
          <Badge ok={!!status?.providers.proxyKey} />
        </div>
        <p className="text-xs text-muted-foreground">这是客户端访问本网关的 PROXY_API_KEY，只保存在当前浏览器。</p>
        <div className="flex gap-2">
          <input
            type="password"
            value={clientKey}
            onChange={(e) => setClientKeyState(e.target.value)}
            placeholder="输入 PROXY_API_KEY"
            className="flex-1 rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={saveClientKey}
            disabled={savingClientKey}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {savedClientKey ? "已保存!" : savingClientKey ? "保存中..." : "保存"}
          </button>
        </div>
        {keyValid !== null && (
          <p className={`text-xs ${keyValid ? "text-green-400" : "text-red-400"}`}>
            {keyValid ? "管理 Key 验证通过" : "管理 Key 验证失败"}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">cc 上游 API Key 池</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              上游地址固定为 <code className="bg-secondary/60 px-1 rounded">https://cc.freemodel.dev</code>。这里只管理多个上游 API Key；密钥不回显明文。
            </p>
          </div>
          <Badge ok={!!status?.providers.cc} />
        </div>

        {!settings ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            请输入并保存正确的网关访问 API Key 后，才能管理 cc 上游 Key 池。
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-secondary/20 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">模式</span>
                {(["sticky", "round-robin"] as ReverseProxyMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPoolMode(mode)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${poolMode === mode ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-muted-foreground hover:text-foreground"}`}
                  >
                    {mode === "round-robin" ? "轮询" : "固定(使用 #1)"}
                  </button>
                ))}
              </div>
              <button
                role="switch"
                aria-checked={settings.reverseProxyEnabled}
                disabled={savingPool}
                onClick={togglePoolEnabled}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${settings.reverseProxyEnabled ? "bg-primary" : "bg-secondary"}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition ${settings.reverseProxyEnabled ? "translate-x-5" : "translate-x-0"}`} />
              </button>
              <span className="text-xs text-muted-foreground">
                {settings.reverseProxyEnabled
                  ? `已启用 — ${settings.ccUpstreamKeyPool.length} 个 Key，${poolMode === "round-robin" ? "轮询" : "固定"}模式`
                  : "已关闭 — 不使用 Key 池"}
              </span>
            </div>

            <div className="space-y-3">
              {ccDraft.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  尚未添加 cc 上游 API Key，请点击“添加 Key”。
                </div>
              ) : (
                ccDraft.map((row, index) => (
                  <div key={row.id ?? `new-${index}`} className="rounded-md border border-border bg-secondary/20 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-foreground">
                        {keyLabel(row.id, index)}
                        {index === 0 && <span className="ml-1 text-[10px] text-muted-foreground">(固定模式使用此条)</span>}
                      </div>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => moveCcKeyRow(index, -1)} disabled={index === 0} className="rounded border border-border bg-secondary/30 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary/60 disabled:opacity-30">上移</button>
                        <button type="button" onClick={() => moveCcKeyRow(index, 1)} disabled={index === ccDraft.length - 1} className="rounded border border-border bg-secondary/30 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary/60 disabled:opacity-30">下移</button>
                        <button type="button" onClick={() => removeCcKeyRow(index)} className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/20">移除</button>
                      </div>
                    </div>
                    <input
                      type="password"
                      value={row.apiKey}
                      onChange={(e) => setCcDraft((prev) => prev.map((item, i) => i === index ? { ...item, apiKey: e.target.value } : item))}
                      placeholder={row.apiKeyWasSet ? "••••• (已保存 — 输入新 Key 可覆盖)" : "fe_oa_..."}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={addCcKeyRow} className="rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary/60 transition-colors">
                + 添加 Key
              </button>
              <button type="button" onClick={saveCcPool} disabled={savingPool} className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
                {savedPool ? "已保存!" : savingPool ? "保存中..." : "保存 Key 池"}
              </button>
              <button type="button" onClick={runTest} disabled={testLoading || !settings.ccUpstreamApiKeySet} className="rounded-md border border-border bg-secondary/30 px-4 py-1.5 text-xs text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50">
                {testLoading ? "测试中..." : "连接测试"}
              </button>
            </div>
            {poolErr && <div className="text-xs text-destructive">{poolErr}</div>}
            {testResult && <div className={`text-xs ${testResult.startsWith("连接成功") ? "text-green-400" : "text-red-400"}`}>{testResult}</div>}
          </>
        )}
      </div>

      {settings && settings.disabledCcUpstreamKeys.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-amber-300">被屏蔽的 cc 上游 Key</h3>
            <p className="mt-1 text-xs text-amber-200/80">Key 因上游返回 401/403 被自动屏蔽。点击“重新启用”会恢复到 Key 池末尾。</p>
          </div>
          <div className="space-y-2">
            {settings.disabledCcUpstreamKeys.map((item, index) => (
              <div key={item.id} className="rounded-md border border-amber-500/20 bg-background/50 p-3 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-foreground">{keyLabel(item.id, index)}</div>
                  <button type="button" onClick={() => handleReEnable(item.id)} disabled={reEnablingId === item.id} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50">
                    {reEnablingId === item.id ? "恢复中..." : "重新启用"}
                  </button>
                </div>
                <div className="text-muted-foreground">
                  {item.upstreamStatus ? `上游状态：${item.upstreamStatus}` : "上游状态：未知"}
                  {item.disabledAt ? ` · 时间：${new Date(item.disabledAt).toLocaleString()}` : ""}
                </div>
                {item.lastError && <div className="break-all text-amber-100/80">{item.lastError}</div>}
              </div>
            ))}
          </div>
          {reEnableErr && <div className="text-xs text-destructive">{reEnableErr}</div>}
        </div>
      )}

      {Object.keys(cooldowns).length > 0 && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-blue-300">限速冷却中的 cc 上游 Key</h3>
          <p className="text-xs text-blue-200/80">Key 因 429 限速进入短暂冷却，轮询期间会自动跳过。</p>
          <div className="space-y-1 text-xs text-muted-foreground">
            {Object.entries(cooldowns).map(([id, ms]) => (
              <div key={id} className="flex justify-between rounded bg-background/50 px-3 py-2">
                <span>{id}</span>
                <span>{Math.ceil(ms / 1000)} 秒</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">SillyTavern 模式</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              启用后，会在不带工具调用的 Claude 请求末尾追加 <code className="bg-secondary/60 px-1 rounded">{"{ role: \"user\", content: \"继续\" }"}</code>。
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings?.sillyTavernMode ?? false}
            disabled={savingPool || !settings}
            onClick={toggleSillyTavern}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${settings?.sillyTavernMode ? "bg-primary" : "bg-secondary"}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition ${settings?.sillyTavernMode ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">关于本网关</h3>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li>• OpenAI 兼容 cc.freemodel.dev 中转</li>
          <li>• 上游 URL 固定，支持多个上游 API Key</li>
          <li>• 支持固定使用第一条或轮询使用 Key 池</li>
          <li>• 401/403 自动屏蔽 Key，429 自动冷却并跳过</li>
          <li>• 支持 SSE 流式响应、thinking 变种与模型启停</li>
        </ul>
      </div>
    </div>
  );
}
