export default function DocsPage() {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "<your-gateway-url>";

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">API 文档</h2>
        <p className="text-sm text-muted-foreground">本服务对外提供 OpenAI 兼容接口，内部固定转发到 cc.freemodel.dev 的 Claude Code 线路。</p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h3 className="text-base font-semibold text-foreground">身份认证</h3>
        <p className="text-sm text-muted-foreground">若服务端设置了 PROXY_API_KEY，所有 /v1/* 请求都需要携带访问 Key。</p>
        <pre className="rounded-md bg-secondary/40 p-3 text-xs text-foreground overflow-x-auto">{`Authorization: Bearer <PROXY_API_KEY>
# 或
x-api-key: <PROXY_API_KEY>`}</pre>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <span className="rounded px-2 py-0.5 text-xs font-mono font-bold bg-blue-500/10 text-blue-400">GET</span>
          <code className="text-sm font-mono text-foreground">/v1/models</code>
        </div>
        <p className="text-sm text-muted-foreground">返回已启用的 cc Claude 模型，包含原始模型和 reapi 风格 thinking 变种。</p>
        <pre className="rounded-md bg-secondary/40 p-3 text-xs text-foreground overflow-x-auto">{`curl ${baseUrl}/v1/models \
  -H "Authorization: Bearer <PROXY_API_KEY>"`}</pre>
        <pre className="rounded-md bg-secondary/40 p-3 text-xs text-foreground overflow-x-auto">{`{
  "object": "list",
  "data": [
    { "id": "claude-haiku-4-5-20251001", "object": "model", "owned_by": "cc-claude-code" },
    { "id": "claude-haiku-4-5-20251001-thinking-high", "object": "model", "owned_by": "cc-claude-code" }
  ]
}`}</pre>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <span className="rounded px-2 py-0.5 text-xs font-mono font-bold bg-green-500/10 text-green-400">POST</span>
          <code className="text-sm font-mono text-foreground">/v1/chat/completions</code>
        </div>
        <p className="text-sm text-muted-foreground">接收 OpenAI Chat Completions 请求。原始模型隐藏 thinking；所有 -thinking* 变种会以 &lt;antml_thinking&gt; 包裹 thinking 内容。</p>
        <pre className="rounded-md bg-secondary/40 p-3 text-xs text-foreground overflow-x-auto">{`curl ${baseUrl}/v1/chat/completions \
  -H "Authorization: Bearer <PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-haiku-4-5-20251001",
    "messages": [{ "role": "user", "content": "Reply with exactly: pong" }]
  }'`}</pre>
        <pre className="rounded-md bg-secondary/40 p-3 text-xs text-foreground overflow-x-auto">{`curl ${baseUrl}/v1/chat/completions \
  -H "Authorization: Bearer <PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-8-thinking-xhigh",
    "messages": [{ "role": "user", "content": "解释一下这个问题" }],
    "stream": true
  }'`}</pre>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h3 className="text-base font-semibold text-foreground">OpenAI Python SDK 示例</h3>
        <pre className="rounded-md bg-secondary/40 p-3 text-xs text-foreground overflow-x-auto">{`from openai import OpenAI

client = OpenAI(
    api_key="<PROXY_API_KEY>",
    base_url="${baseUrl}/v1"
)

response = client.chat.completions.create(
    model="claude-haiku-4-5-20251001",
    messages=[{"role": "user", "content": "你好"}]
)
print(response.choices[0].message.content)`}</pre>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h3 className="text-base font-semibold text-foreground">接口列表</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {[
                ["GET", "/healthz", "健康检查"],
                ["GET", "/api/setup-status", "配置状态"],
                ["GET", "/api/settings", "获取设置"],
                ["POST", "/api/settings", "保存 cc 上游 API Key"],
                ["POST", "/api/cc/test", "连接测试"],
                ["GET", "/v1/models", "列出模型"],
                ["POST", "/v1/chat/completions", "对话补全"],
                ["GET", "/v1/admin/models", "模型管理"],
                ["PATCH", "/v1/admin/models", "启用/禁用模型"],
              ].map(([method, path, desc]) => (
                <tr key={method + path}>
                  <td className="py-2 pr-4"><span className="inline-block rounded px-1.5 py-0.5 text-xs font-mono font-bold bg-secondary text-foreground">{method}</span></td>
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">{path}</td>
                  <td className="py-2 text-xs text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
