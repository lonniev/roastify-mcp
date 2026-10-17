/* holder-lite — the courier as a *holder*: a connection the operator knows,
 * into whose wallet the patron's npub is proven by the usual DM. The courier
 * keeps only this connection's OAuth tokens; the grant stays with the operator
 * and each call names only the npub.
 *
 * The courier lives on merchant.roastify.app, so it cannot send the page to the
 * operator and back. It opens `/authorize` in a popup instead; the operator
 * approves at once (a holder holds nothing until a DM proves an npub into it)
 * and redirects the popup to the Bench's callback page, which hands the code
 * back here by postMessage. PKCE keeps that code useless to anyone else.
 */

const OPERATOR = "https://roastify-mcp.fastmcp.app";
const REDIRECT_URI = "https://roastify.tollbooth-dpyc.com/holder-callback.html";
const TOKENS_KEY = "rcourier:holder:v1";
const REFRESH_EARLY_MS = 60_000;
const POPUP_WAIT_MS = 120_000;

interface Tokens { clientId: string; accessToken: string; refreshToken: string; expiresAt: number }

function read(): Tokens | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKENS_KEY) || "null");
    return t && typeof t.refreshToken === "string" ? t : null;
  } catch {
    return null;
  }
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function token(form: Record<string, string>, clientId: string): Promise<Tokens> {
  const r = await fetch(`${OPERATOR}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, client_id: clientId, resource: `${OPERATOR}/mcp` }),
  });
  if (!r.ok) throw new Error(`the service refused the connection (${r.status})`);
  const t = await r.json();
  const fresh = {
    clientId, accessToken: t.access_token, refreshToken: t.refresh_token,
    expiresAt: Date.now() + Number(t.expires_in ?? 3600) * 1000,
  };
  localStorage.setItem(TOKENS_KEY, JSON.stringify(fresh));
  return fresh;
}

/** True when the courier already is a holder. */
export function isHolder(): boolean {
  return read() !== null;
}

/**
 * Become a holder. Call from a click: the popup is opened at once (so the
 * browser allows it) and pointed at the operator once registration is done.
 */
export async function connect(): Promise<void> {
  const popup = window.open("", "dpyc-holder", "width=480,height=640");
  if (!popup) throw new Error("allow the sign-in popup for this site, then try again");
  try {
    const reg = await fetch(`${OPERATOR}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Roastify courier", redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    if (!reg.ok) throw new Error(`could not register with the service (${reg.status})`);
    const clientId: string = (await reg.json()).client_id;
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const code = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { removeEventListener("message", on); reject(new Error("the sign-in popup did not finish")); }, POPUP_WAIT_MS);
      function on(e: MessageEvent) {
        const d = e.data;
        if (!d || d.type !== "dpyc-holder-code" || d.state !== state) return;
        clearTimeout(timer);
        removeEventListener("message", on);
        resolve(String(d.code));
      }
      addEventListener("message", on);
    });
    const url = new URL(`${OPERATOR}/authorize`);
    url.search = new URLSearchParams({
      response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI, state,
      code_challenge: challenge, code_challenge_method: "S256", resource: `${OPERATOR}/mcp`,
    }).toString();
    popup.location.href = url.toString();
    await token(
      { grant_type: "authorization_code", code: await code, redirect_uri: REDIRECT_URI, code_verifier: verifier },
      clientId,
    );
  } finally {
    if (!popup.closed) popup.close();
  }
}

/** The bearer for the next request, refreshed when it is about to lapse; "" when not a holder. */
export async function bearer(): Promise<string> {
  const t = read();
  if (!t) return "";
  if (t.expiresAt - REFRESH_EARLY_MS > Date.now()) return t.accessToken;
  try {
    return (await token({ grant_type: "refresh_token", refresh_token: t.refreshToken }, t.clientId)).accessToken;
  } catch {
    localStorage.removeItem(TOKENS_KEY);
    return "";
  }
}
