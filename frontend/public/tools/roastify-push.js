/* roastify-push.js — an operator utility, injected into merchant.roastify.app.
 *
 * Roastify's Design Studio talks a private tRPC API (/api/trpc) authenticated by
 * a Clerk SESSION COOKIE, not the public API key — so it can only be driven from
 * inside the merchant origin, on your own login. A bookmarklet loads it here and
 * it renders its own panel: no dev console, works on an iPad. The source design
 * is read-only; the target is overwritten.
 *
 * Everything is done in-panel — including a Refresh button — so you never need to
 * re-tap the bookmarklet (iOS Safari often ignores a second tap on the same page).
 */
(() => {
  if (location.host !== "merchant.roastify.app") {
    alert("Open this on merchant.roastify.app (signed in), then tap the bookmarklet there.");
    return;
  }
  const prior = document.getElementById("rpush-host");
  if (prior) prior.remove(); // a fresh tap rebuilds cleanly

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
  const asset = (url) => ({ s3Key: typeof url === "string" ? url.replace(/^https?:\/\/storage\.roastify\.app\//, "") : "", imageUrl: url });

  // Rebuild a design's fonts[] to declare exactly the families its text uses.
  //
  // Roastify migrated their design format (Polotno `pages`, schemaVersion 2 →
  // their own `elements`/`faceBackgrounds`), and their saved designs key each
  // font entry `family` — so we match the app's own output, not the Polotno
  // store's `fontFamily`. We REBUILD rather than append: a stale/invalid entry
  // (e.g. the migration wrote Fjalla One as :wght@700, a weight it doesn't ship)
  // must not survive, because one url that 404s makes the Designer's font-load
  // batch reject and blanks EVERY font. And we ASK Google Fonts whether the
  // requested weights resolve, falling back to the plain family (always loads,
  // bold degrades to synthetic) when a weight is missing.
  const wnum = (v) => (typeof v === "number" ? v : ({ bold: 700, bolder: 700, normal: 400, lighter: 300 })[String(v || "").toLowerCase()] ?? (parseInt(v, 10) || 400));
  const cssUrl = (fam, weights) =>
    `https://fonts.googleapis.com/css2?family=${fam.replace(/ /g, "+")}${weights && weights.length ? `:wght@${weights.join(";")}` : ""}&display=swap`;
  const resolvableUrl = async (fam, weights) => {
    const w = [...new Set(weights)].sort((a, b) => a - b);
    const plain = cssUrl(fam, null);
    if (w.length === 1 && w[0] === 400) return plain; // matches Roastify's single-400 convention
    try {
      const css = await fetch(cssUrl(fam, w)).then((r) => (r.ok ? r.text() : ""));
      if (css.toLowerCase().includes(fam.toLowerCase())) return cssUrl(fam, w); // Google kept the family → weights are valid
    } catch { /* fall through to plain */ }
    return plain; // a requested weight is missing → plain family still loads
  };
  const repairFonts = async (design) => {
    const used = {};
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.type === "text" && n.fontFamily) (used[n.fontFamily] = used[n.fontFamily] || new Set()).add(wnum(n.fontWeight)); Object.values(n).forEach(walk); } };
    walk(design.pages || design); // new format has no `pages`; walking the whole design finds `elements` text too
    const fonts = [];
    for (const fam of Object.keys(used)) {
      const weights = [...used[fam]].sort((a, b) => a - b);
      fonts.push({ family: fam, weights, url: await resolvableUrl(fam, weights) });
    }
    design.fonts = fonts;
    return fonts;
  };
  const readDesign = async (dj) =>
    typeof dj === "object" ? dj : /^https?:/.test(dj) ? await fetch(dj).then((r) => r.json()) : JSON.parse(dj);
  const rowsOf = (r) => (Array.isArray(r) ? r : r?.products ?? r?.items ?? r?.data ?? r?.rows ?? []);
  const idOf = (p) => p.id ?? p.editProductId ?? p.productId ?? p._id;
  const mockupsOf = (p) =>
    (p.mockupImages ?? p.imageUrls ?? (p.images ? p.images.map((i) => i.url ?? i.imageUrl ?? i) : null) ??
      (p.designImageUrl ? [p.designImageUrl] : []))
      .map((m) => (typeof m === "string" ? m : m.imageUrl ?? m.url)).filter(Boolean);

  // ---- panel (shadow DOM) ----------------------------------------------------
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
      .h .ic{margin-left:auto;cursor:pointer;color:#828d86;font-size:15px;line-height:1;padding:2px 4px}
      .h .ic:hover{color:#e8ece6}
      .b{padding:12px;display:flex;flex-direction:column;gap:10px}
      label{font-size:11px;color:#828d86;display:block;margin-bottom:3px}
      select,button{font:inherit;width:100%;box-sizing:border-box}
      select{background:#101312;color:#e8ece6;border:1px solid #2c3432;border-radius:6px;padding:7px}
      button{background:#0d7c7f;color:#0b1211;border:0;border-radius:6px;padding:9px;font-weight:700;cursor:pointer}
      button.alt{background:#3B4248;color:#e8ece6}
      button:disabled{opacity:.5;cursor:default}
      .warn{color:#dca63f;font-size:11px}
      pre{margin:0;background:#0d100f;border:1px solid #2c3432;border-radius:6px;padding:8px;
        font-size:11px;line-height:1.5;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-word}
    </style>
    <div class="p">
      <div class="h" id="hd"><b>Push design</b><span class="ic" id="r" title="Reload products">&#x21bb;</span><span class="ic" id="x" title="Close">&#x2715;</span></div>
      <div class="b">
        <div><label>Copy the design FROM</label><select id="src"></select></div>
        <div><label>ONTO (this product is overwritten)</label><select id="dst"></select></div>
        <button id="go" disabled>Loading products&#8230;</button>
        <button id="fix" class="alt">Fix fonts on source (in place)</button>
        <button id="insp" class="alt">Inspect source&#8217;s fonts</button>
        <div class="warn" id="warn"></div>
        <pre id="log">ready.</pre>
      </div>
    </div>`;
  const $ = (id) => sh.getElementById(id);
  const log = (m) => { $("log").textContent += "\n" + m; $("log").scrollTop = 1e9; };
  const closeIt = () => host.remove();
  $("x").onclick = closeIt;
  $("x").onpointerup = (e) => { e.stopPropagation(); closeIt(); };

  // drag (skip when the pointer is on a header icon so their taps aren't eaten)
  (() => { let dx = 0, dy = 0, on = false; const p = sh.querySelector(".p"), h = $("hd");
    h.onpointerdown = (e) => { if (e.target && e.target.classList.contains("ic")) return; on = true; dx = e.clientX - p.offsetLeft; dy = e.clientY - p.offsetTop; h.setPointerCapture(e.pointerId); };
    h.onpointermove = (e) => { if (!on) return; p.style.left = e.clientX - dx + "px"; p.style.top = e.clientY - dy + "px"; p.style.right = "auto"; };
    h.onpointerup = () => { on = false; }; })();

  let PRODUCTS = [];
  const label = (p) => (p.title || p.name || idOf(p));

  const loadProducts = async () => {
    $("go").disabled = true; $("insp").disabled = true; $("fix").disabled = true;
    try {
      let list = rowsOf(await query("products.getAllProducts", { page: 1, pageSize: 100, sorting: [] }));
      if (!list.length) list = rowsOf(await query("products.getAllProducts", { page: 0, pageSize: 100, sorting: [] }));
      PRODUCTS = list;
      const si = $("src").selectedIndex, di = $("dst").selectedIndex;
      $("src").length = 0; $("dst").length = 0;
      for (const [i, p] of list.entries()) { $("src").add(new Option(label(p), i)); $("dst").add(new Option(label(p), i)); }
      if (!list.length) { $("go").textContent = "no products found"; return; }
      $("src").selectedIndex = si >= 0 && si < list.length ? si : 0;
      $("dst").selectedIndex = di >= 0 && di < list.length ? di : Math.min(1, list.length - 1);
      $("go").disabled = false; $("insp").disabled = false; $("fix").disabled = false; $("go").textContent = "Copy design →";
      log(`${list.length} products loaded.`);
    } catch (e) { $("go").textContent = "load failed"; log("✗ " + e.message); }
  };
  $("r").onclick = loadProducts;
  $("r").onpointerup = (e) => { e.stopPropagation(); };
  loadProducts();

  $("insp").onclick = async () => {
    const p = PRODUCTS[+$("src").value];
    if (!p) return;
    $("log").textContent = `inspecting “${label(p)}” font spec`;
    let d; try { d = await readDesign(p.designJson); } catch (e) { log("could not read designJson: " + e.message); return; }
    if (!d) { log("could not read designJson; keys: " + Object.keys(p).join(", ")); return; }
    log("format: " + (d.pages ? "Polotno pages (old)" : d.elements ? "Roastify elements (current)" : "unknown"));
    log("root fonts[] : " + JSON.stringify(d.fonts || []).slice(0, 600));
    const used = {};
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.type === "text" && n.fontFamily) (used[n.fontFamily] = used[n.fontFamily] || new Set()).add(wnum(n.fontWeight)); Object.values(n).forEach(walk); } };
    walk(d.pages || d);
    const declared = new Set((d.fonts || []).map((f) => f.family || f.fontFamily));
    const missing = Object.keys(used).filter((f) => !declared.has(f));
    log(`text uses: ${Object.keys(used).join(", ") || "none"}`);
    if (missing.length) log("⚠ used but NOT declared: " + missing.join(", "));
  };

  // In-place repair: rebuild THIS product's fonts[] and write it back to itself,
  // reusing its own preview + mockups. This fixes a design already saved in the
  // current format whose fonts[] is incomplete (e.g. a Roastify migration that
  // dropped a family or wrote an invalid weight).
  $("fix").onclick = async () => {
    const p = PRODUCTS[+$("src").value];
    $("warn").textContent = "";
    if (!p) return;
    if (!p.designImageUrl) { $("warn").textContent = "product has no saved design image."; return; }
    $("fix").disabled = true; $("go").disabled = true;
    $("log").textContent = `fixing fonts on “${label(p)}”`;
    try {
      const pid = idOf(p);
      log("reading design…");
      const design = await readDesign(p.designJson);
      const before = JSON.stringify(design.fonts || []);
      const fonts = await repairFonts(design);
      log(`fonts[] rebuilt → ${fonts.map((f) => `${f.family}[${f.weights.join("/")}]`).join(", ") || "none"}`);
      if (JSON.stringify(fonts) === before) log("(no change — already correct)");

      log("uploading JSON…");
      const jsonKey = `design-json/${rid()}.json`;
      const jput = await mutate("aws.getPresignedUrl", { filename: jsonKey, filetype: "application/json" });
      const ju = await fetch(jput, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(design) });
      if (!ju.ok) throw new Error("json upload HTTP " + ju.status);

      const preview = asset(p.designImageUrl);
      const imageUrls = mockupsOf(p).map(asset);
      if (!imageUrls.length) imageUrls.push(preview);
      log("writing updateDesign (same product)…");
      await mutate("products.updateDesign", {
        productId: pid, cleanJsonUrl: STORAGE + jsonKey, s3KeyJson: jsonKey,
        cleanImageUrl: preview.imageUrl, s3KeyImage: preview.s3Key, imageUrls,
      });
      log("✓ done. Reopen this product in the Designer — fonts should render now.");
      await loadProducts();
    } catch (e) { log("✗ " + e.message); }
    finally { $("fix").disabled = false; $("go").disabled = false; }
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
      const design = await readDesign(source.designJson);
      const fonts = await repairFonts(design);
      log(`design ${JSON.stringify(design).length.toLocaleString()} bytes; fonts[] rebuilt: ${fonts.map((f) => f.family).join(", ") || "none"}.`);

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
      const af = (after && (typeof after.designJson === "object" ? after.designJson : (() => { try { return JSON.parse(after.designJson); } catch { return null; } })()));
      log("✓ updateDesign done. target now declares fonts[]: " + JSON.stringify((af && af.fonts) || "unknown").slice(0, 300));
      log("Reloading product list…");
      await loadProducts();
      log("Open the target in the Designer to see it render.");
    } catch (e) { log("✗ " + e.message); }
    finally { $("go").disabled = false; }
  };
})();
