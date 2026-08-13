/* mcp-lite — a minimal MCP-over-HTTP client for the courier.
 *
 * The official @modelcontextprotocol/sdk StreamableHTTP transport fails
 * cross-origin in iPad Safari ("TypeError: Load failed") — it reads the response
 * via a streaming ReadableStream reader and opens a separate long-lived SSE GET,
 * neither of which survives cross-origin there. A plain POST that reads the WHOLE
 * body once (res.text()) and never opens a side channel works — proven by the
 * courier's own reachability probe returning HTTP 200 on the same endpoint.
 *
 * The courier only needs request/response tool calls, so that's all this does:
 * initialize once (capturing mcp-session-id), then tools/call. Responses come
 * back either as SSE (`event: message\ndata: {json}`) or plain JSON; both parse.
 */

const MCP_URL = "https://roastify.tollbooth-dpyc.com/mcp";
const TIMEOUT_MS = 90_000;

let sessionId = "";
let idc = 1;

interface Rpc {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { message?: string };
}

async function post(body: unknown): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseBody(text: string): Rpc | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try { return JSON.parse(t) as Rpc; } catch { return null; }
  }
  // SSE frames: use the last `data:` line (the response event).
  const data = t.split(/\r?\n/).filter((l) => l.startsWith("data:"));
  const last = data[data.length - 1];
  if (!last) return null;
  try { return JSON.parse(last.slice(5).trim()) as Rpc; } catch { return null; }
}

async function rpc(method: string, params: unknown): Promise<Rpc["result"]> {
  const res = await post({ jsonrpc: "2.0", id: idc++, method, params });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  const parsed = parseBody(await res.text());
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
  if (!parsed) throw new Error("MCP returned an empty response");
  if (parsed.error) throw new Error(parsed.error.message || "MCP error");
  return parsed.result;
}

async function ensureSession(): Promise<void> {
  if (sessionId) return;
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "roastify-courier", version: "1" },
  });
  // Fire-and-forget the initialized notification; not fatal if it fails.
  try { await post({ jsonrpc: "2.0", method: "notifications/initialized" }); } catch { /* noop */ }
}

/** Call a roastify_* tool and return its structured payload, like the Bench does. */
async function callMcp(toolName: string, args: Record<string, unknown>): Promise<any> {
  await ensureSession();
  const result = await rpc("tools/call", { name: `roastify_${toolName}`, arguments: args });
  const blocks = result?.content ?? [];
  const textBlock = blocks.find((b) => b.type === "text");
  const payload =
    result?.structuredContent !== undefined
      ? result.structuredContent
      : textBlock?.text !== undefined
        ? (() => { try { return JSON.parse(textBlock.text as string); } catch { return textBlock.text; } })()
        : result;
  if (result?.isError) {
    const msg = typeof payload === "string" ? payload : ((payload as Rec)?.error as string) || "tool error";
    throw new Error(String(msg));
  }
  return payload;
}

type Rec = Record<string, unknown>;

// Courier login is separate from the Bench (different origin, own localStorage).
const NPUB_KEY = "rcourier:npub:v1";
const PROOF_KEY = "rcourier:proof:v1";

export const store = {
  npub: (): string => localStorage.getItem(NPUB_KEY) || "",
  setNpub: (v: string): void => localStorage.setItem(NPUB_KEY, v),
  proof: (): string => localStorage.getItem(PROOF_KEY) || "",
  setProof: (v: string): void => localStorage.setItem(PROOF_KEY, v),
};

export interface ProofResult { dpop_token?: string; error?: string }
export interface StoredDesignMeta {
  design_id: string; label: string; product_id: string; source_title: string;
  bytes: number; updated_at?: string;
}

// The small set of calls the courier makes. Authed calls carry the stored
// npub + dpop_token, exactly as the Bench's callTool injects them.
export const api = {
  requestProof: (npub: string, verifyAt: string, reason: string) =>
    callMcp("request_npub_proof", { patron_npub: npub, verify_at: verifyAt, reason }) as Promise<ProofResult>,
  receiveProof: (npub: string, dpop: string) =>
    callMcp("receive_npub_proof", { patron_npub: npub, dpop_token: dpop }) as Promise<ProofResult>,
  list: () =>
    callMcp("list_designs", { npub: store.npub(), dpop_token: store.proof() }) as
      Promise<{ success: boolean; designs?: StoredDesignMeta[]; error?: string }>,
  stash: (design: Rec, o: { label?: string; productId?: string; sourceTitle?: string; designId?: string }) =>
    callMcp("stash_design", {
      design, label: o.label ?? "", product_id: o.productId ?? "", source_title: o.sourceTitle ?? "",
      design_id: o.designId ?? "", npub: store.npub(), dpop_token: store.proof(),
    }) as Promise<{ success: boolean; assets?: number; error?: string }>,
  fetch: (designId: string) =>
    callMcp("fetch_design", { design_id: designId, npub: store.npub(), dpop_token: store.proof() }) as
      Promise<{ success: boolean; design?: Rec; error?: string }>,
  del: (designId: string) =>
    callMcp("delete_design", { design_id: designId, npub: store.npub(), dpop_token: store.proof() }) as
      Promise<{ success: boolean; deleted?: boolean; error?: string }>,
};
