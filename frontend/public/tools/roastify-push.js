/* roastify-push.js — an operator utility, injected into merchant.roastify.app.
 *
 * Roastify's Design Studio talks a private tRPC API (/api/trpc) authenticated by
 * a Clerk SESSION COOKIE, not the public API key — so it can only be driven from
 * inside the merchant origin, on your own login. This file is loaded there by a
 * bookmarklet and renders its own panel, so it needs no dev console and works on
 * an iPad. It copies one saved design onto another product using the same calls
 * the Save button makes. The source is read-only.
 *
 * It is deliberately NOT part of the patron Design Bench: that app is BYO-key and
 * patron-facing; this is operator-only. They share a host for convenience, nothing
 * more.
 */
(() => {
  if (location.host !== "merchant.roastify.app") {
    alert("Open this on merchant.roastify.app (signed in), then tap the bookmarklet there.");
    return;
  }
  // Re-tap = fresh panel. Remove any prior instance and rebuild so a re-tap
  // re-reads the product list (needed to see a design just pushed).
  const prior = document.getElementById("rpush-host");
  if (prior) prior.remove();

  // ---- tRPC (superjson, non-batched; queries GET, mutations POST) ------------
  const unwrap = async (res, path) => {
    const b = await res.json().catch(() => ({}));
    if (!res.ok || b.error) throw new Error(`${path}: ${b?.error?.json?.message || b?.error?.message || "HTTP " + res.status}`);
    return b?.result?.data?.json;
  };
  const query = (path, input = {}) =>
    fetch(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
      { method: "GET", credentials: "include" }).then((r) => unwrap(r, path));
  const mutate = (path, input) =>
    fetch(`/api/trpc/${path}`, { method: "POST", credentials: "include",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ json: input }) }).then((r) => unwrap(r, path));
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
  const STORAGE = "https://storage.roastify.app/";
  // Reuse an existing storage URL by deriving its key. We do NOT re-download the
  // source images to re-upload them: that is a cross-origin fetch to
  // storage.roastify.app, which the browser blocks ("Load failed"). Pointing the
  // target at the source's existing image objects avoids the fetch entirely and
  // still makes the target visibly show the source's design.
  const asset = (url) => ({ s3Key: (typeof url === "string" ? url.replace(/^https?:\/\/storage\.roastify\.app\//, "") : ""), imageUrl: url });

  // Populate the design's fonts[] from the fonts its text actually uses. Roastify's
  // current Designer loads fonts FROM this array; older designs left it empty and so
  // render with a fallback. This writes the same {family, weights, url} shape their
  // templates use, adding only families not already declared.
  const wnum = (v) => (typeof v === "number" ? v : ({ bold: 700, normal: 400 })[String(v || "").toLowerCase()] ?? 400);
  const buildFonts = (design) => {
    const used = {};
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.type === "text" && n.fontFamily) (used[n.fontFamily] = used[n.fontFamily] || new Set()).add(wnum(n.fontWeight)); Object.values(n).forEach(walk); } };
    walk(design.pages || design);
    const have = new Set((design.fonts || []).map((f) => f.family));
    const added = [];
    for (const fam of Object.keys(used)) {
      if (have.has(fam)) continue;
      const weights = [...used[fam]].sort((a, b) => a - b);
      added.push({ family: fam, weights, url: `https://fonts.googleapis.com/css2?family=${fam.replace(/ /g, "+")}:wght@${weights.join(";")}&display=swap` });
    }
    design.fonts = [...(design.fonts || []), ...added];
    return added.length;
  };
  const rowsOf = (r) => (Array.isArray(r) ? r : r?.products ?? r?.items ?? r?.data ?? r?.rows ?? []);
  const idOf = (p) => p.id ?? p.editProductId ?? p.productId ?? p._id;
  const mockupsOf = (p) =>
    (p.mockupImages ?? p.imageUrls ?? (p.images ? p.images.map((i) => i.url ?? i.imageUrl ?? i) : null) ??
      (p.designImageUrl ? [p.designImageUrl] : []))
      .map((m) => (typeof m === "string" ? m : m.imageUrl ?? m.url)).filter(Boolean);

  // ---- panel (shadow DOM so the merchant page's CSS can't touch it) ----------
  const host = document.createElement("div");
  host.id = "rpush-host";
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
      .h .x{margin-left:auto;cursor:pointer;color:#828d86;font-size:16px;line-height:1}
      .b{padding:12px;display:flex;flex-direction:column;gap:10px}
      label{font-size:11px;color:#828d86;display:block;margin-bottom:3px}
      select,button{font:inherit;width:100%;box-sizing:border-box}
      select{background:#101312;color:#e8ece6;border:1px solid #2c3432;border-radius:6px;padding:7px}
      button{background:#0d7c7f;color:#0b1211;border:0;border-radius:6px;padding:9px;font-weight:700;cursor:pointer}
      button:disabled{opacity:.5;cursor:default}
      .warn{color:#dca63f;font-size:11px}
      pre{margin:0;background:#0d100f;border:1px solid #2c3432;border-radius:6px;padding:8px;
        font-size:11px;line-height:1.5;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word}
      a{color:#4fbfc0}
    </style>
    <div class="p">
      <div class="h" id="hd"><b>Push design</b><span class="x" id="x">×</span></div>
      <div class="b">
        <div><label>Copy the design FROM</label><select id="src"></select></div>
        <div><label>ONTO (this product is overwritten)</label><select id="dst"></select></div>
        <button id="go" disabled>Loading products…</button>
        <button id="insp" style="background:#3B4248;color:#e8ece6">Inspect source’s fonts</button>
        <div class="warn" id="warn"></div>
        <pre id="log">ready.</pre>
      </div>
    </div>`;
  const $ = (id) => sh.getElementById(id);
  const log = (m) => { $("log").textContent += "\n" + m; $("log").scrollTop = 1e9; };
  $("x").onclick = () => host.remove();
  $("x").onpointerup = (e) => { e.stopPropagation(); host.remove(); };

  // drag
  (() => { let dx = 0, dy = 0, on = false; const p = sh.querySelector(".p"), h = $("hd");
    h.onpointerdown = (e) => { if (e.target && e.target.id === "x") return; on = true; dx = e.clientX - p.offsetLeft; dy = e.clientY - p.offsetTop; h.setPointerCapture(e.pointerId); };
    h.onpointermove = (e) => { if (!on) return; p.style.left = e.clientX - dx + "px"; p.style.top = e.clientY - dy + "px"; p.style.right = "auto"; };
    h.onpointerup = () => { on = false; }; })();

  let PRODUCTS = [];
  const label = (p) => (p.title || p.name || idOf(p));

  (async () => {
    try {
      let list = rowsOf(await query("products.getAllProducts", { page: 1, pageSize: 100, sorting: [] }));
      if (!list.length) list = rowsOf(await query("products.getAllProducts", { page: 0, pageSize: 100, sorting: [] }));
      PRODUCTS = list;
      if (!list.length) { $("go").textContent = "no products found"; return; }
      for (const [i, p] of list.entries()) {
        const o1 = new Option(label(p), i), o2 = new Option(label(p), i);
        $("src").add(o1); $("dst").add(o2);
      }
      $("dst").selectedIndex = Math.min(1, list.length - 1);
      $("go").disabled = false; $("go").textContent = "Copy design →";
      log(`${list.length} products loaded.`);
    } catch (e) { $("go").textContent = "load failed"; log("✗ " + e.message); }
  })();

  $("insp").onclick = () => {
    const p = PRODUCTS[+$("src").value];
    if (!p) return;
    $("log").textContent = `inspecting “${label(p)}” font spec`;
    const dj = p.designJson;
    if (typeof dj === "string" && /^https?:/.test(dj)) { log("designJson is a URL (not inline): " + dj); return; }
    let d; try { d = typeof dj === "object" ? dj : JSON.parse(dj); } catch { d = null; }
    if (!d) { log("could not read designJson; keys: " + Object.keys(p).join(", ")); return; }
    log("root fonts[] : " + JSON.stringify(d.fonts || []).slice(0, 600));
    const texts = [];
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.type === "text") texts.push(n); Object.values(n).forEach(walk); } };
    walk(d.pages || d);
    log(`${texts.length} text layers. sample font props:`);
    for (const t of texts.slice(0, 5)) {
      const fp = { family: t.fontFamily, weight: t.fontWeight, style: t.fontStyle,
        src: t.fontURL || t.fontSrc || t.src || t.url || undefined };
      log(`  "${String(t.text || "").replace(/\s+/g, " ").slice(0, 20)}" → ${JSON.stringify(fp)}`);
    }
  };

  $("go").onclick = async () => {
    const source = PRODUCTS[+$("src").value], target = PRODUCTS[+$("dst").value];
    $("warn").textContent = "";
    if (!source || !target) return;
    if (idOf(source) === idOf(target)) { $("warn").textContent = "Source and target are the same product."; return; }
    $("go").disabled = true;
    $("log").textContent = `copying “${label(source)}” → “${label(target)}”`;
    try {
      if (!source.designJson) throw new Error("source has no designJson");
      if (!source.designImageUrl) throw new Error("source has no designImageUrl");
      const targetId = idOf(target);

      log("reading source design…");
      const dj = source.designJson;
      const design = typeof dj === "object" ? dj : /^https?:/.test(dj) ? await fetch(dj).then((r) => r.json()) : JSON.parse(dj);
      log(`design ${JSON.stringify(design).length.toLocaleString()} bytes.`);
      const nf = buildFonts(design);
      log(`fonts[] repaired: +${nf} (now ${design.fonts.length} declared)`);

      log("uploading a copy of the JSON…");
      const jsonKey = `design-json/${rid()}.json`;
      const jput = await mutate("aws.getPresignedUrl", { filename: jsonKey, filetype: "application/json" });
      const ju = await fetch(jput, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(design) });
      if (!ju.ok) throw new Error("json upload HTTP " + ju.status);

      log("using source preview + mockups…");
      const preview = asset(source.designImageUrl);
      const imageUrls = mockupsOf(source).map(asset);
      if (!imageUrls.length) imageUrls.push(preview);

      log("writing updateDesign…");
      await mutate("products.updateDesign", {
        productId: targetId, cleanJsonUrl: STORAGE + jsonKey, s3KeyJson: jsonKey,
        cleanImageUrl: preview.imageUrl, s3KeyImage: preview.s3Key, imageUrls,
      });

      const after = await query("products.getProductById", { productId: targetId });
      log("✓ done. target preview now:");
      log(after?.designImageUrl || "(unchanged?)");
      log("Open the target in the designer to see it render.");
    } catch (e) { log("✗ " + e.message); }
    finally { $("go").disabled = false; }
  };
})();
