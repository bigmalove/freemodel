export const CC_CLAUDE_CODE_BASE_URL = "https://cc.freemodel.dev";
export const CC_CLAUDE_CODE_PROVIDER = "cc-claude-code" as const;

export type CcClaudeCodeProvider = typeof CC_CLAUDE_CODE_PROVIDER;
export type ThinkingLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface CcRawModel {
  id: string;
  created?: number;
  owned_by?: string;
}

export interface CcModelEntry {
  id: string;
  provider: CcClaudeCodeProvider;
  created: number;
}

export interface ParsedCcModel {
  requestedModel: string;
  upstreamModel: string;
  visibleThinking: boolean;
  level: ThinkingLevel;
  suffix: string | null;
}

export interface CcThinkingPayload {
  thinking: { type: "adaptive" } | { type: "enabled"; budget_tokens: number };
  output_config?: { effort: ThinkingLevel };
}

export const DEFAULT_CC_RAW_MODELS: CcRawModel[] = [
  { id: "claude-fable-5", created: 1626777600, owned_by: "anthropic" },
  { id: "claude-opus-4-8", created: 1626777600, owned_by: "anthropic" },
  { id: "claude-opus-4-7", created: 1626777600, owned_by: "anthropic" },
  { id: "claude-sonnet-4-6", created: 1626777600, owned_by: "anthropic" },
  { id: "claude-opus-4-6", created: 1626777600, owned_by: "anthropic" },
  { id: "claude-haiku-4-5-20251001", created: 1626777600, owned_by: "anthropic" },
];

const THINKING_VARIANT_SUFFIXES = [
  "-thinking",
  "-thinking-visible",
  "-thinking-low",
  "-thinking-medium",
  "-thinking-high",
  "-thinking-xhigh",
  "-thinking-max",
] as const;

export function expandCcModels(rawModels: CcRawModel[]): CcModelEntry[] {
  const out: CcModelEntry[] = [];
  const seen = new Set<string>();

  for (const raw of rawModels) {
    const id = raw.id.trim();
    if (!id || seen.has(id)) continue;
    const created = raw.created ?? 1626777600;
    const ids = [id, ...THINKING_VARIANT_SUFFIXES.map((suffix) => `${id}${suffix}`)];
    for (const modelId of ids) {
      if (seen.has(modelId)) continue;
      seen.add(modelId);
      out.push({ id: modelId, provider: CC_CLAUDE_CODE_PROVIDER, created });
    }
  }

  return out;
}

export function parseCcModel(model: string): ParsedCcModel {
  let upstreamModel = model;
  let visibleThinking = false;
  let level: ThinkingLevel = "low";
  let suffix: string | null = null;

  const effortMatch = upstreamModel.match(/-thinking-(low|medium|high|xhigh|max)$/);
  if (effortMatch) {
    suffix = effortMatch[0];
    level = effortMatch[1] as ThinkingLevel;
    visibleThinking = true;
    upstreamModel = upstreamModel.slice(0, -suffix.length);
  } else if (upstreamModel.endsWith("-thinking-visible")) {
    suffix = "-thinking-visible";
    level = "high";
    visibleThinking = true;
    upstreamModel = upstreamModel.slice(0, -suffix.length);
  } else if (upstreamModel.endsWith("-thinking")) {
    suffix = "-thinking";
    level = "high";
    visibleThinking = true;
    upstreamModel = upstreamModel.slice(0, -suffix.length);
  }

  return { requestedModel: model, upstreamModel, visibleThinking, level, suffix };
}

export function isOpus47Or48(model: string): boolean {
  return /^claude-opus-4-[78](?:$|-)/.test(model);
}

export function usesAdaptiveThinking(model: string): boolean {
  return isOpus47Or48(model) || /^claude-(?:opus|sonnet)-4-6(?:$|-)/.test(model) || /^claude-fable-5(?:$|-)/.test(model);
}

export function normalizeEffortForModel(model: string, level: ThinkingLevel): ThinkingLevel {
  if (level === "xhigh" && !isOpus47Or48(model)) return "max";
  return level;
}

export function budgetTokensForLevel(level: ThinkingLevel): number {
  switch (level) {
    case "low":
      return 3000;
    case "medium":
      return 8000;
    case "high":
      return 14000;
    case "xhigh":
      return 20000;
    case "max":
      return 30400;
  }
}

export function buildThinkingPayload(parsed: ParsedCcModel): CcThinkingPayload {
  if (usesAdaptiveThinking(parsed.upstreamModel)) {
    return {
      thinking: { type: "adaptive" },
      output_config: { effort: normalizeEffortForModel(parsed.upstreamModel, parsed.level) },
    };
  }

  return {
    thinking: { type: "enabled", budget_tokens: budgetTokensForLevel(parsed.level) },
  };
}
