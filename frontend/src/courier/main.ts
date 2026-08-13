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
  const labelOf = (p: Rec): string => String(p.title || p.name || idOf(p));
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
      .p{position:fixed;top:16px;right:16px;z-index:2147483647;width:340px;
        font-family:ui-monospace,Menlo,monospace;color:#e8ece6;background:#171b1a;
        border:1px solid #2c3432;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.5);overflow:hidden}
      .h{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#0d100f;cursor:move;user-select:none}
      .h b{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#4fbfc0}
      .h .ic{margin-left:auto;cursor:pointer;color:#828d86;font-size:15px;line-height:1;padding:2px 4px}
      .h .ic:hover{color:#e8ece6}
      .b{padding:12px;display:flex;flex-direction:column;gap:10px}
      label{font-size:11px;color:#828d86;display:block;margin-bottom:3px}
      input,select,button{font:inherit;width:100%;box-sizing:border-box}
      input,select{background:#101312;color:#e8ece6;border:1px solid #2c3432;border-radius:6px;padding:7px}
      button{background:#0d7c7f;color:#0b1211;border:0;border-radius:6px;padding:9px;font-weight:700;cursor:pointer}
      button.alt{background:#3B4248;color:#e8ece6}
      button:disabled{opacity:.5;cursor:default}
      .row{display:flex;gap:8px}
      .warn{color:#dca63f;font-size:11px}
      .ok{color:#4fbfc0;font-size:11px}
      hr{border:0;border-top:1px solid #2c3432;margin:2px 0}
      pre{margin:0;background:#0d100f;border:1px solid #2c3432;border-radius:6px;padding:8px;
        font-size:11px;line-height:1.5;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word}
    </style>
    <div class="p">
      <div class="h" id="hd"><b>Design courier</b><span class="ic" id="x" title="Close">&#x2715;</span></div>
      <div class="b">
        <div id="login">
          <label>Log in to Roastify MCP with your npub</label>
          <input id="npub" placeholder="npub1…" autocapitalize="off" autocorrect="off" spellcheck="false" />
          <div class="row" style="margin-top:8px"><button id="send">Send login DM</button></div>
          <div id="await" style="display:none;margin-top:8px">
            <div class="warn">Reply to the Nostr DM with any phrase, then:</div>
            <button id="confirm" style="margin-top:6px">I replied — confirm</button>
          </div>
        </div>
        <div id="work" style="display:none">
          <div class="ok" id="who"></div>
          <hr/>
          <div><label>Product</label><select id="prod"></select></div>
          <button id="stash" disabled>Send this design → library</button>
          <hr/>
          <div><label>Library design</label><select id="lib"></select></div>
          <button id="apply" class="alt" disabled>Apply library design → this product</button>
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
      $("work").style.display = "block";
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
      ($("apply") as HTMLButtonElement).disabled = !list.length || !($("lib") as HTMLSelectElement).length;
      log(`${list.length} products loaded.`);
    } catch (e) {
      log("✗ products: " + (e as Error).message);
    }
  };

  let LIBRARY: StoredDesignMeta[] = [];
  const loadLibrary = async () => {
    try {
      const r = await api.list();
      if (r.success === false) { log("✗ library: " + (r.error || "unavailable")); return; }
      LIBRARY = r.designs || [];
      const sel = $("lib") as HTMLSelectElement;
      sel.length = 0;
      LIBRARY.forEach((d, i) =>
        sel.add(new Option(`${d.label || d.source_title || d.design_id.slice(0, 8)} (${d.product_id || "—"})`, String(i))),
      );
      ($("apply") as HTMLButtonElement).disabled = !LIBRARY.length || !PRODUCTS.length;
      log(`${LIBRARY.length} designs in your library.`);
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
  $("apply").onclick = async () => {
    const target = PRODUCTS[+val("prod")];
    const meta = LIBRARY[+val("lib")];
    if (!target || !meta) return;
    if (!target.designImageUrl) {
      log("✗ target has no existing design image — open it once in the Designer first.");
      return;
    }
    ($("apply") as HTMLButtonElement).disabled = true;
    log(`fetching “${meta.label || meta.design_id.slice(0, 8)}”…`);
    try {
      const r = await api.fetch(meta.design_id);
      if (!r.success || !r.design) { log("✗ " + (r.error || "fetch failed")); return; }
      const design = r.design;
      log(`uploading design onto “${labelOf(target)}”…`);
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
      log(`✓ applied. Open “${labelOf(target)}” in the Designer to see it render.`);
    } catch (e) {
      log("✗ " + (e as Error).message);
    } finally {
      ($("apply") as HTMLButtonElement).disabled = false;
    }
  };

  // Already logged in on this origin? Skip straight to work.
  if (store.npub() && store.proof()) {
    $("login").style.display = "none";
    $("work").style.display = "block";
    $("who").textContent = `✓ ${store.npub().slice(0, 16)}… logged in`;
    log("logged in. Loading your products and library…");
    void Promise.all([loadProducts(), loadLibrary()]);
  }
}
