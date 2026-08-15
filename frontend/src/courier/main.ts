/* courier — injected into merchant.roastify.app by a bookmarklet.
 *
 * A pure shuttle between Roastify and the roastify-mcp design library. It does
 * exactly the three things that need the merchant's Clerk session — read a
 * product's design, write one back (updateDesign) — plus the two library calls
 * that need the patron's npub. It holds NO redesign logic: the Design Bench
 * does all editing and font-repair.
 *
 * Auth is the standard DPYC protocol: the user logs into roastify-mcp with their
 * npub via the DM-proof dance, and the courier sends its held dpop_token on every
 * tool call. The merchant origin's localStorage is separate from the Bench, so
 * the courier logs in once here.
 *
 * MCP calls go through a minimal POST-based client (./mcp-lite), NOT the official
 * SDK: the SDK's streaming transport fails cross-origin in iPad Safari, where the
 * courier lives (merchant origin) but the MCP is on the Bench's origin. The MCP is
 * reached through the Bench's Cloudflare proxy (Access-Control-Allow-Origin: *).
 */
import { api, store, type StoredDesignMeta, type StoredVersion } from "./mcp-lite";

type Rec = Record<string, unknown>;

// The GitHub octocat mark (fill=currentColor so it takes the button's ink),
// reused on the Commit and Fetch buttons — both are GitHub operations.
const OCTO =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
  '<path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

if (location.host !== "merchant.roastify.app") {
  alert("Open this on merchant.roastify.app (signed in), then tap the bookmarklet there.");
} else {
  try {
    main();
  } catch (e) {
    // The courier is injected as a classic script with no console on iPad, so a
    // throw here would be silent. Surface it.
    const err = e as Error;
    alert("Courier failed to open: " + (err?.message || e) + "\n\n" + String(err?.stack || "").slice(0, 400));
  }
}

function main(): void {
  const prior = document.getElementById("rcourier-host");
  if (prior) prior.remove();

  // ---- merchant tRPC (same-origin; Clerk session cookie) -------------------
  const unwrap = async (res: Response, path: string): Promise<unknown> => {
    const b = (await res.json().catch(() => ({}))) as Rec;
    const err = b.error as Rec | undefined;
    if (!res.ok || err) {
      const msg =
        ((err?.json as Rec | undefined)?.message as string) ||
        (err?.message as string) ||
        `HTTP ${res.status}`;
      throw new Error(`${path}: ${msg}`);
    }
    return ((b.result as Rec)?.data as Rec)?.json;
  };
  const query = (path: string, input: Rec = {}): Promise<unknown> =>
    fetch(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`, {
      method: "GET",
      credentials: "include",
    }).then((r) => unwrap(r, path));
  const mutate = (path: string, input: Rec): Promise<unknown> =>
    fetch(`/api/trpc/${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
    }).then((r) => unwrap(r, path));

  const rid = (): string =>
    crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const STORAGE = "https://storage.roastify.app/";
  const asset = (url: unknown) => ({
    s3Key: typeof url === "string" ? url.replace(/^https?:\/\/storage\.roastify\.app\//, "") : "",
    imageUrl: url,
  });

  const rowsOf = (r: unknown): Rec[] => {
    const o = r as Rec;
    if (Array.isArray(r)) return r as Rec[];
    return (o?.products ?? o?.items ?? o?.data ?? o?.rows ?? []) as Rec[];
  };
  const idOf = (p: Rec): string =>
    String(p.id ?? p.editProductId ?? p.productId ?? p._id ?? "");
  // Roastify stamps " (copy)" / " (copy revised)" / " (copy 2)" onto a design's
  // title when it is duplicated in the Designer. That is a UI lineage artifact, not
  // the merchant's intent — strip it so the stash label (and any slug derived from
  // it) names the design, not how it was made. Loops to peel chained suffixes.
  const cleanTitle = (s: string): string => {
    let t = s, prev;
    do {
      prev = t;
      t = t.replace(/\s*\(copy(?:\s+revised)?(?:\s+\d+)?\)\s*$/i, "");
    } while (t !== prev);
    return t.trim();
  };
  const labelOf = (p: Rec): string => cleanTitle(String(p.title || p.name || "")) || idOf(p);
  const mockupsOf = (p: Rec): string[] => {
    const imgs = p.images as Array<Rec | string> | undefined;
    const raw =
      (p.mockupImages as unknown[]) ??
      (p.imageUrls as unknown[]) ??
      (imgs ? imgs.map((i) => (typeof i === "string" ? i : (i.url ?? i.imageUrl ?? i))) : null) ??
      (p.designImageUrl ? [p.designImageUrl] : []);
    return (raw as unknown[])
      .map((m) => (typeof m === "string" ? m : ((m as Rec)?.imageUrl ?? (m as Rec)?.url)))
      .filter(Boolean) as string[];
  };
  const readDesign = async (dj: unknown): Promise<Rec> => {
    if (dj && typeof dj === "object") return dj as Rec;
    if (typeof dj === "string" && /^https?:/.test(dj)) return (await fetch(dj).then((r) => r.json())) as Rec;
    return JSON.parse(String(dj)) as Rec;
  };

  // ---- panel (shadow DOM) --------------------------------------------------
  const host = document.createElement("div");
  host.id = "rcourier-host";
  document.body.appendChild(host);
  const sh = host.attachShadow({ mode: "open" });
  sh.innerHTML = `
    <style>
      :host{all:initial}
      .p{position:fixed;top:16px;right:16px;z-index:2147483647;width:min(560px,calc(100vw - 24px));
        font-family:ui-monospace,Menlo,monospace;color:#e8ece6;background:#171b1a;
        border:1px solid #2c3432;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);
        display:flex;flex-direction:column;max-height:calc(100vh - 32px)}
      .p.big{width:min(920px,calc(100vw - 24px))}
      .rz{position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;
        border-right:2px solid #4a544f;border-bottom:2px solid #4a544f;
        border-bottom-right-radius:11px;touch-action:none}
      .h{display:flex;align-items:center;gap:6px;padding:10px 14px;background:#0d100f;
        cursor:move;user-select:none;flex:0 0 auto;border-radius:12px 12px 0 0}
      .h b{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#4fbfc0;flex:1}
      .h .ic{cursor:pointer;color:#828d86;font-size:16px;line-height:1;padding:3px 6px}
      .h .ic:hover{color:#e8ece6}
      .b{padding:14px;display:flex;flex-direction:column;gap:12px;overflow:auto}
      label{font-size:11px;color:#828d86;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em}
      input,select,button{font:inherit;box-sizing:border-box}
      input,select{width:100%;background:#101312;color:#e8ece6;border:1px solid #2c3432;border-radius:8px;padding:9px;font-size:14px}
      select{appearance:none;-webkit-appearance:none;padding-right:28px;background-repeat:no-repeat;background-position:right 10px center;
        background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" fill="none" stroke="%23828d86" stroke-width="1.5"/></svg>')}
      button{background:#0d7c7f;color:#0b1211;border:0;border-radius:8px;padding:10px;font-weight:700;cursor:pointer}
      button.wide{width:100%}
      button.gh{display:inline-flex;align-items:center;gap:6px;line-height:1}
      button svg{flex:0 0 auto}
      #stash{align-self:flex-start;padding:8px 14px}
      button.alt{background:#3B4248;color:#e8ece6}
      button.danger{background:transparent;color:#dc8a6f;border:1px solid #5a3a32}
      button:disabled{opacity:.45;cursor:default}
      .row{display:flex;gap:8px;align-items:center}
      .warn{color:#dca63f;font-size:12px}
      .ok{color:#4fbfc0;font-size:12px}
      .sec{border-top:1px solid #232b29;padding-top:12px;display:flex;flex-direction:column;gap:8px}
      .libhead{display:flex;align-items:center;justify-content:space-between}
      .libhead label{margin:0}
      .lib{display:flex;flex-direction:column;gap:8px;max-height:34vh;overflow:auto}
      .p.big .lib{max-height:52vh}
      .item{border:1px solid #2c3432;border-radius:8px;padding:9px 11px;background:#141817}
      .item .nm{font-size:13px;color:#e8ece6;font-weight:700;word-break:break-word}
      .item .mt{font-size:11px;color:#828d86;margin-top:3px}
      .item .ax{display:flex;gap:6px;margin-top:8px;justify-content:flex-end}
      .item .ax button{padding:5px 9px;font-size:12px;display:inline-flex;align-items:center;gap:5px;line-height:1}
      .empty{color:#828d86;font-size:12px;padding:6px 0}
      .lib .load{color:#4fbfc0;font-size:12px;padding:6px 0}
      .lib .err{color:#dc8a6f;font-size:12px;padding:6px 0}
      .lib .err button{margin-top:6px;padding:6px 10px;font-size:12px}
      .spin{display:inline-block;width:11px;height:11px;border:2px solid #2c3432;
        border-top-color:#4fbfc0;border-radius:50%;animation:sp .7s linear infinite;
        vertical-align:-1px;margin-right:6px}
      @keyframes sp{to{transform:rotate(360deg)}}
      .item .id{font-size:10px;color:#5f6b64;margin-top:2px;
        font-family:ui-monospace,Menlo,monospace;word-break:break-all}
      .item .id a.sha{color:#4fbfc0;text-decoration:none}
      .item .id a.sha:hover{text-decoration:underline}
      .ovl{position:absolute;inset:0;background:rgba(8,10,9,.74);border-radius:12px;z-index:5;
        display:flex;align-items:center;justify-content:center;padding:14px}
      .ovlbox{background:#171b1a;border:1px solid #2c3432;border-radius:10px;padding:12px;
        width:100%;max-height:82%;overflow:auto;display:flex;flex-direction:column;gap:8px}
      .ovlh{font-size:12px;color:#4fbfc0;text-transform:uppercase;letter-spacing:.06em}
      .vrow{display:flex;flex-direction:column;gap:2px;align-items:flex-start;text-align:left;
        background:#141817;border:1px solid #2c3432;color:#e8ece6;font-weight:400;padding:8px 10px}
      .vrow .vtop{font-size:12px;font-weight:700}
      .vrow .vtag{color:#4fbfc0}
      .vrow .vmsg{font-size:11px;color:#a9b2ac;word-break:break-word}
      .vrow .vsha{font-size:10px;color:#5f6b64;font-family:ui-monospace,Menlo,monospace}
      .ovlbox .fline{font-size:12px;color:#c7cdc6;line-height:1.5}
      .ovlbox label{margin-top:8px;margin-bottom:3px}
      .ovlbox textarea{width:100%;min-height:52px;resize:vertical;background:#101312;color:#e8ece6;
        border:1px solid #2c3432;border-radius:8px;padding:9px;font:inherit;font-size:14px;box-sizing:border-box}
      .ovlbox .fhint{font-size:10px;color:#828d86;margin-top:3px}
      .ovlbox .ferr{font-size:11px;color:#dc8a6f;margin-top:3px}
      .frow{display:flex;gap:8px;margin-top:12px}
      .frow button{flex:1}
      #work{flex-direction:column;gap:12px}
      pre{margin:0;background:#0d100f;border:1px solid #2c3432;border-radius:8px;padding:9px;
        font-size:11px;line-height:1.5;max-height:120px;overflow:auto;white-space:pre-wrap;word-break:break-word}
    </style>
    <div class="p">
      <div class="h" id="hd"><b>Design courier</b>
        <span class="ic" id="exp" title="Expand / shrink">&#x2922;</span>
        <span class="ic" id="x" title="Close">&#x2715;</span></div>
      <div class="b">
        <div id="login">
          <label>Log in to Roastify MCP with your npub</label>
          <input id="npub" placeholder="npub1…" autocapitalize="off" autocorrect="off" spellcheck="false" />
          <div class="row" style="margin-top:8px"><button class="wide" id="send">Send login DM</button></div>
          <div id="await" style="display:none;margin-top:10px">
            <div class="warn">Reply to the Nostr DM with any phrase, then:</div>
            <button class="wide" id="confirm" style="margin-top:8px">I replied — confirm</button>
          </div>
        </div>
        <div id="work" style="display:none">
          <div class="ok" id="who"></div>
          <div class="sec">
            <div><label>Roastify Design</label><select id="prod"></select></div>
            <button class="gh" id="stash" title="Commit this product's design up to your GitHub library" disabled>${OCTO}Commit</button>
          </div>
          <div class="sec">
            <div class="libhead"><label>Library <span id="libn"></span></label>
              <span class="ic" id="r" title="Refresh">&#x21bb;</span></div>
            <div class="lib" id="lib"></div>
          </div>
        </div>
        <pre id="log">Log in to begin.</pre>
      </div>
    </div>`;
  const $ = (id: string) => sh.getElementById(id) as HTMLElement;
  const val = (id: string) => (sh.getElementById(id) as HTMLInputElement | HTMLSelectElement).value;
  const log = (m: string) => {
    const el = $("log");
    el.textContent += "\n" + m;
    el.scrollTop = 1e9;
  };
  $("x").onclick = () => host.remove();
  const SIZE_KEY = "rcourier-size";
  const panelEl = () => sh.querySelector(".p") as HTMLElement;
  $("exp").onclick = () => {
    const p = panelEl();
    p.style.width = ""; p.style.maxHeight = "";          // clear any custom resize
    try { localStorage.removeItem(SIZE_KEY); } catch { /* private mode */ }
    p.classList.toggle("big");
  };

  (() => {
    let dx = 0, dy = 0, on = false;
    const p = sh.querySelector(".p") as HTMLElement;
    const h = $("hd");
    h.onpointerdown = (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.classList.contains("ic")) return;
      on = true; dx = e.clientX - p.offsetLeft; dy = e.clientY - p.offsetTop;
      h.setPointerCapture(e.pointerId);
    };
    h.onpointermove = (e: PointerEvent) => {
      if (!on) return;
      p.style.left = e.clientX - dx + "px"; p.style.top = e.clientY - dy + "px"; p.style.right = "auto";
    };
    h.onpointerup = () => { on = false; };
  })();

  // Resizable via a bottom-right grip; the chosen size persists across reloads.
  (() => {
    const p = panelEl();
    try {
      const s = JSON.parse(localStorage.getItem(SIZE_KEY) || "null");
      if (s && typeof s.w === "number") {
        p.style.width = s.w + "px";
        if (typeof s.mh === "number") p.style.maxHeight = s.mh + "px";
      }
    } catch { /* first run / private mode */ }
    const grip = document.createElement("div");
    grip.className = "rz";
    grip.title = "Drag to resize";
    p.appendChild(grip);
    let on = false, sx = 0, sy = 0, sw = 0, sh2 = 0;
    grip.addEventListener("pointerdown", (e) => {
      const r = p.getBoundingClientRect();
      // Pin the top-left corner so the grip grows the panel right/down predictably,
      // whether it was right-anchored (default) or moved (left/top).
      p.style.left = r.left + "px"; p.style.top = r.top + "px"; p.style.right = "auto";
      sx = e.clientX; sy = e.clientY; sw = r.width; sh2 = r.height;
      on = true;
      try { grip.setPointerCapture(e.pointerId); } catch { /* older engines */ }
      e.preventDefault();
    });
    grip.addEventListener("pointermove", (e) => {
      if (!on) return;
      const r = p.getBoundingClientRect();
      const w = Math.max(320, Math.min(window.innerWidth - r.left - 8, sw + (e.clientX - sx)));
      const mh = Math.max(220, Math.min(window.innerHeight - r.top - 8, sh2 + (e.clientY - sy)));
      p.style.width = w + "px";
      p.style.maxHeight = mh + "px";
    });
    grip.addEventListener("pointerup", (e) => {
      if (!on) return;
      on = false;
      try { grip.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify({
          w: parseInt(p.style.width, 10), mh: parseInt(p.style.maxHeight, 10),
        }));
      } catch { /* private mode — size just won't persist */ }
    });
  })();

  // ---- login (standard DM-proof; reused from the Bench) --------------------
  let pendingProof = "";
  $("send").onclick = async () => {
    const npub = val("npub").trim();
    if (!/^npub1[0-9a-z]+$/.test(npub)) { log("✗ enter a valid npub1… key"); return; }
    ($("send") as HTMLButtonElement).disabled = true;
    log("sending login DM…");
    try {
      const r = await api.requestProof(
        npub, location.origin, `You requested to log in to Roastify (${location.host}).`,
      );
      if (r.error || !r.dpop_token) { log("✗ " + (r.error || "no session phrase returned")); return; }
      store.setNpub(npub);
      pendingProof = r.dpop_token;
      $("await").style.display = "block";
      log("DM sent. Reply to it, then tap confirm.");
    } catch (e) {
      log("✗ " + (e as Error).name + ": " + (e as Error).message);
    } finally {
      ($("send") as HTMLButtonElement).disabled = false;
    }
  };
  $("confirm").onclick = async () => {
    const npub = val("npub").trim();
    ($("confirm") as HTMLButtonElement).disabled = true;
    log("verifying reply…");
    try {
      const r = await api.receiveProof(npub, pendingProof);
      if (r.error) { log("✗ " + r.error); return; }
      const token = r.dpop_token || pendingProof;
      store.setProof(token);
      $("login").style.display = "none";
      $("work").style.display = "flex";
      $("who").textContent = `✓ ${npub.slice(0, 16)}… logged in`;
      log("logged in. Loading your products and library…");
      await Promise.all([loadProducts(), loadLibrary()]);
    } catch (e) {
      log("✗ " + (e as Error).message);
    } finally {
      ($("confirm") as HTMLButtonElement).disabled = false;
    }
  };

  // ---- products (merchant session) + library (MCP) -------------------------
  let PRODUCTS: Rec[] = [];
  const loadProducts = async () => {
    try {
      let list = rowsOf(await query("products.getAllProducts", { page: 1, pageSize: 100, sorting: [] }));
      if (!list.length) list = rowsOf(await query("products.getAllProducts", { page: 0, pageSize: 100, sorting: [] }));
      PRODUCTS = list;
      const sel = $("prod") as HTMLSelectElement;
      const keep = sel.selectedIndex;
      sel.length = 0;
      list.forEach((p, i) => sel.add(new Option(labelOf(p), String(i))));
      sel.selectedIndex = keep >= 0 && keep < list.length ? keep : 0;
      ($("stash") as HTMLButtonElement).disabled = !list.length;
      renderLibrary();
      log(`${list.length} products loaded.`);
    } catch (e) {
      log("✗ products: " + (e as Error).message);
    }
  };
  $("r").onclick = () => void Promise.all([loadProducts(), loadLibrary()]);

  let LIBRARY: StoredDesignMeta[] = [];

  // Render the library as a browsable list — one row per design, each with its
  // own Apply and Delete. The courier is the only UX for these, so it carries
  // the full lifecycle.
  const renderLibrary = () => {
    const box = $("lib");
    box.textContent = "";
    $("libn").textContent = LIBRARY.length ? `(${LIBRARY.length})` : "";
    if (!LIBRARY.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "No saved designs yet — send a product's design up with the button above.";
      box.appendChild(e);
      return;
    }
    for (const d of LIBRARY) {
      const item = document.createElement("div");
      item.className = "item";
      const nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = d.label || d.source_title || d.design_id.slice(0, 8);
      nm.title = d.label || d.source_title || d.design_id;   // full label on hover — the tail isn't lost to wrap
      const mt = document.createElement("div");
      mt.className = "mt";
      const when = d.updated_at ? String(d.updated_at).slice(0, 10) : "";
      const src = d.source_title && d.source_title !== d.label ? `from ${d.source_title}` : "";
      const kb = d.bytes ? `${Math.round(d.bytes / 1024)} KB` : "";
      mt.textContent = [src, when, kb].filter(Boolean).join(" · ");
      // The design_id is the repo folder backing this entry (designs/<id>/) — a stable
      // disambiguator when two labels differ only by a trailing parenthetical.
      const idl = document.createElement("div");
      idl.className = "id";
      idl.textContent = d.path || `designs/${d.design_id}/`;
      idl.title = "Repo path backing this design";
      if (d.short_sha) {
        // The latest commit is this design's version handle — link it through to
        // GitHub so the merchant can correlate the chooser against real history.
        idl.append(document.createTextNode(" · "));
        if (d.commit_url) {
          const a = document.createElement("a");
          a.className = "sha";
          a.href = d.commit_url;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = d.short_sha;
          a.title = "Open this design's latest commit on GitHub";
          idl.appendChild(a);
        } else {
          idl.append(document.createTextNode(d.short_sha));
        }
      }
      const ax = document.createElement("div");
      ax.className = "ax";
      const applyBtn = document.createElement("button");
      applyBtn.className = "gh";
      applyBtn.innerHTML = OCTO + "Fetch";
      applyBtn.title = "Fetch this design from GitHub onto the selected product";
      applyBtn.disabled = !PRODUCTS.length;
      applyBtn.onclick = () => fetchFlow(d);
      const delBtn = document.createElement("button");
      delBtn.className = "danger";
      delBtn.textContent = "🗑";
      delBtn.title = "Delete this design's folder from GitHub";
      delBtn.onclick = () => deleteDesign(d);
      ax.append(applyBtn, delBtn);
      item.append(nm, mt, idl, ax);
      box.appendChild(item);
    }
  };

  // Replace the list with a single status row — the box is the merchant's only
  // window on the library, so loading/error must be visible here, not just in the
  // log. An error row is distinguishable from an empty library and offers a retry.
  const showLibStatus = (kind: "loading" | "error", text: string) => {
    const box = $("lib");
    box.textContent = "";
    $("libn").textContent = "";
    const row = document.createElement("div");
    row.className = kind === "loading" ? "load" : "err";
    if (kind === "loading") {
      const s = document.createElement("span");
      s.className = "spin";
      row.append(s, document.createTextNode(text));
    } else {
      row.textContent = text;
      const retry = document.createElement("button");
      retry.className = "alt";
      retry.textContent = "Retry";
      retry.onclick = () => void loadLibrary();
      row.appendChild(retry);
    }
    box.appendChild(row);
  };

  const loadLibrary = async () => {
    showLibStatus("loading", "Loading designs…");
    try {
      const r = await api.list();
      if (r.success === false) {
        showLibStatus("error", "Couldn't load your library: " + (r.error || "unavailable"));
        return;
      }
      LIBRARY = r.designs || [];
      renderLibrary();
      log(`${LIBRARY.length} design${LIBRARY.length === 1 ? "" : "s"} in your library.`);
    } catch (e) {
      showLibStatus("error", "Couldn't load your library: " + (e as Error).message);
    }
  };

  const getProductById = async (id: string): Promise<Rec | null> => {
    try {
      const r = await query("products.getProductById", { productId: id });
      return r && typeof r === "object" ? (r as Rec) : null;
    } catch { return null; }
  };

  // Write a design's stored description onto the target product. This is a
  // READ-MODIFY-WRITE: updateStoreMetadata replaces the whole store-page record, so
  // we echo the product's own name/retailPrice/storeMetadata back and change only the
  // description. Guarded and best-effort: if we can't read name+price we skip rather
  // than risk zeroing them, and once Shopify owns the product the write may be locked —
  // we log and move on so the design still lands.
  const applyDescription = async (target: Rec, description: string): Promise<void> => {
    if (!description) return;
    const full = await getProductById(idOf(target));
    // updateStoreMetadata is a read-modify-write: Roastify's product carries its name
    // as `productName` (not title/name) and has NO top-level price — the store price is
    // max(variants[].retailPrice), in integer cents. Echo those and change only the
    // description. Guarded: skip rather than risk wiping name/price if we can't read them.
    const pname = typeof full?.productName === "string" ? full.productName : null;
    const variants = Array.isArray(full?.variants) ? (full.variants as Rec[]) : [];
    const prices = variants.map((v) => Number((v as Rec).retailPrice) || 0).filter((n) => n > 0);
    const price = prices.length ? Math.max(...prices) : null;
    if (!full || pname === null || price === null) {
      const why = !full ? "no product" : pname === null ? "no productName" : "no variant price";
      log(`  · description not applied (couldn't read the product's store fields: ${why}).`);
      return;
    }
    try {
      await mutate("products.updateStoreMetadata", {
        productId: idOf(target),
        name: pname,
        description,
        retailPrice: price,
        storeMetadata: (full.storeMetadata as Rec) ?? {},
      });
      log("  ✓ store description applied.");
    } catch {
      log("  · store description is locked (likely synced to Shopify) — left unchanged.");
    }
  };

  const SEMVER = /^\d+\.\d+\.\d+$/;
  const semverValidate = (v: string): string =>
    SEMVER.test(v) ? "" : "Use MAJOR.MINOR.PATCH, e.g. 1.2.3 (no 'v').";

  interface ModalField {
    key: string; label: string; placeholder?: string; hint?: string;
    multiline?: boolean; validate?: (v: string) => string;
  }
  // One in-panel modal: consequence lines, optional fields (validated), and
  // Confirm/Cancel. Resolves to the field values (an empty object when there are no
  // fields), or null on cancel. Replaces the confirm()/prompt() stack.
  const modalForm = (opts: { title: string; lines: string[]; fields?: ModalField[]; confirmLabel?: string }):
    Promise<Record<string, string> | null> =>
    new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.className = "ovl";
      const box = document.createElement("div");
      box.className = "ovlbox";
      const h = document.createElement("div");
      h.className = "ovlh";
      h.textContent = opts.title;
      box.appendChild(h);
      for (const ln of opts.lines) {
        const d = document.createElement("div");
        d.className = "fline";
        d.textContent = ln;
        box.appendChild(d);
      }
      const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
      const errs: Record<string, HTMLElement> = {};
      const fields = opts.fields ?? [];
      for (const f of fields) {
        const lab = document.createElement("label");
        lab.textContent = f.label;
        box.appendChild(lab);
        const inp = f.multiline ? document.createElement("textarea") : document.createElement("input");
        if (f.placeholder) inp.placeholder = f.placeholder;
        inp.setAttribute("autocapitalize", "off");
        inp.spellcheck = false;
        box.appendChild(inp);
        inputs[f.key] = inp;
        if (f.hint) {
          const hn = document.createElement("div");
          hn.className = "fhint";
          hn.textContent = f.hint;
          box.appendChild(hn);
        }
        const er = document.createElement("div");
        er.className = "ferr";
        box.appendChild(er);
        errs[f.key] = er;
      }
      const row = document.createElement("div");
      row.className = "frow";
      const cancel = document.createElement("button");
      cancel.className = "alt";
      cancel.textContent = "Cancel";
      const ok = document.createElement("button");
      ok.textContent = opts.confirmLabel ?? "Confirm";
      row.append(cancel, ok);
      box.appendChild(row);
      const done = (v: Record<string, string> | null) => { ov.remove(); resolve(v); };
      cancel.onclick = () => done(null);
      ok.onclick = () => {
        const out: Record<string, string> = {};
        let bad = false;
        for (const f of fields) {
          const val = inputs[f.key].value.trim();
          const e = f.validate ? f.validate(val) : (val ? "" : "Required.");
          errs[f.key].textContent = e;
          if (e) bad = true;
          else out[f.key] = val;
        }
        if (!bad) done(out);
      };
      ov.appendChild(box);
      (sh.querySelector(".p") as HTMLElement).appendChild(ov);
      (fields.length ? inputs[fields[0].key] : ok).focus();
    });

  // Send this product's design UP to the library.
  $("stash").onclick = async () => {
    const p = PRODUCTS[+val("prod")];
    if (!p) return;
    if (!p.designJson) { log("✗ product has no saved design"); return; }
    const form = await modalForm({
      title: `Commit “${labelOf(p)}”`,
      lines: [
        "Saves a NEW VERSION to your GitHub library of:",
        "  • the product's current design",
        "  • its store-page description",
        "Commits to GitHub only — nothing on Roastify or Shopify changes.",
      ],
      fields: [
        { key: "message", label: "Commit message", placeholder: "what changed", multiline: true },
        { key: "tag", label: "Version (semver)", placeholder: "1.2.3",
          hint: "MAJOR.MINOR.PATCH, no 'v' — must be unique for this design", validate: semverValidate },
      ],
      confirmLabel: "⬆ Commit",
    });
    if (!form) { log("commit cancelled."); return; }
    ($("stash") as HTMLButtonElement).disabled = true;
    log(`reading “${labelOf(p)}”…`);
    try {
      const design = await readDesign(p.designJson);
      const full = await getProductById(idOf(p));
      const description = String(full?.description ?? "");
      log(`committing ${JSON.stringify(design).length.toLocaleString()} bytes as “${form.tag}”…`);
      const r = await api.stash(design, {
        label: labelOf(p),
        productId: idOf(p),
        sourceTitle: labelOf(p),
        description,
        commitMessage: form.message,
        versionTag: form.tag,
      });
      if (!r.success) { log("✗ " + (r.error || "stash failed")); return; }
      log(`✓ stashed (${r.assets} image(s) deduped). Edit it in the Design Bench.`);
      await loadLibrary();
    } catch (e) {
      log("✗ " + (e as Error).message);
    } finally {
      ($("stash") as HTMLButtonElement).disabled = false;
    }
  };

  // Fetch a library design and WRITE it onto the selected product. The target's
  // own preview/mockups are reused; the Designer re-renders on open.
  const applyDesign = async (meta: StoredDesignMeta, ref = "", picked: StoredVersion | null = null) => {
    const target = PRODUCTS[+val("prod")];
    if (!target) { log("✗ pick a product first."); return; }
    if (!target.designImageUrl) {
      log(`✗ “${labelOf(target)}” has no saved design yet — open it once in the Designer first.`);
      return;
    }
    const name = meta.label || meta.design_id.slice(0, 8);
    const ver = picked
      ? `version ${picked.tag || picked.short_sha} (${String(picked.date || "").slice(0, 10)})`
      : "the latest version";
    const hasDesc = !!(meta.description && meta.description.trim());
    const proceed = await modalForm({
      title: `Fetch “${name}” onto “${labelOf(target)}”`,
      lines: [
        `Applying ${ver}. This OVERWRITES on the product:`,
        "  • its design (open the Designer to see it render)",
        hasDesc
          ? "  • its store-page description — skipped if Shopify has locked it"
          : "  (no saved description travels with this design)",
        "This changes the product on Roastify.",
      ],
      confirmLabel: "⬇ Fetch",
    });
    if (!proceed) return;
    log(`applying “${name}” (${ver}) → “${labelOf(target)}”…`);
    try {
      const r = await api.fetch(meta.design_id, ref);
      if (!r.success || !r.design) { log("✗ " + (r.error || "fetch failed")); return; }
      const design = r.design;
      const jsonKey = `design-json/${rid()}.json`;
      const put = (await mutate("aws.getPresignedUrl", {
        filename: jsonKey, filetype: "application/json",
      })) as string;
      const up = await fetch(put, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(design),
      });
      if (!up.ok) throw new Error("json upload HTTP " + up.status);
      const preview = asset(target.designImageUrl);
      const imageUrls = mockupsOf(target).map(asset);
      if (!imageUrls.length) imageUrls.push(preview);
      await mutate("products.updateDesign", {
        productId: idOf(target), cleanJsonUrl: STORAGE + jsonKey, s3KeyJson: jsonKey,
        cleanImageUrl: preview.imageUrl, s3KeyImage: preview.s3Key, imageUrls,
      });
      log(`✓ applied “${name}”. Open “${labelOf(target)}” in the Designer to see it render.`);
      await applyDescription(target, String(r.description ?? ""));
    } catch (e) {
      log("✗ " + (e as Error).message);
    }
  };

  // Modal over the panel: pick which committed version to fetch. Resolves to the
  // chosen version, or null if cancelled.
  const pickVersion = (versions: StoredVersion[]): Promise<StoredVersion | null> =>
    new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.className = "ovl";
      const box = document.createElement("div");
      box.className = "ovlbox";
      const h = document.createElement("div");
      h.className = "ovlh";
      h.textContent = "Pick a version to fetch";
      box.appendChild(h);
      const done = (v: StoredVersion | null) => { ov.remove(); resolve(v); };
      for (const v of versions) {
        const row = document.createElement("button");
        row.className = "vrow";
        const top = document.createElement("span");
        top.className = "vtop";
        top.textContent = v.date ? String(v.date).slice(0, 10) : "(undated)";
        if (v.tag) {
          const t = document.createElement("span");
          t.className = "vtag";
          t.textContent = `  [${v.tag}]`;
          top.appendChild(t);
        }
        const msg = document.createElement("span");
        msg.className = "vmsg";
        msg.textContent = (v.message || "").split("\n")[0];
        const sha = document.createElement("span");
        sha.className = "vsha";
        sha.textContent = v.short_sha;
        row.append(top, msg, sha);
        row.onclick = () => done(v);
        box.appendChild(row);
      }
      const cancel = document.createElement("button");
      cancel.className = "alt";
      cancel.textContent = "Cancel";
      cancel.onclick = () => done(null);
      box.appendChild(cancel);
      ov.appendChild(box);
      (sh.querySelector(".p") as HTMLElement).appendChild(ov);
    });

  // Fetch entry point: offer a version picker when a design has more than one
  // committed version, then apply the chosen one (latest if there's only one).
  const fetchFlow = async (meta: StoredDesignMeta) => {
    if (!PRODUCTS[+val("prod")]) { log("✗ pick a product first."); return; }
    let ref = "";
    let picked: StoredVersion | null = null;
    try {
      const lv = await api.listVersions(meta.design_id);
      const versions = lv.versions || [];
      if (versions.length > 1) {
        picked = await pickVersion(versions);
        if (!picked) { log("fetch cancelled."); return; }
        ref = picked.sha;
      }
    } catch (e) {
      log("✗ versions: " + (e as Error).message);
      return;
    }
    await applyDesign(meta, ref, picked);
  };

  // Delete a design from the MCP library. The courier is the only UX for the
  // library, so this is where a design's life ends. Confirm first.
  const deleteDesign = async (meta: StoredDesignMeta) => {
    const name = meta.label || meta.design_id.slice(0, 8);
    const ok = await modalForm({
      title: `Delete “${name}”`,
      lines: [
        "Removes the saved design from your GitHub library.",
        "It does not touch any product on Roastify or Shopify.",
      ],
      confirmLabel: "🗑 Delete",
    });
    if (!ok) return;
    log(`deleting “${name}”…`);
    try {
      const r = await api.del(meta.design_id);
      if (r.success === false && !r.deleted) { log("✗ " + (r.error || "delete failed")); return; }
      log(`✓ deleted “${name}”.`);
      await loadLibrary();
    } catch (e) {
      log("✗ " + (e as Error).message);
    }
  };

  // Already logged in on this origin? Skip straight to work.
  if (store.npub() && store.proof()) {
    $("login").style.display = "none";
    $("work").style.display = "flex";
    $("who").textContent = `✓ ${store.npub().slice(0, 16)}… logged in`;
    log("logged in. Loading your products and library…");
    void Promise.all([loadProducts(), loadLibrary()]);
  }
}
