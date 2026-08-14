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
import { api, store, type StoredDesignMeta } from "./mcp-lite";

type Rec = Record<string, unknown>;

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
      .p{position:fixed;top:16px;right:16px;z-index:2147483647;width:min(420px,calc(100vw - 24px));
        font-family:ui-monospace,Menlo,monospace;color:#e8ece6;background:#171b1a;
        border:1px solid #2c3432;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);
        display:flex;flex-direction:column;max-height:calc(100vh - 32px)}
      .p.big{width:min(680px,calc(100vw - 24px))}
      .h{display:flex;align-items:center;gap:6px;padding:10px 14px;background:#0d100f;
        cursor:move;user-select:none;flex:0 0 auto;border-radius:12px 12px 0 0}
      .h b{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#4fbfc0;flex:1}
      .h .ic{cursor:pointer;color:#828d86;font-size:16px;line-height:1;padding:3px 6px}
      .h .ic:hover{color:#e8ece6}
      .b{padding:14px;display:flex;flex-direction:column;gap:12px;overflow:auto}
      label{font-size:11px;color:#828d86;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em}
      input,select,button{font:inherit;box-sizing:border-box}
      input,select{width:100%;background:#101312;color:#e8ece6;border:1px solid #2c3432;border-radius:8px;padding:9px;font-size:14px}
      button{background:#0d7c7f;color:#0b1211;border:0;border-radius:8px;padding:10px;font-weight:700;cursor:pointer}
      button.wide{width:100%}
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
      .item .ax{display:flex;gap:8px;margin-top:9px}
      .item .ax button{flex:1;padding:8px}
      .empty{color:#828d86;font-size:12px;padding:6px 0}
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
            <div><label>Product</label><select id="prod"></select></div>
            <button class="wide" id="stash" disabled>&#x2B06; Send this product's design to Library</button>
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
  $("exp").onclick = () => (sh.querySelector(".p") as HTMLElement).classList.toggle("big");

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
      const mt = document.createElement("div");
      mt.className = "mt";
      const when = d.updated_at ? String(d.updated_at).slice(0, 10) : "";
      const src = d.source_title && d.source_title !== d.label ? `from ${d.source_title}` : "";
      const kb = d.bytes ? `${Math.round(d.bytes / 1024)} KB` : "";
      mt.textContent = [src, when, kb].filter(Boolean).join(" · ");
      const ax = document.createElement("div");
      ax.className = "ax";
      const applyBtn = document.createElement("button");
      applyBtn.textContent = "⬇ Apply";
      applyBtn.disabled = !PRODUCTS.length;
      applyBtn.onclick = () => applyDesign(d);
      const delBtn = document.createElement("button");
      delBtn.className = "danger";
      delBtn.textContent = "🗑 Delete";
      delBtn.onclick = () => deleteDesign(d);
      ax.append(applyBtn, delBtn);
      item.append(nm, mt, ax);
      box.appendChild(item);
    }
  };

  const loadLibrary = async () => {
    try {
      const r = await api.list();
      if (r.success === false) { log("✗ library: " + (r.error || "unavailable")); return; }
      LIBRARY = r.designs || [];
      renderLibrary();
      log(`${LIBRARY.length} design${LIBRARY.length === 1 ? "" : "s"} in your library.`);
    } catch (e) {
      log("✗ library: " + (e as Error).message);
    }
  };

  // Send this product's design UP to the library.
  $("stash").onclick = async () => {
    const p = PRODUCTS[+val("prod")];
    if (!p) return;
    if (!p.designJson) { log("✗ product has no saved design"); return; }
    ($("stash") as HTMLButtonElement).disabled = true;
    log(`reading “${labelOf(p)}”…`);
    try {
      const design = await readDesign(p.designJson);
      log(`stashing ${JSON.stringify(design).length.toLocaleString()} bytes…`);
      const r = await api.stash(design, {
        label: labelOf(p),
        productId: idOf(p),
        sourceTitle: labelOf(p),
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
  const applyDesign = async (meta: StoredDesignMeta) => {
    const target = PRODUCTS[+val("prod")];
    if (!target) { log("✗ pick a product first."); return; }
    if (!target.designImageUrl) {
      log(`✗ “${labelOf(target)}” has no saved design yet — open it once in the Designer first.`);
      return;
    }
    const name = meta.label || meta.design_id.slice(0, 8);
    log(`applying “${name}” → “${labelOf(target)}”…`);
    try {
      const r = await api.fetch(meta.design_id);
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
    } catch (e) {
      log("✗ " + (e as Error).message);
    }
  };

  // Delete a design from the MCP library. The courier is the only UX for the
  // library, so this is where a design's life ends. Confirm first.
  const deleteDesign = async (meta: StoredDesignMeta) => {
    const name = meta.label || meta.design_id.slice(0, 8);
    if (!confirm(`Delete “${name}” from your design library?\n\nThis only removes the saved design — it does not touch any product.`)) return;
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
