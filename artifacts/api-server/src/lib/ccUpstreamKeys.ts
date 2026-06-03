import {
  disableCcUpstreamKey,
  getSettings,
  type CcUpstreamKeyEntry,
} from "./settings.js";
import { logger } from "./logger.js";

const COOLDOWN_DURATION_MS = 60_000;

let rrCursor = 0;
const keyCooldowns = new Map<string, number>();

export interface CcUpstreamKeySelection {
  id: string;
  apiKey: string;
  source: "settings" | "legacy-settings" | "env";
  upstreamIndex?: number;
  poolSize?: number;
}

export function setCcKeyCooldown(id: string, durationMs = COOLDOWN_DURATION_MS): void {
  keyCooldowns.set(id, Date.now() + durationMs);
}

export function isCcKeyCoolingDown(id: string): boolean {
  const expiry = keyCooldowns.get(id);
  if (expiry === undefined) return false;
  if (Date.now() >= expiry) {
    keyCooldowns.delete(id);
    return false;
  }
  return true;
}

export function getActiveCcKeyCooldowns(): Record<string, number> {
  const now = Date.now();
  const result: Record<string, number> = {};
  for (const [id, expiry] of keyCooldowns) {
    const remaining = expiry - now;
    if (remaining > 0) {
      result[id] = remaining;
    } else {
      keyCooldowns.delete(id);
    }
  }
  return result;
}

function pickCcKeyIndex(pool: CcUpstreamKeyEntry[], mode: "round-robin" | "sticky"): number {
  if (pool.length === 0) return -1;

  const now = Date.now();
  const available: number[] = [];
  for (let i = 0; i < pool.length; i++) {
    const expiry = keyCooldowns.get(pool[i]!.id);
    if (expiry === undefined || now >= expiry) {
      if (expiry !== undefined) keyCooldowns.delete(pool[i]!.id);
      available.push(i);
    }
  }
  const candidates = available.length > 0 ? available : pool.map((_, i) => i);

  if (mode === "sticky") return candidates[0]!;

  const pick = candidates[rrCursor % candidates.length]!;
  rrCursor = (rrCursor + 1) % Number.MAX_SAFE_INTEGER;
  return pick;
}

export function peekNextCcKeyIndex(): number | null {
  const settings = getSettings();
  if (!settings.reverseProxyEnabled || settings.ccUpstreamKeyPool.length === 0) return null;
  if (settings.reverseProxyMode === "sticky") return 0;
  return rrCursor % settings.ccUpstreamKeyPool.length;
}

export function isCcUpstreamConfigured(): boolean {
  const settings = getSettings();
  return (
    (settings.reverseProxyEnabled && settings.ccUpstreamKeyPool.length > 0) ||
    !!settings.ccUpstreamApiKey.trim() ||
    !!process.env["CC_UPSTREAM_API_KEY"]?.trim()
  );
}

export function resolveCcUpstreamKey(): CcUpstreamKeySelection {
  const settings = getSettings();
  if (settings.reverseProxyEnabled && settings.ccUpstreamKeyPool.length > 0) {
    const idx = pickCcKeyIndex(settings.ccUpstreamKeyPool, settings.reverseProxyMode);
    if (idx >= 0) {
      const entry = settings.ccUpstreamKeyPool[idx]!;
      logger.info(
        { mode: settings.reverseProxyMode, upstreamIndex: idx, poolSize: settings.ccUpstreamKeyPool.length, keyId: entry.id },
        "cc upstream key pool pick",
      );
      return {
        id: entry.id,
        apiKey: entry.apiKey,
        source: "settings",
        upstreamIndex: idx,
        poolSize: settings.ccUpstreamKeyPool.length,
      };
    }
  }

  const legacy = settings.ccUpstreamApiKey.trim();
  if (legacy) return { id: "legacy-settings", apiKey: legacy, source: "legacy-settings" };

  const envKey = process.env["CC_UPSTREAM_API_KEY"]?.trim();
  if (envKey) return { id: "env", apiKey: envKey, source: "env" };

  throw new Error("cc upstream API key is not configured. Add at least one key in the admin portal or set CC_UPSTREAM_API_KEY.");
}

function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

export function markCcUpstreamKeyFailure(args: {
  selection: CcUpstreamKeySelection;
  responseStatus: number;
  responseBody: string;
}): void {
  const { selection, responseStatus, responseBody } = args;
  if (selection.source !== "settings") return;

  if (responseStatus === 429) {
    setCcKeyCooldown(selection.id);
    logger.warn({ keyId: selection.id, upstreamStatus: responseStatus }, "cc upstream key cooldown");
    return;
  }

  if (responseStatus === 401 || responseStatus === 403) {
    disableCcUpstreamKey({
      id: selection.id,
      upstreamStatus: responseStatus,
      lastError: redactSecret(responseBody, selection.apiKey).slice(0, 500),
    });
    logger.warn({ keyId: selection.id, upstreamStatus: responseStatus }, "cc upstream key disabled");
  }
}

export function _resetCcRoundRobinCursor(): void {
  rrCursor = 0;
}
