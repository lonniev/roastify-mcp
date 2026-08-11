/**
 * Roastify MCP client.
 *
 * Pattern modeled on optionality-mcp/frontend/src/lib/mcp.ts:
 *
 * 1. One singleton @modelcontextprotocol/sdk Client over the
 *    StreamableHTTPClientTransport. The SDK handles the initialize
 *    handshake, SSE session tracking, and reconnection.
 * 2. Auth = uniform npub-proof. Two tactics, transparent to callers:
 *      - session nsec in browser → fresh kind-27235 inline proof per call
 *        (signInlineProof), scoped to the runtime tool name.
 *      - npub + DM login → the poison-phrase proof_token the wheel cached
 *        at receive_npub_proof time, sent verbatim.
 * 3. Bootstrap/auth/balance tools are free and pre-login-safe.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { clearSessionNsec, hasSessionNsec, sessionNsecNpub } from "./sessionNsec";
import { debugPush } from "./debugLog";
import { signInlineProof } from "./inlineProof";

const SLUG = "roastify";

const _envUrl = (import.meta.env.VITE_MCP_URL as string | undefined) ?? "";
const MCP_URL = _envUrl.startsWith("/")
  ? `${window.location.origin}${_envUrl}`
  : _envUrl;

const NPUB_STORAGE_KEY = "roastify:patron_npub:v1";
const PROOF_STORAGE_KEY = "roastify:proof_token:v1";

let client: Client | null = null;
let connecting: Promise<void> | null = null;

function requireUrl(): string {
  if (!MCP_URL) {
    throw new Error("VITE_MCP_URL is not configured. Set it in .env (e.g. /mcp).");
  }
  return MCP_URL;
}

async function getClient(): Promise<Client> {
  if (client) return client;
  if (connecting) {
    await connecting;
    return client!;
  }
  connecting = (async () => {
    const url = requireUrl();
    const c = new Client({ name: "roastify-frontend", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await c.connect(transport);
    client = c;
    connecting = null;
  })();
  await connecting;
  return client!;
}

// ─── Stored identity ─────────────────────────────────────────────────────

export function getStoredNpub(): string {
  return window.localStorage.getItem(NPUB_STORAGE_KEY) ?? "";
}

export function setStoredNpub(npub: string): void {
  window.localStorage.setItem(NPUB_STORAGE_KEY, npub);
}

export function getStoredProof(): string {
  return window.localStorage.getItem(PROOF_STORAGE_KEY) ?? "";
}

export function setStoredProof(proof: string): void {
  window.localStorage.setItem(PROOF_STORAGE_KEY, proof);
}

// ─── Recent logins (skip the DM on return) ───────────────────────────────
// Ported from optionality-mcp's proven pattern: cache (npub, proof_token,
// expiresAt) tuples so a returning patron re-enters on the cached proof
// until the server-side cache actually expires.

const RECENT_LOGINS_KEY = "roastify:recent-logins:v1";
const MAX_RECENT_LOGINS = 5;

export interface RecentLogin {
  npub: string;
  proof: string;
  expiresAt: number; // unix ms
  lastUsed: number; // unix ms
}

function readRecentLogins(): RecentLogin[] {
  try {
    const raw = window.localStorage.getItem(RECENT_LOGINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentLogin =>
        typeof e === "object" && e !== null &&
        typeof e.npub === "string" && typeof e.proof === "string" &&
        typeof e.expiresAt === "number" && typeof e.lastUsed === "number",
    );
  } catch {
    return [];
  }
}

function writeRecentLogins(entries: RecentLogin[]): void {
  window.localStorage.setItem(RECENT_LOGINS_KEY, JSON.stringify(entries));
}

/// Unexpired recent logins, MRU-sorted. Prunes expired entries as a side effect.
export function getValidRecentLogins(): RecentLogin[] {
  const now = Date.now();
  const entries = readRecentLogins();
  const valid = entries.filter((e) => e.expiresAt > now);
  if (valid.length !== entries.length) writeRecentLogins(valid);
  valid.sort((a, b) => b.lastUsed - a.lastUsed);
  return valid;
}

/// Record (or refresh) a successful login. Derate the TTL by 30s so a
/// straggler can't serve an already-expired token to the next paid call.
export function recordRecentLogin(npub: string, proof: string, expiresInSec: number): void {
  const safeTtl = Math.max(0, expiresInSec - 30);
  const next: RecentLogin = {
    npub,
    proof,
    expiresAt: Date.now() + safeTtl * 1000,
    lastUsed: Date.now(),
  };
  const others = readRecentLogins().filter((e) => e.npub !== npub);
  writeRecentLogins(
    [next, ...others].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_RECENT_LOGINS),
  );
}

export function forgetRecentLogin(npub: string): void {
  writeRecentLogins(readRecentLogins().filter((e) => e.npub !== npub));
}

/// "Logged in" = we have the patron's npub AND a way to prove ownership:
/// either a cached DM proof_token, or a session nsec whose npub matches.
export function isLoggedIn(): boolean {
  const npub = getStoredNpub();
  if (!npub) return false;
  if (getStoredProof()) return true;
  if (hasSessionNsec() && sessionNsecNpub() === npub) return true;
  return false;
}

export function logOut(): void {
  window.localStorage.removeItem(NPUB_STORAGE_KEY);
  window.localStorage.removeItem(PROOF_STORAGE_KEY);
  try {
    clearSessionNsec();
  } catch {
    /* noop */
  }
}

/// Resolve the proof for a paid call: prefer a fresh inline proof signed
/// by the session nsec (if it matches the stored npub), else the cached
/// DM proof_token. Stale session-nsec entries (from a prior identity) are
/// evicted so they don't poison the call.
function getCachedProof(toolName: string): string {
  try {
    const currentNpub = getStoredNpub();
    const sessionNpub = hasSessionNsec() ? sessionNsecNpub() : null;
    if (sessionNpub && sessionNpub === currentNpub) {
      return signInlineProof(`${SLUG}_${toolName}`);
    }
    if (sessionNpub && sessionNpub !== currentNpub) {
      clearSessionNsec();
    }
  } catch {
    /* fall through to the cached poison token */
  }
  return getStoredProof();
}

// ─── callTool ────────────────────────────────────────────────────────────

interface ToolResultText {
  type: string;
  text?: string;
}

interface ToolResult {
  isError?: boolean;
  content?: ToolResultText[];
  structuredContent?: unknown;
}

/// Thrown when the server rejects a paid call because the proof expired or
/// was never sent. The gate catches this and bounces the user to sign-in.
export class ProofRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofRequiredError";
  }
}

// ─── Proof-expiry signal ───────────────────────────────────────────────────
// A paid call can bounce for an expired proof from anywhere (Posts, editor,
// wallet). `callTool` clears the stale token synchronously, but the React tree
// needs to KNOW so it can re-present sign-in — otherwise the user is stranded
// on a page whose data won't load, staring at a red banner. Any component
// (App) subscribes; the tool layer fires on every proof bounce.

type ProofExpiredListener = (message: string) => void;
const proofExpiredListeners = new Set<ProofExpiredListener>();

/// Subscribe to proof-expiry bounces. Returns an unsubscribe fn. App wires this
/// to drop the user back to the sign-in gate when the cached DM proof lapses.
export function onProofExpired(cb: ProofExpiredListener): () => void {
  proofExpiredListeners.add(cb);
  return () => proofExpiredListeners.delete(cb);
}

function emitProofExpired(message: string): void {
  for (const cb of proofExpiredListeners) {
    try {
      cb(message);
    } catch {
      /* a listener error must not swallow the throw that follows */
    }
  }
}

/// Tools whose wheel signature takes no npub/proof envelope. Pydantic
/// strict mode rejects unexpected kwargs, so we must NOT inject them here.
const BOOTSTRAP_TOOLS = new Set([
  "request_npub_proof",
  "receive_npub_proof",
  "service_status",
  // Takes an explicit patron_npub, no proof envelope (free readiness probe).
  "session_status",
  // Public kind-0 profile reads/relays — take explicit npub, no proof envelope.
  "get_nostr_profile",
  "publish_nostr_profile",
  // Free operator diagnostics — no npub/proof envelope (operator identity is
  // the process's own nsec; a patron calling these just sees empty/error).
  "get_operator_onboarding_status",
  "check_authority_balance",
  // Takes explicit patron_npub + dpop_token (the cached phrase), not the
  // injected envelope — same shape as receive_npub_proof.
  "check_proof_status",
  // Patron credential flow: explicit sender_npub / patron_npub + phrase, never
  // the injected envelope. Same shape as check_proof_status.
  "get_patron_onboarding_status",
  "request_patron_credentials",
  "receive_patron_credentials",
]);

/// Tools too noisy/background to clutter the debug log (polled liveness +
/// profile hydration). Everything else — posting, OAuth, posts, snippets,
/// credits — is logged so the panel shows what the FE is actually doing.
const QUIET_TOOLS = new Set([
  "service_status",
  "get_nostr_profile",
  // The scheduler-log poll feeds the debug panel its own synthesized entries;
  // logging the poll call itself would just be noise.
  "get_scheduler_log",
  // Background personalization hydration (the editor's @handle) — not noteworthy.
  "get_x_profile",
  // NOTE: `fetch_dynamic_block` (the claim-check poll for a resolving dynamic
  // block) is intentionally NOT quiet. Each poll's status (pending → done/error)
  // must be visible in the debug panel — otherwise a resolve looks like it never
  // calls back, and a silent poll failure (e.g. a proof bounce) is undiagnosable.
]);

async function callTool<T = unknown>(
  toolName: string,
  args: Record<string, unknown> = {},
  opts: { bestEffort?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const quiet = QUIET_TOOLS.has(toolName);
  // `args` holds only the wrapper's own params — never npub/proof (those are
  // injected below), so it is safe to log verbatim.
  if (!quiet) debugPush("call", `${SLUG}_${toolName}(${JSON.stringify(args).slice(0, 140)})`);

  const c = await getClient();
  const merged: Record<string, unknown> = BOOTSTRAP_TOOLS.has(toolName)
    ? { ...args }
    : { npub: getStoredNpub(), dpop_token: getCachedProof(toolName), ...args };

  let result: ToolResult;
  try {
    result = (await c.callTool(
      { name: `${SLUG}_${toolName}`, arguments: merged },
      undefined,
      { timeout: opts.timeoutMs ?? 120_000 },
    )) as ToolResult;
  } catch (e) {
    if (!quiet) debugPush("error", `${SLUG}_${toolName}: ${(e as Error).message}`);
    throw new Error(`${SLUG}_${toolName}: ${(e as Error).message}`);
  }

  if (result.isError) {
    const errText = (result.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => String(b.text))
      .join("\n") || "Tool call failed";
    if (!quiet) debugPush("error", `${SLUG}_${toolName}: ${errText.slice(0, 200)}`);
    throw new Error(errText);
  }

  let payload: unknown;
  if (result.structuredContent !== undefined) {
    payload = result.structuredContent;
  } else {
    const textBlocks = (result.content ?? []).filter((b) => b.type === "text");
    if (textBlocks.length > 0) {
      const text = String(textBlocks[0].text ?? "");
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    } else {
      payload = result;
    }
  }

  if (!quiet) {
    const preview = typeof payload === "string" ? payload : JSON.stringify(payload);
    const p = payload as Record<string, unknown> | null;
    const failed = p && typeof p === "object" && (p.success === false || p.error);
    debugPush(failed ? "error" : "result", `${SLUG}_${toolName} → ${String(preview).slice(0, 220)}`);
  }

  // Soft proof failures arrive as {success:false, error_code:...} with no
  // isError flag. Treat them as auth bounces: clear the stale token and let the
  // gate re-arm sign-in. NOT for best-effort calls (personalization/diagnostics)
  // — a non-essential tool must never be able to log the user out of everything.
  if (!opts.bestEffort && payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    // The wheel's ErrorCode values are lowercase snake_case ("proof_required",
    // "proof_refresh_needed") — normalize before comparing. (A prior uppercase
    // comparison never matched, so the bounce silently never fired and the raw
    // "cache entry is no longer valid" text just landed in an inline banner.)
    const errCode = String(p.error_code ?? "").toLowerCase();
    if (p.success === false && (errCode === "proof_required" || errCode === "proof_refresh_needed")) {
      // The cached DM proof_token the server just rejected is the SAME token the
      // recent-login one-tap would replay — evict it too, or the returning-user
      // shortcut immediately re-bounces. (nsec sessions don't record a recent
      // login and re-sign inline, so this only touches DM-login users.)
      const bouncedNpub = getStoredNpub();
      window.localStorage.removeItem(PROOF_STORAGE_KEY);
      if (bouncedNpub) forgetRecentLogin(bouncedNpub);
      const msg = String(p.error ?? "Sign-in required.");
      emitProofExpired(msg);
      throw new ProofRequiredError(msg);
    }
  }
  return payload as T;
}

// ─── Service / auth (free) ───────────────────────────────────────────────

export interface ServiceStatus {
  operator_npub_hash?: string;
  lifecycle?: string;
  message?: string;
  version?: string;
  tollbooth_dpyc_version?: string;
  process_id?: number;
  service?: string;
  slug?: string;
  vault_configured?: boolean;
  courier_has_vault?: boolean;
  // Durable long-runner diagnostics (operator only; present when op_npub resolves).
  durable_jobs?: {
    key_id?: string;
    closure_key_block?: string;
    deployment?: string;
    detached_executor_active?: boolean;
    detached_executor_resolved?: boolean;
    detached_executor_error?: string | null;
  };
  // FastMCP Docket backend — durable_across_recycles is the real signal.
  async_jobs?: {
    docket_url_set?: boolean;
    backend?: string;
    durable_across_recycles?: boolean;
  };
  build_info?: {
    fastmcp_cloud_url?: string;
    fastmcp_cloud_git_commit_sha?: string;
    fastmcp_cloud_git_repo?: string;
  };
}

export async function serviceStatus(): Promise<ServiceStatus> {
  return callTool<ServiceStatus>("service_status", {});
}

export interface NpubProofResult {
  success?: boolean;
  proven_npub?: string;
  verified?: boolean; // legacy field; current wheel uses `success`
  status?: string;
  message?: string;
  dpop_token?: string; // wheel 0.57.0+ (was proof_token)
  popped_dms?: number;
  expires_in_seconds?: number;
  expires_at?: string;
  error?: string;
  error_code?: string;
}

/// Step 1 of DM login. Sends a Secure Courier challenge DM to the npub.
/// The user replies in their own Nostr client. Free.
///
/// `verifyAt` is the OAuth2 Device-Grant `verification_uri` (RFC 8628): the
/// place where THIS app displays the session phrase. The DM names it so the
/// human can cross-check — "the code in this DM was shown to you at <verifyAt>;
/// approve only if it matches." Trust rests on that two-surface match, so we
/// pass this app's own URL: an impostor firing the same tool from elsewhere
/// cannot make the human's open Roastify tab show the attacker's code.
export async function requestNpubProof(
  patronNpub: string,
  verifyAt?: string,
  reason?: string,
): Promise<NpubProofResult> {
  return callTool<NpubProofResult>("request_npub_proof", {
    patron_npub: patronNpub,
    ...(verifyAt ? { verify_at: verifyAt } : {}),
    ...(reason ? { reason } : {}),
  });
}

/// Step 2 of DM login. Destructively drains DMs looking for the signed
/// reply to step 1. Call ONLY after the user has actually replied — do not
/// poll or speculatively retry (feedback_human_in_loop_courier). `dpopToken`
/// is the dpop_token from step 1 (wheel 0.57.0+; was the poison/proof_token).
export async function receiveNpubProof(patronNpub: string, dpopToken: string): Promise<NpubProofResult> {
  return callTool<NpubProofResult>("receive_npub_proof", {
    patron_npub: patronNpub,
    dpop_token: dpopToken,
  });
}

export interface CreditTranche {
  id: string;
  amount_sats: number;
  remaining_sats: number;
  expires_at: string | null;
  created_at: string | null;
}

export interface CheckBalanceResult {
  success?: boolean;
  balance_api_sats?: number;
  total_deposited_api_sats?: number;
  total_consumed_api_sats?: number;
  active_tranches?: number;
  tranches?: CreditTranche[];
  next_expiration_iso?: string;
  /** Sats in active tranches that expire within 24h (wheel check_balance). */
  expiring_within_24h_sats?: number;
  total_expired_api_sats?: number;
  seed_balance_granted?: boolean;
  vault_unavailable?: boolean;
  warning?: string;
  npub?: string;
  error?: string;
  error_code?: string;
}

export async function checkBalance(): Promise<CheckBalanceResult> {
  return callTool<CheckBalanceResult>("check_balance", {});
}

// ─── Funding / credential status probes (compose into StatusSurface) ─────────
// All free. Patron rows use check_balance + session_status + check_proof_status.
// Operator rows use service_status + get_operator_onboarding_status +
// check_authority_balance, gated client-side to the operator npub the same way
// scheduler_pending is (getSchedulerStatus().operator_npub === stored npub).

export interface ProofStatusResult {
  success?: boolean;
  status?: "valid" | "expired" | "unknown" | string;
  expires_in_seconds?: number | null;
  message?: string;
  error?: string;
  error_code?: string;
}

/// Whether the cached DM proof_token is still accepted. For session-nsec logins
/// there is nothing to check (fresh inline proof each call) — callers should
/// skip this and treat the proof row as ok. Free; takes explicit args so the
/// envelope is not double-injected.
export async function checkProofStatus(
  patronNpub: string,
  dpopToken: string,
): Promise<ProofStatusResult> {
  return callTool<ProofStatusResult>(
    "check_proof_status",
    { patron_npub: patronNpub, dpop_token: dpopToken },
    { bestEffort: true },
  );
}

export interface OnboardingField {
  field: string;
  category?: string;
  status?: string;
  lifecycle?: string;
  how?: string;
}

export interface OperatorOnboardingResult {
  ready?: boolean;
  configured?: OnboardingField[];
  missing?: OnboardingField[];
  optional_missing?: OnboardingField[];
  summary?: string;
  bootstrap_error?: string;
  vault_ok?: boolean;
  credential_service?: string;
  operator_name?: string;
  error?: string;
}

/// Operator credential readiness (BTCPay / X app / llm_api_key present-or-not).
/// Free, no proof. A non-operator still gets the structural answer; the FE hides
/// the panel unless the viewer is the operator npub.
export async function getOperatorOnboardingStatus(): Promise<OperatorOnboardingResult> {
  return callTool<OperatorOnboardingResult>(
    "get_operator_onboarding_status",
    {},
    { bestEffort: true },
  );
}

export interface AuthorityBalanceResult {
  success?: boolean;
  balance_api_sats?: number;
  balance_sats?: number;
  error?: string;
  message?: string;
}

/// This operator's tax balance at the Authority (sats available to certify
/// patron purchases). Free. Best-effort — a failure is itself a status signal.
export async function checkAuthorityBalance(): Promise<AuthorityBalanceResult> {
  return callTool<AuthorityBalanceResult>(
    "check_authority_balance",
    {},
    { bestEffort: true },
  );
}

export interface SessionLifecycleResult {
  success?: boolean;
  lifecycle?: string;
  message?: string;
  detail?: string;
  operator_npub?: string;
}

/// Operator lifecycle (ready / warming_up / misconfigured / quota_exceeded / …).
/// Free. Optional patron_npub also yields upstream_oauth (used by getXConnection).
export async function getSessionLifecycle(
  patronNpub?: string,
): Promise<SessionLifecycleResult> {
  return callTool<SessionLifecycleResult>(
    "session_status",
    patronNpub ? { patron_npub: patronNpub } : {},
    { bestEffort: true },
  );
}

export interface CheckPriceResult {
  success: boolean;
  tool_id?: string;
  tool_name?: string;
  base_cost?: number;
  effective_cost?: number;
  cost?: number;
  error?: string;
  error_code?: string;
}

export async function checkPrice(
  toolCapability: string,
  toolKwargs: Record<string, unknown> = {},
): Promise<CheckPriceResult> {
  return callTool<CheckPriceResult>("check_price", {
    tool_id: toolCapability,
    tool_kwargs: JSON.stringify(toolKwargs),
  });
}

export interface PurchaseCreditsResult {
  success?: boolean;
  invoice_id?: string;
  checkout_link?: string;
  lightning_invoice?: string;
  payment_request?: string;
  expires_at?: string;
  amount_sats?: number;
  error?: string;
  error_code?: string;
}

export async function purchaseCredits(sats: number): Promise<PurchaseCreditsResult> {
  return callTool<PurchaseCreditsResult>("purchase_credits", { amount_sats: sats });
}

export interface CheckPaymentResult {
  success?: boolean;
  status?: "New" | "Processing" | "Settled" | "Expired" | "Invalid" | string;
  message?: string;
  invoice_id?: string;
  credits_granted?: number;
  balance_api_sats?: number;
  error?: string;
  error_code?: string;
}

export async function checkPayment(invoiceId: string): Promise<CheckPaymentResult> {
  return callTool<CheckPaymentResult>("check_payment", { invoice_id: invoiceId });
}

export interface AccountStatementResult {
  success?: boolean;
  npub?: string;
  balance_api_sats?: number;
  total_deposited_api_sats?: number;
  total_consumed_api_sats?: number;
  total_expired_api_sats?: number;
  active_tranches?: number;
  today_usage?: Record<string, { calls: number; api_sats: number }>;
  error?: string;
}

export async function getAccountStatement(days = 30): Promise<AccountStatementResult> {
  return callTool<AccountStatementResult>("account_statement", { days });
}

// ─── Posts CRUD (paid) ───────────────────────────────────────────────────

export interface Kind0 {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  website?: string;
  lud16?: string;
}

export interface GetNostrProfileResult {
  success: boolean;
  npub?: string;
  profile?: Kind0;
  error?: string;
}

/// Read an npub's public kind-0 profile via the operator MCP (free, no proof).
export async function getNostrProfile(npub: string): Promise<GetNostrProfileResult> {
  return callTool<GetNostrProfileResult>("get_nostr_profile", { npub });
}

export interface PublishNostrProfileResult {
  success: boolean;
  ok?: number;
  total?: number;
  errors?: string[];
  error?: string;
}

/// Relay a CLIENT-signed kind-0 event through the operator MCP. The FE signs;
/// the wheel verifies pubkey+signature and fans out to relays.
export async function publishNostrProfile(
  npub: string,
  signedEvent: string,
): Promise<PublishNostrProfileResult> {
  return callTool<PublishNostrProfileResult>("publish_nostr_profile", {
    npub,
    signed_event: signedEvent,
  });
}

// ─── Coupons (wheel 0.41.0+) ─────────────────────────────────────────────

export interface PatronCoupon {
  coupon_id: string;
  name: string;
  discount_percent: number;
  valid_from: string;
  valid_until: string;
  uses_per_patron: number | null;
  use_count: number;
  uses_remaining: number | null;
  total_uses: number | null;
  total_remaining: number | null;
  status: string; // active | window_closed | window_not_started | patron_limit | total_limit
}

export interface ListMyCouponsResult {
  success: boolean;
  count: number;
  coupons: PatronCoupon[];
  error?: string;
}

export interface RedeemCouponResult {
  success: boolean;
  coupon_id?: string;
  name?: string;
  discount_percent?: number;
  valid_until?: string;
  uses_remaining?: number | null;
  uses_per_patron?: number | null;
  error?: string;
}

export interface ForgetCouponResult {
  success: boolean;
  coupon_id?: string;
  error?: string;
}

export async function listMyCoupons(): Promise<ListMyCouponsResult> {
  return callTool<ListMyCouponsResult>("list_my_coupons", {});
}

export async function redeemCoupon(code: string): Promise<RedeemCouponResult> {
  return callTool<RedeemCouponResult>("redeem_coupon", { code });
}

export async function forgetCoupon(couponId: string): Promise<ForgetCouponResult> {
  return callTool<ForgetCouponResult>("forget_coupon", { coupon_id: couponId });
}

// ─── Roastify catalog ────────────────────────────────────────────────────

export interface CatalogVariant {
  id?: string;
  title?: string;
  size?: string;
  sku?: string;
  retailPrice?: number; // cents, as upstream gives it
  inStock?: boolean;
  stockQty?: number;
  plan?: string;
}

export interface CatalogProduct {
  id: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  productType?: string;
  productCategory?: string;
  dielineTemplateUrl?: string;
  variants?: number;
  plan?: string;
}

export interface Blend {
  id: string;
  name?: string;
  description?: string;
  isDecaf?: boolean;
  roastLevel?: string;
}

export interface BrowseCatalogResult {
  success: boolean;
  products: CatalogProduct[];
  blends: Blend[];
  /** False when the blend leg failed — an empty list must not read as "none exist". */
  blends_available: boolean;
}

export async function browseCatalog(): Promise<BrowseCatalogResult> {
  return callTool<BrowseCatalogResult>("browse_catalog");
}

export interface CatalogProductDetail {
  success: boolean;
  product: CatalogProduct;
  variants: CatalogVariant[];
  variants_available: boolean;
}

export async function getCatalogProduct(productId: string): Promise<CatalogProductDetail> {
  return callTool<CatalogProductDetail>("get_catalog_product", { product_id: productId });
}

export interface BlendDetail {
  success: boolean;
  blend: Blend;
  variants: CatalogVariant[];
  variants_available: boolean;
}

export async function getBlend(blendId: string): Promise<BlendDetail> {
  return callTool<BlendDetail>("get_blend", { blend_id: blendId });
}

// ─── The merchant's own saved designs ────────────────────────────────────

export interface MyProduct {
  id: string;
  createdAt?: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  productType?: string;
  images?: { url: string }[];
  variants?: CatalogVariant[];
}

export interface ListMyProductsResult {
  success: boolean;
  products: MyProduct[];
  end_cursor?: string | null;
  has_next_page: boolean;
}

export async function listMyProducts(opts: { cursor?: string; limit?: number } = {}) {
  return callTool<ListMyProductsResult>("list_my_products", {
    cursor: opts.cursor ?? "",
    limit: opts.limit ?? 50,
  });
}

export async function getMyProduct(productId: string) {
  return callTool<{ success: boolean; product: MyProduct }>("get_my_product", {
    product_id: productId,
  });
}

// ─── Artwork ─────────────────────────────────────────────────────────────

export interface ArtworkField {
  fieldId: string;
  type: "text" | "image";
  value: string;
}

export interface StartArtworkResult {
  success: boolean;
  job_id?: string;
  status?: string;
  error?: string;
}

export async function generateArtwork(args: {
  productId: string;
  fields: ArtworkField[];
  clientReqId?: string;
}): Promise<StartArtworkResult> {
  return callTool<StartArtworkResult>("generate_artwork", {
    product_id: args.productId,
    fields: args.fields,
    client_req_id: args.clientReqId ?? "",
  });
}

export interface ArtworkStatusResult {
  success: boolean;
  job_id?: string;
  status?: string;
  artwork_url?: string | null;
  error?: string | null;
}

export async function artworkStatus(jobId: string): Promise<ArtworkStatusResult> {
  return callTool<ArtworkStatusResult>("artwork_status", { job_id: jobId });
}

// ─── Patron credentials (the Roastify key) ───────────────────────────────

export interface PatronOnboardingResult {
  ready: boolean;
  configured: OnboardingField[];
  missing: OnboardingField[];
  summary?: string;
  credential_service?: string;
}

export async function getPatronOnboardingStatus(): Promise<PatronOnboardingResult> {
  // Envelope-free: takes patron_npub + the cached phrase explicitly, like
  // check_proof_status. Sending the injected npub/dpop_token pair is rejected.
  return callTool<PatronOnboardingResult>("get_patron_onboarding_status", {
    patron_npub: getStoredNpub(),
    dpop_token: getStoredProof(),
  });
}

export interface RequestPatronCredentialsResult {
  success: boolean;
  dpop_token?: string;
  rendezvous_relay?: string;
  instructions?: string;
  message?: string;
}

export async function requestPatronCredentials(): Promise<RequestPatronCredentialsResult> {
  return callTool<RequestPatronCredentialsResult>("request_patron_credentials", {
    sender_npub: getStoredNpub(),
  });
}

export interface ReceivePatronCredentialsResult {
  success: boolean;
  stored_fields?: string[];
  still_missing_required?: string[];
  message?: string;
  error?: string;
}

export async function receivePatronCredentials(dpopToken: string) {
  return callTool<ReceivePatronCredentialsResult>("receive_patron_credentials", {
    sender_npub: getStoredNpub(),
    dpop_token: dpopToken,
  });
}
