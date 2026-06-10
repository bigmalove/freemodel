import { FREEMODEL_BASE_URL } from "../lib/freemodelModels.js";
import {
  resolveCcUpstreamKey,
  markCcUpstreamKeyFailure,
} from "../lib/ccUpstreamKeys.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
} from "../types.js";

const UPSTREAM_URL = `${FREEMODEL_BASE_URL}/v1/chat/completions`;

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

async function* parseOpenAIStream(
  response: Response,
  requestModel: string,
): AsyncIterable<StreamChunk> {
  if (!response.body) throw new Error("freemodel upstream stream error: response body is null");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const chunk = JSON.parse(raw) as StreamChunk;
          chunk.model = requestModel;
          yield chunk;
        } catch {
          // skip malformed lines
        }
      }
    }

    buffer += decoder.decode();
    for (const line of buffer.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const chunk = JSON.parse(raw) as StreamChunk;
        chunk.model = requestModel;
        yield chunk;
      } catch {
        // skip malformed lines
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function callFreemodelOpenai(
  request: ChatCompletionRequest,
): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
  const selection = resolveCcUpstreamKey();
  const body = { ...request };

  const response = await fetch(UPSTREAM_URL, {
    method: "POST",
    headers: buildHeaders(selection.apiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    markCcUpstreamKeyFailure({
      selection,
      responseStatus: response.status,
      responseBody: text,
    });
    throw new Error(`freemodel upstream error ${response.status}: ${text}`);
  }

  if (request.stream) {
    return parseOpenAIStream(response, request.model);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  data.model = request.model;
  return data;
}
