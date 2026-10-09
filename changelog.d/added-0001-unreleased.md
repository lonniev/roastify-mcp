- **Design element flexibility (`align`, `fontFamily`, image create, z-order) — #62.**
  Agents building branded tubes/boxes can now finish layout without a merchant screenshot
  pass. `move_elements` accepts `align` and `fontFamily` on text (so a repurposed layer no
  longer keeps a donor's right-align or Montserrat face), plus `z` (`front`/`back`/index)
  to change paint order in the `elements` array. `get_design_text` exposes each layer's
  `align` and every item's `z`, and returns `fonts` (loaded + used families) so callers
  pick a known face. `add_design_element` gains `kind="image"` that copies a `src` already
  present on the design (`src_from` or reuse `src`) — no new upload path — and places on
  the sheet when `panels` is empty (Tubes), so element creation is reachable without a
  panel name.
- **Welcome landing page (`/welcome`).** A public front door for fellow Roastify merchants:
  version your designs in git, edit a whole line of SKUs in one AI pass, and sync to Shopify.
  Static page in the courier's die-line/kraft voice — the three moves, how the courier/agent/
  library divide the work, and a four-step "connect once, pay per use" start (no price quoted).
  A wired hero-image slot swaps in `courier-hero.png` when present.
- **Design courier: pop the Library out into its own draggable window.** The fetchable-designs
  list now has a pop-out toggle that detaches it into a separate, taller, draggable window, so
  the catalog/Commit controls and the full design list are visible at once instead of scrolling
  a strip inside the panel. Version-picker and confirm dialogs follow the list into whichever
  window holds it. The header controls are now Material Design glyphs (inlined SVG) in padded,
  hover-lit tap targets, with the cramped body type bumped up for legibility on iPad.
  The version picker and confirm dialogs are now free-floating, draggable cards (no covering
  backdrop) rather than modal overlays, so the panel, the popped-out Library, and a picker can
  be arranged on screen together.
- **Read and set element `fill`/`stroke` — so an agent can audit and correct the roast
  scale.** `get_design_text` now returns each non-text element's `fill` and `stroke`
  colours (previously id/type/name/bounds only), so an agent can see which roast-scale
  dots are filled (a filled dot has a dark `fill`, an empty one none). `move_elements`
  now accepts `fill`/`stroke` on any element (colour strings), so an agent can fill or
  empty a dot to match a coffee's roast level. Filed via Scout as the capability gap
  that blocked auditing/correcting the scale.

- **Fetch offers a version picker — choose which committed version to apply.** New
  `roastify_list_design_versions(design_id)` returns a design's git history (sha, date,
  commit message, version tag), and `roastify_fetch_design` takes an optional `ref`
  (commit sha or tag) to fetch that exact version. In the courier, Fetch on a design with
  more than one version opens a picker (date · tag · message); pick one and it applies
  that version (latest when there's only one). The store reads a file at any ref.
- **Commit now takes a required commit message and version tag.** The courier prompts
  for both (neither may be blank) before a Commit; `stash_design` rejects a blank
  message or tag, and the store writes the message as the git commit message and creates
  a git **tag** (`<design_id>/<version_tag>`) on that commit. Reusing a tag for the same
  design is refused *before* committing, so there's no orphan commit on a collision.

- **The product's store-page description travels with the design, and Fetch re-applies
  it.** Commit now captures the product's current Roastify `description` into the design's
  git package (`meta.json`), versioned alongside the artwork; Fetch reads it back and
  writes it onto the target product via the private `products.updateStoreMetadata`
  mutation (a read-modify-write that preserves name/price/coffee attributes). The write
  is **best-effort**: once a product is bound to Shopify the description can lock, so a
  rejection is logged ("locked — left unchanged") and never fails the design apply.
  `stash_design` takes a `description`; the edit tools preserve it across text/geometry
  saves (like `label`); `list_designs`/`fetch_design` return it.
- **`roastify_set_product_description(design_id, description)` — the AI client authors the
  description.** `get_design_text` now returns the current `description` (Roastify's
  auto-generated copy is the helpful starting point), and this new tool writes a refined
  one back, committing a new version in place. Closes the loop: without it the client
  could preserve and re-apply a description but never author one.
- **Are-you-sure confirmation on Commit and Fetch**, each spelling out exactly what
  clicking through will change — Commit: a new git version of the design + description,
  nothing on Roastify/Shopify; Fetch: overwrites the product's design + description on
  Roastify (description skipped if Shopify-locked).

- **Design library entries carry git traceability** (field report roastify-mcp#35, ask #3).
  `list_designs` now surfaces each design's repo `path` (`designs/<id>/`) and its latest
  commit — `sha`, `short_sha`, and `commit_url` — resolved via a path-filtered Commits
  lookup. The per-design meta + commit reads run concurrently (`asyncio.gather`), so the
  listing gained the data while getting *faster*, not slower. The courier renders the short
  SHA as a link through to the commit on GitHub beside the repo path, so a merchant can
  correlate the chooser against real history and disambiguate near-identical labels.
  `from_design_id` is intentionally **not** revived: under the CM store the derivation chain
  is the folder's commit history, which the commit link exposes directly — strictly more than
  a single pointer. This closes roastify-mcp#35.
- **Courier Design Chooser: loading, error, and traceability states** (field report
  roastify-mcp#35). The library fetch now shows a spinner + "Loading designs…" row and,
  on failure, a distinguishable error row with a Retry button — the chooser no longer
  reads as an empty library while it is actually fetching or has failed. Each row shows
  its full label on hover (the distinguishing tail is no longer lost to wrap) and its
  backing repo path (`designs/<id>/`), a stable disambiguator when two labels differ
  only by a trailing parenthetical. (Commit-SHA / `from_design_id` derivation remain a
  follow-up — they need the MCP store to surface `sha`/`path` first.)

- **`roastify_move_elements` — shift a group of layers as one object, and/or resize
  elements, committing a new version in place.** The Design Studio can only move one
  layer at a time, so a layered spec block drifts out of alignment when its backing
  shape is moved alone. This relocks it: name the ids and shift them by a common
  (dx, dy), and separately re-centre/resize individual rectangles, in one commit. Pure
  helper `github_store.edit_geometry` (group shift or absolute set per edit). Line
  shapes carry absolute endpoints (`x1/y1/x2/y2`, `points`); a shift translates those
  too, so a moved divider line travels with its box instead of staying behind.
- **`move_elements` accepts `fontSize` on a text layer** (absolute set), reflowing the
  layer's derived `height` — so matching one label's size to a horizontal peer no
  longer has to be finished by hand in Design Studio. On a text layer `width` is the
  wrap frame and `fontSize` the type size (both settable); `height` is derived and a
  passed `height` is ignored. On a rectangle/line/image, `width`/`height` set the frame
  directly, as before.

- **Element creation + panel geometry (Phases 2–3 of Scout's Design-Shuttle task).**
  `get_design_text` now assigns a real `face` per layer/element (front/back/left/right) and returns
  `panels` — the box's panel columns recovered from the catalog dieline's `SIDE_LABELS` guide group
  (the saved design only ever says `"sheet"`; there are no panel rectangles in it). New
  `roastify_add_design_element(design_id, face, text, style_from, position, width)` adds a text
  element to a design and commits a new version in place, returning the new element id. Typography
  is inherited from an existing layer (`style_from`), position
  is absolute `{x,y}` or relative `{below|above|rightOf|leftOf: layer_id, gap}`, and predicted bounds
  come from the read payload's ~1.21·fontSize rule. Placement is REFUSED, not warned: it must fall
  inside the named panel (a conservative default margin, since the dieline has no real safe area —
  `bleed` is 0) and must not overlap an existing element (full-bleed background art excluded; the
  collider's id is named). New `dieline` module fetches+parses the (public) dieline, cached.
  Verified against the real Marginalism box: a 250-char origin paragraph lands in the empty right
  panel, inside the safe box, with no collision.

- **Read-side geometry + non-text elements in `get_design_text`** (Phase 1 of element creation).
  Each text layer now reports `x`/`y` (top-left corner in design units; the sheet origin is its
  top-left) alongside the existing `width`/`height` (measured text bounds, not fixed frames — text
  grows, it doesn't clip). The response also carries `sheet` (the overall extent) and `elements` —
  the NON-text elements (images, shapes, rules) read-only, each with id, type, name, and bounds.
  This lets an agent see the whole panel: a header with no text value is not necessarily a defect
  (its value may be a graphic in `elements`, e.g. a roast scale), and it shows where NOT to place
  new text. Roastify's migrated format carries no visibility flag, so none is reported. The two
  hard-won lessons are added to the instructions and the tool description. Prerequisite for a future
  `add_design_element` write tool. From Scout's Design-Shuttle element-creation task.

- **Auto-repair the fonts on stash.** Roastify's own schema migration leaves a lossy `fonts[]`
  (a dropped family, a weight a font doesn't ship), so a saved design renders fallback fonts in
  Edit Design even though it's already in the new schema. `stash_design` now rebuilds `fonts[]`
  from the families the text actually uses — keyed `family`, with css2 URLs validated against
  Google Fonts (plain family when a weight is missing) — so the stored design renders in its
  intended fonts. Non-destructive: only the load list changes; text and per-layer
  fontFamily/fontWeight are untouched, and it's idempotent for an already-correct design. This
  moves the font repair off the merchant browser session and into the MCP: a legacy design is
  fixed by Send (stash repairs it into GitHub) then Apply (push the fix back to Roastify). The
  stash result reports `fonts_repaired`.

- **BLUF operating model in the server instructions** — the FastMCP `instructions` now lead with a
  bottom-line-up-front summary of the unusual operating model so any connected agent understands it
  without a pasted brief: two capabilities (catalog reads + a per-patron design library), the hard
  boundary (no product creation or design-write from the MCP — the browser courier does the
  session-bound ends), the branded-variant workflow (get_design_text → interview → update_design_text
  → courier applies), and the rule to never fetch_design for editing (it carries the ~2.3MB image).

- **Field-level design editing** — two npub-scoped tools that let an agent generate a branded
  product variant in conversation without moving the artwork. `get_design_text(design_id)` returns
  a stored design's text layers only (id + current text + font, no images), so it stays small
  enough to reason over in chat; each layer's own text is its label. `update_design_text(design_id,
  edits={layer_id: text}, label)` applies the edits and saves the result as a NEW design (the
  original is untouched), returning the new id for the browser courier to apply onto a product.
  Only the words change — fonts, layout, and the content-addressed image are preserved and never
  moved. The full flow: courier stashes your product's design → in Claude (Roastify MCP connected)
  you say "make an Ethiopian SO from this", Claude reads the fields + a catalog item, interviews
  you, and writes the variant → courier applies it onto the new product.

- **Design library** — four npub-scoped tools (`stash_design`, `fetch_design`, `list_designs`,
  `delete_design`) that hold a patron's own Roastify designs in the operator's Neon, gated by
  the standard npub-proof like every other patron tool. This is the store half of the
  design-shuttle: the browser courier reads a product's design (merchant session) and stashes
  it here; the Design Bench edits it; the courier fetches it back to write onto a product. The
  operator never holds a merchant session and never mutates Roastify — storage only. A saved
  design is ~2.3 MB but 99 % of that is one inline image, so inline `data:` URIs are lifted
  into a content-addressed, chunked assets table (deduped by sha256) and the design row keeps
  only an ~18 KB skeleton; a patron's variations of one design reuse the image for free.
  Persistence reuses the SDK's bootstrapped `NeonVault` (`_execute`/`_t`), the same idiom as
  the SDK's own `adoption_store`.


- `frontend/public/tools/` — an **operator-only** design-push tool, deployed alongside the FE
  but deliberately not part of the patron Design Bench. Roastify's Design Studio talks a
  private tRPC API (`/api/trpc`) authenticated by a Clerk session cookie, not the public API
  key, so it can only be driven from inside the merchant origin on the operator's own login.
  A bookmarklet injects `roastify-push.js` into `merchant.roastify.app`, where it renders its
  own panel (source/target pickers, live status, server-side verification) — no dev console, so
  it works on an iPad. It copies one saved design's JSON, preview, and mockups onto another
  product using the same calls the Save button makes. `tools/index.html` is the install page.

- The factory apparatus, copied from the `tollbooth-sample` exemplar and adapted: 11
  `agentic-*` workflows (service desk, QA, PR dialogue and revision, escalation,
  housekeeper, engineering, approval- and auto-merge, block-retire, deploy-verify),
  `doctrine-lint`, `release`, `publish-mcp-registry`, `server.json`, the pricing
  constraint examples, and `.github/CODEOWNERS`.

  The scaffold took only `ci.yml`, which left this repo a working operator wearing none
  of the fleet's clothes: no code-owner gate, no doctrine lint, no GitHub Release on a
  tag, and absent from the MCP registry. It merged its own first commits straight to
  `main` with nothing in the way, which is why the gap went unnoticed.

  CODEOWNERS is default-deny with `/tests/` and `*.md` carved out, matching what
  auto-merge is trusted to land. Its note records what the catch-all is actually
  protecting here — `_require_key` and the patron credential template, where a
  plausible-looking edit introducing a default key would hand one merchant's catalog to
  every caller.
