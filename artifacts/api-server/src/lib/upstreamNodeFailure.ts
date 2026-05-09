import { disableUpstreamNode } from "./settings.js";
import { logger } from "./logger.js";
import type { ProviderEndpoint } from "./providerEndpoint.js";

interface NodeDisableSignal {
  provider: string;
  reason: string;
  upstreamStatus?: number;
  message: string;
}

function parseNodeDisableSignal(status: number, body: string): NodeDisableSignal | null {
  if (status !== 502 && status !== 401) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const error = (parsed as {
    error?: {
      type?: unknown;
      provider?: unknown;
      reason?: unknown;
      upstreamStatus?: unknown;
      disabledCandidate?: unknown;
      retryable?: unknown;
      message?: unknown;
    };
  }).error;

  if (!error) return null;

  if (
    error.type !== "upstream_node_unavailable" ||
    error.disabledCandidate !== true ||
    error.retryable !== false
  ) {
    return null;
  }

  return {
    provider: typeof error.provider === "string" ? error.provider : "unknown",
    reason: typeof error.reason === "string" ? error.reason : "unknown",
    upstreamStatus: typeof error.upstreamStatus === "number" ? error.upstreamStatus : undefined,
    message: typeof error.message === "string" ? error.message : "",
  };
}

export function maybeDisableSelectedNode(args: {
  endpoint: ProviderEndpoint;
  responseStatus: number;
  responseBody: string;
}): void {
  const { endpoint, responseStatus, responseBody } = args;

  if (endpoint.source !== "upstream") return;
  if (!endpoint.nodeUrl) return;

  // Replit hosting shutdown page: the upstream node ran out of credits or was
  // taken offline. The response is an HTML page containing a Replit hosting link.
  // This can arrive on any 2xx/4xx/5xx status, so check body first.
  if (responseBody.includes("replit.com/site/hosting")) {
    logger.warn(
      {
        nodeUrl: endpoint.nodeUrl,
        upstreamStatus: responseStatus,
        message: "Replit hosting shutdown page detected",
      },
      "upstream node returned Replit shutdown page — removing node from pool",
    );
    disableUpstreamNode({
      url: endpoint.nodeUrl,
      disabledReason: "upstream-node-unavailable",
      upstreamReason: "replit-hosting-shutdown",
      upstreamStatus: responseStatus,
      lastError: "Replit hosting shutdown page returned (node likely out of credits)",
    });
    return;
  }

  // A raw 403 from the upstream reverse proxy means access is forbidden.
  // Try to extract a specific error code from the JSON body (e.g.
  // FREE_TIER_BUDGET_EXCEEDED); fall back to generic "forbidden".
  if (responseStatus === 403) {
    let upstreamReason = "forbidden";
    let lastError = responseBody.slice(0, 300);
    try {
      const parsed = JSON.parse(responseBody) as {
        error?: { code?: unknown; message?: unknown };
      };
      if (typeof parsed.error?.code === "string" && parsed.error.code) {
        upstreamReason = parsed.error.code;
      }
      if (typeof parsed.error?.message === "string" && parsed.error.message) {
        lastError = parsed.error.message.slice(0, 300);
      }
    } catch {
      // body is not JSON — keep defaults
    }
    logger.warn(
      {
        nodeUrl: endpoint.nodeUrl,
        upstreamStatus: 403,
        upstreamReason,
        message: lastError,
      },
      "upstream node returned 403 Forbidden — removing node from pool",
    );
    disableUpstreamNode({
      url: endpoint.nodeUrl,
      disabledReason: "upstream-node-unavailable",
      upstreamReason,
      upstreamStatus: 403,
      lastError,
    });
    return;
  }

  const signal = parseNodeDisableSignal(responseStatus, responseBody);
  if (!signal) return;

  logger.warn(
    {
      nodeUrl: endpoint.nodeUrl,
      provider: signal.provider,
      reason: signal.reason,
      upstreamStatus: signal.upstreamStatus,
      message: signal.message,
    },
    "upstream node disable signal received — removing node from pool",
  );

  disableUpstreamNode({
    url: endpoint.nodeUrl,
    disabledReason: "upstream-node-unavailable",
    provider: signal.provider,
    upstreamReason: signal.reason,
    upstreamStatus: signal.upstreamStatus,
    lastError: signal.message,
  });
}
