import { useEffect, useState } from "react";
import {
  fetchSetupStatus,
  fetchSettings,
  updateSettings,
  verifyKey,
  setClientKey,
  getApiKey,
  testCcConnection,
  type SetupStatus,
  type Settings,
} from "../lib/api";

function StatusBadge({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ok ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
      <span className="size-1.5 rounded-full inline-block" style={{ background: ok ? "#4ade80" : "#f87171" }} />
      {ok ? okText : badText}
    </span>
  );
}

export default function ConfigPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clientKey, setClientKeyState] = useState(() => getApiKey());
  const [ccKey, setCcKey] = useState("");
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError("");
      const [setup, cfg] = await Promise.all([fetchSetupStatus(), fetchSettings()]);
      setStatus(setup);
      setSettings(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveClientKey() {
    setClientKey(clientKey);
    try {
      const result = await verifyKey();
      setKeyValid(result.valid || !result.keyRequired);
    } catch {
      setKeyValid(false);
    }
  }

  async function saveCcKey() {
    try {
      setSaving(true);
      setError("");
      const next = await updateSettings({ ccUpstreamApiKey: ccKey.length > 0 ? ccKey : null });
      setSettings(next);
      setCcKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    try {
      setTestLoading(true);
      setTestResult("");
      const result = await testCcConnection();
      setTestResult(result.ok ? `连接成功：${result.model} 返回 ${result.content}` : `连接失败：${result.content ?? result.error ?? "unknown"}`);
    } catch (e) {
      setTestResult(`连接失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestLoading(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">加载配置中...</div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">配置</h2>
        <p className="text-sm text-muted-foreground">FreeModel cc 中转固定使用 https://cc.freemodel.dev，只需要配置上游 API Key。</p>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">运行状态</h3>
            <p className="text-sm text-muted-foreground mt-1">显示当前客户端鉴权和 cc 上游 Key 配置状态。</p>
          </div>
          <button onClick={() => void load()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60">刷新</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-secondary/20 p-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">PROXY_API_KEY</span>
            <StatusBadge ok={!!status?.providers.proxyKey} okText="已启用" badText="未设置" />
          </div>
          <div className="rounded-md border border-border bg-secondary/20 p-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">cc 上游 API Key</span>
            <StatusBadge ok={!!settings?.ccUpstreamApiKeySet} okText="已配置" badText="未配置" />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">管理门户 / 客户端访问 Key</h3>
          <p className="text-sm text-muted-foreground mt-1">如果服务端设置了 PROXY_API_KEY，请在这里填同一个 Key，用于访问管理 API 和 /v1 接口。</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={clientKey}
            onChange={(e) => setClientKeyState(e.target.value)}
            placeholder="PROXY_API_KEY"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button onClick={() => void saveClientKey()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">保存并验证</button>
        </div>
        {keyValid !== null && <p className={`text-sm ${keyValid ? "text-green-400" : "text-red-400"}`}>{keyValid ? "访问 Key 可用" : "访问 Key 无效"}</p>}
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">cc 上游 API Key</h3>
          <p className="text-sm text-muted-foreground mt-1">该 Key 仅保存在服务端，不会在管理页回显明文。留空保存会清除已保存的上游 Key。</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={ccKey}
            onChange={(e) => setCcKey(e.target.value)}
            placeholder={settings?.ccUpstreamApiKeySet ? "已配置；输入新 Key 可覆盖，留空可清除" : "fe_oa_..."}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button disabled={saving} onClick={() => void saveCcKey()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {saving ? "保存中..." : "保存"}
          </button>
          <button disabled={testLoading || !settings?.ccUpstreamApiKeySet} onClick={() => void runTest()} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary/60 disabled:opacity-60">
            {testLoading ? "测试中..." : "连接测试"}
          </button>
        </div>
        {saved && <p className="text-sm text-green-400">已保存</p>}
        {testResult && <p className={`text-sm ${testResult.startsWith("连接成功") ? "text-green-400" : "text-red-400"}`}>{testResult}</p>}
      </section>
    </div>
  );
}
