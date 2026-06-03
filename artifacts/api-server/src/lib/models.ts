import { readJsonAsync, writeJson } from "./persist.js";
import {
  CC_CLAUDE_CODE_BASE_URL,
  CC_CLAUDE_CODE_PROVIDER,
  DEFAULT_CC_RAW_MODELS,
  expandCcModels,
  type CcClaudeCodeProvider,
  type CcModelEntry,
  type CcRawModel,
} from "./ccClaudeCodeModels.js";

export type Provider = CcClaudeCodeProvider;

export interface ModelEntry {
  id: string;
  provider: Provider;
  created: number;
}

let _rawCcModels: CcRawModel[] = [...DEFAULT_CC_RAW_MODELS];
let _modelRegistry: ModelEntry[] = expandCcModels(_rawCcModels);
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

interface CcModelsResponse {
  object?: string;
  data?: Array<{
    id?: string;
    created?: number;
    owned_by?: string;
  }>;
}

export function getDefaultModel(): string {
  return DEFAULT_MODEL;
}

export function resolveProvider(modelId: string): Provider | null {
  const entry = _modelRegistry.find((m) => m.id === modelId);
  return entry ? entry.provider : null;
}

export async function refreshCcModels(apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!key) return;

  const response = await fetch(`${CC_CLAUDE_CODE_BASE_URL}/v1/models`, {
    headers: {
      Accept: "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`cc model list error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as CcModelsResponse;
  const raw = (data.data ?? [])
    .filter((m): m is { id: string; created?: number; owned_by?: string } => typeof m.id === "string" && m.id.length > 0)
    .map((m) => ({ id: m.id, created: m.created, owned_by: m.owned_by }));

  if (raw.length > 0) {
    _rawCcModels = raw;
    _modelRegistry = expandCcModels(_rawCcModels);
  }
}

export function getRawCcModels(): CcRawModel[] {
  return [..._rawCcModels];
}

export const MODEL_REGISTRY: ModelEntry[] = _modelRegistry;

let _disabledModels: Set<string> | null = null;

export async function initModels(): Promise<void> {
  const arr = await readJsonAsync<string[]>("disabled_models.json", []);
  _disabledModels = new Set(arr);
}

function loadDisabledModels(): Set<string> {
  if (_disabledModels === null) {
    _disabledModels = new Set();
  }
  return _disabledModels;
}

export function getDisabledModels(): string[] {
  return Array.from(loadDisabledModels());
}

export function isModelDisabled(id: string): boolean {
  return loadDisabledModels().has(id);
}

export function setDisabledModels(ids: string[]): void {
  _disabledModels = new Set(ids);
  writeJson("disabled_models.json", ids);
}

export function patchModelDisabled(id: string, disabled: boolean): void {
  const set = loadDisabledModels();
  if (disabled) {
    set.add(id);
  } else {
    set.delete(id);
  }
  _disabledModels = set;
  writeJson("disabled_models.json", Array.from(set));
}

export function getEnabledModels(): ModelEntry[] {
  const disabled = loadDisabledModels();
  return _modelRegistry.filter((m) => !disabled.has(m.id));
}

export function getAllModelsWithStatus(): Array<ModelEntry & { disabled: boolean }> {
  const disabled = loadDisabledModels();
  return _modelRegistry.map((m) => ({ ...m, disabled: disabled.has(m.id) }));
}

export { CC_CLAUDE_CODE_PROVIDER };
