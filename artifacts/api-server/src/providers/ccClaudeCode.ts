import { randomUUID } from "node:crypto";
import { markCcUpstreamKeyFailure, resolveCcUpstreamKey } from "../lib/ccUpstreamKeys.js";
import {
  CC_CLAUDE_CODE_BASE_URL,
  buildThinkingPayload,
  parseCcModel,
} from "../lib/ccClaudeCodeModels.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ContentPart,
  Message,
  StreamChunk,
  Tool,
  ToolCall,
} from "../types.js";

const UPSTREAM_MESSAGES_URL = `${CC_CLAUDE_CODE_BASE_URL}/v1/messages?beta=true`;
const CLAUDE_CODE_VERSION = "2.1.146";
const STAINLESS_PACKAGE_VERSION = "0.94.0";
const DEVICE_ID = "0907c69b1b9ca6a3c23e23622bab14c8d51b149385afc309bb6dc8bfabc00e23";
const UPSTREAM_MAX_TOKENS = 32000;

interface AnthropicContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking";
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
  thinking?: string;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  cache_control?: { type: "ephemeral" };
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  content_block?: {
    type: string;
    id?: string;
    name?: string;
    text?: string;
    thinking?: string;
  };
  message?: {
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface ParsedOpenAIMessages {
  systemTexts: string[];
  messages: AnthropicMessage[];
}

interface StreamState {
  text: string;
  finishReason: string | null;
  promptTokens: number;
  completionTokens: number;
}

function textFromContent(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: ContentPart) => {
      if (part.type === "text") return part.text ?? "";
      if (part.type === "image_url") return `[image: ${part.image_url?.url ?? ""}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function convertMessages(messages: Message[]): ParsedOpenAIMessages {
  const systemTexts: string[] = [];
  const out: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      const text = textFromContent(message.content).trim();
      if (text) systemTexts.push(text);
      continue;
    }

    if (message.role === "user") {
      out.push({
        role: "user",
        content: [{ type: "text", text: textFromContent(message.content), cache_control: { type: "ephemeral" } }],
      });
      continue;
    }

    if (message.role === "assistant") {
      if (message.tool_calls && message.tool_calls.length > 0) {
        const blocks: AnthropicContentBlock[] = [];
        const text = textFromContent(message.content);
        if (text) blocks.push({ type: "text", text });
        for (const toolCall of message.tool_calls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          } catch {
            input = {};
          }
          blocks.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input,
          });
        }
        out.push({ role: "assistant", content: blocks });
      } else {
        out.push({ role: "assistant", content: textFromContent(message.content) });
      }
      continue;
    }

    if (message.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.tool_call_id ?? "",
            content: textFromContent(message.content),
          },
        ],
      });
    }
  }

  return { systemTexts, messages: out };
}

function convertTools(tools: Tool[] | undefined): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters ?? { type: "object", properties: {} },
  }));
}

function currentDateText(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildSystemBlocks(systemTexts: string[]): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [
    {
      type: "text",
      text: `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.92a; cc_entrypoint=sdk-cli; cch=f0c9d;`,
    },
    {
      type: "text",
      text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `CWD: ${process.cwd()}\nDate: ${currentDateText()}`,
      cache_control: { type: "ephemeral" },
    },
  ];

  for (const text of systemTexts) {
    blocks.push({ type: "text", text, cache_control: { type: "ephemeral" } });
  }

  return blocks;
}

function buildHeaders(apiKey: string, sessionId: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": `claude-cli/${CLAUDE_CODE_VERSION} (external, sdk-cli)`,
    "X-Claude-Code-Session-Id": sessionId,
    "X-Stainless-Arch": process.arch === "x64" ? "x64" : process.arch,
    "X-Stainless-Lang": "js",
    "X-Stainless-OS": process.platform === "win32" ? "Windows" : process.platform,
    "X-Stainless-Package-Version": STAINLESS_PACKAGE_VERSION,
    "X-Stainless-Retry-Count": "0",
    "X-Stainless-Runtime": "node",
    "X-Stainless-Runtime-Version": process.version,
    "X-Stainless-Timeout": "600",
    "anthropic-beta": "interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,claude-code-20250219",
    "anthropic-dangerous-direct-browser-access": "true",
    "anthropic-version": "2023-06-01",
    "x-api-key": apiKey,
    "x-app": "cli",
  };
}

function buildRequestBody(request: ChatCompletionRequest, sessionId: string): Record<string, unknown> {
  const parsedModel = parseCcModel(request.model);
  const { systemTexts, messages } = convertMessages(request.messages);
  const thinkingPayload = buildThinkingPayload(parsedModel);
  const tools = convertTools(request.tools);

  return {
    model: parsedModel.upstreamModel,
    messages,
    system: buildSystemBlocks(systemTexts),
    metadata: {
      user_id: JSON.stringify({ device_id: DEVICE_ID, account_uuid: "", session_id: sessionId }),
    },
    max_tokens: UPSTREAM_MAX_TOKENS,
    ...thinkingPayload,
    context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
    ...(tools ? { tools } : {}),
    stream: true,
  };
}

function mapStopReason(reason: string | undefined): string {
  if (reason === "tool_use") return "tool_calls";
  if (reason === "max_tokens") return "length";
  return "stop";
}

function convertAnthropicEventToChunk(
  event: AnthropicStreamEvent,
  id: string,
  created: number,
  requestModel: string,
  visibleThinking: boolean,
  toolUseBlocks: Map<number, { id: string; name: string; inputJson: string }>,
  thinkingBlocks: Set<number>,
  state: StreamState,
): StreamChunk | null {
  const base = { id, object: "chat.completion.chunk" as const, created, model: requestModel };

  if (event.type === "message_start") {
    state.promptTokens = event.message?.usage?.input_tokens ?? state.promptTokens;
    state.completionTokens = event.message?.usage?.output_tokens ?? state.completionTokens;
    return null;
  }

  if (event.type === "content_block_start") {
    const block = event.content_block;
    const index = event.index ?? 0;

    if (block?.type === "thinking") {
      thinkingBlocks.add(index);
      if (!visibleThinking) return null;
      const content = "<antml_thinking>\n";
      state.text += content;
      return { ...base, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] };
    }

    if (block?.type === "text") {
      return { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] };
    }

    if (block?.type === "tool_use") {
      toolUseBlocks.set(index, { id: block.id ?? `tool_${index}`, name: block.name ?? "", inputJson: "" });
      return {
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index,
                  id: block.id ?? `tool_${index}`,
                  type: "function",
                  function: { name: block.name ?? "", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
    }
  }

  if (event.type === "content_block_delta") {
    const delta = event.delta;
    const index = event.index ?? 0;

    if (delta?.type === "thinking_delta" && delta.thinking) {
      if (!visibleThinking) return null;
      state.text += delta.thinking;
      return { ...base, choices: [{ index: 0, delta: { content: delta.thinking }, finish_reason: null }] };
    }

    if (delta?.type === "text_delta" && delta.text) {
      state.text += delta.text;
      return { ...base, choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }] };
    }

    if (delta?.type === "input_json_delta" && delta.partial_json !== undefined) {
      const block = toolUseBlocks.get(index);
      if (!block) return null;
      block.inputJson += delta.partial_json;
      return {
        ...base,
        choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: delta.partial_json } }] }, finish_reason: null }],
      };
    }
  }

  if (event.type === "content_block_stop") {
    const index = event.index ?? 0;
    if (thinkingBlocks.has(index)) {
      thinkingBlocks.delete(index);
      if (!visibleThinking) return null;
      const content = "\n</antml_thinking>\n\n";
      state.text += content;
      return { ...base, choices: [{ index: 0, delta: { content }, finish_reason: null }] };
    }
  }

  if (event.type === "message_delta") {
    state.completionTokens = event.usage?.output_tokens ?? state.completionTokens;
    const stopReason = event.delta?.stop_reason;
    if (stopReason) {
      const finishReason = mapStopReason(stopReason);
      state.finishReason = finishReason;
      return { ...base, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] };
    }
  }

  return null;
}

async function* parseCcClaudeCodeStream(
  response: Response,
  requestModel: string,
  visibleThinking: boolean,
  state: StreamState,
): AsyncIterable<StreamChunk> {
  if (!response.body) throw new Error("cc upstream stream error: response body is null");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const id = `chatcmpl-cc-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const toolUseBlocks = new Map<number, { id: string; name: string; inputJson: string }>();
  const thinkingBlocks = new Set<number>();

  function processLine(line: string): StreamChunk | null {
    if (!line.startsWith("data:")) return null;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") return null;
    try {
      const event = JSON.parse(raw) as AnthropicStreamEvent;
      return convertAnthropicEventToChunk(event, id, created, requestModel, visibleThinking, toolUseBlocks, thinkingBlocks, state);
    } catch {
      return null;
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const chunk = processLine(line);
        if (chunk) yield chunk;
      }
    }

    buffer += decoder.decode();
    for (const line of buffer.split(/\r?\n/)) {
      const chunk = processLine(line);
      if (chunk) yield chunk;
    }
  } finally {
    reader.releaseLock();
  }
}

function buildNonStreamResponse(requestModel: string, state: StreamState): ChatCompletionResponse {
  const promptTokens = state.promptTokens;
  const completionTokens = state.completionTokens;
  return {
    id: `chatcmpl-cc-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestModel,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: state.text || null },
        finish_reason: state.finishReason ?? "stop",
      },
    ],
    usage: promptTokens || completionTokens
      ? {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        }
      : undefined,
  };
}

function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

export async function callCcClaudeCode(
  request: ChatCompletionRequest,
): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
  const selection = resolveCcUpstreamKey();
  const sessionId = randomUUID();
  const parsedModel = parseCcModel(request.model);
  const response = await fetch(UPSTREAM_MESSAGES_URL, {
    method: "POST",
    headers: buildHeaders(selection.apiKey, sessionId),
    body: JSON.stringify(buildRequestBody(request, sessionId)),
  });

  if (!response.ok) {
    const text = await response.text();
    markCcUpstreamKeyFailure({ selection, responseStatus: response.status, responseBody: text });
    throw new Error(`cc upstream error ${response.status}: ${redactSecret(text, selection.apiKey)}`);
  }

  const state: StreamState = { text: "", finishReason: null, promptTokens: 0, completionTokens: 0 };
  const stream = parseCcClaudeCodeStream(response, request.model, parsedModel.visibleThinking, state);

  if (request.stream) return stream;

  for await (const _chunk of stream) {
    // Consuming the stream updates state through parseCcClaudeCodeStream.
  }
  return buildNonStreamResponse(request.model, state);
}
