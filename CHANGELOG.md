# Changelog

All notable changes to roastify-mcp are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **The design store is now configuration management.** Editing a design
  (`update_design_text`, `add_design_element`, `move_elements`) commits a new version
  of the **same** `design_id` — git tracks the diff — instead of saving a new file;
  the suffix labels (" (edited)", " +text", " (aligned)") are gone. A design's folder
  id is the deterministic slug of its label (no random `-<hash>`), so re-stashing the
  same design overwrites its folder rather than spawning a duplicate. Two genuinely
  different designs just need different labels.

### Added

- **`roastify_move_elements` — shift a group of layers as one object, and/or resize
  elements, saved as a new design.** The Design Studio can only move one layer at a
  time, so a layered spec block drifts out of alignment when its backing shape is
  moved alone. This relocks it: name the ids and shift them by a common (dx, dy),
  and separately re-centre/resize individual rectangles, in one edited copy. Pure
  helper `github_store.edit_geometry` (group shift or absolute set per edit). Line
  shapes carry absolute endpoints (`x1/y1/x2/y2`, `points`); a shift translates those
  too, so a moved divider line travels with its box instead of staying behind.

### Fixed

- **Applied designs lost their background image.** GitHub's Contents API returns EMPTY content for
  files over ~1 MB, and a design's background artwork is ~1.7 MB — so `fetch_design` re-inlined it
  as an empty `data:image/png;base64,` and the applied design came back with no background.
  `_get_file` now falls back to the Git Blobs API (base64 up to 100 MB) by sha whenever the Contents
  API returns no content, recovering the full image. Affected every real design (they all carry a
  full-bleed background over 1 MB).

### Added

- **Element creation + panel geometry (Phases 2–3 of Scout's Design-Shuttle task).**
  `get_design_text` now assigns a real `face` per layer/element (front/back/left/right) and returns
  `panels` — the box's panel columns recovered from the catalog dieline's `SIDE_LABELS` guide group
  (the saved design only ever says `"sheet"`; there are no panel rectangles in it). New
  `roastify_add_design_element(design_id, face, text, style_from, position, width)` adds a text
  element to a design and saves the result as a NEW design (source untouched), returning the new
  design id AND element id. Typography is inherited from an existing layer (`style_from`), position
  is absolute `{x,y}` or relative `{below|above|rightOf|leftOf: layer_id, gap}`, and predicted bounds
  come from the read payload's ~1.21·fontSize rule. Placement is REFUSED, not warned: it must fall
  inside the named panel (a conservative default margin, since the dieline has no real safe area —
  `bleed` is 0) and must not overlap an existing element (full-bleed background art excluded; the
  collider's id is named). New `dieline` module fetches+parses the (public) dieline, cached.
  Verified against the real Marginalism box: a 250-char origin paragraph lands in the empty right
  panel, inside the safe box, with no collision.

### Added

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

### Changed

- **Design library now lives in a GitHub repo the patron owns, not the operator's Neon.** The MCP
  is the broker: it holds a vaulted fine-grained GitHub token (new optional patron credential
  fields `github_token` / `github_repo` / `github_branch`) and commits/reads on the patron's
  behalf. The tool surface (`stash`/`fetch`/`list`/`delete`/`get_design_text`/`update_design_text`)
  and the browser courier are unchanged. Why: git is content-addressed, so a design's heavy
  artwork is de-duplicated across variants for free (no hand-rolled asset table); every save is a
  commit, so there is real version history and rollback; the patron owns the store and can browse,
  rename, and delete designs in GitHub's own UI (the management surface the courier alone used to
  be); and a design is a readable folder — `designs/<id>/{design.json, content.json, meta.json}`
  plus shared `assets/<sha>.<ext>` — rather than a 2.3 MB row. Writes are single atomic commits via
  the Git Data API; large inline images are lifted to asset files while small SVGs stay inline so
  `design.json` diffs cleanly. Retires `design_store` (Neon) and its schema.

### Changed

- **Acted on first-live-run field notes (design shuttle).** The instruction text now reframes the
  read-only-API boundary as tool-scoped, not the endeavour: the *merchant is the orchestrator* —
  they create products, change plan tier, and author templates, so an agent should design for what
  the merchant wants to build, not narrow the work to the current catalog. Added two editing
  disciplines to the intent and the tool docs: keep replacement text within ~±10% of the layer's
  character count (the box doesn't resize), and a stash label states intent, not content (read the
  layers, don't trust the name). Noted that `tool_not_priced` is a registration gap, not a patron
  debt. `get_design_text` now returns per-layer `chars`, `fontSize`, `width`, and `height` so an
  editor can gauge fit. `get_my_product`'s description notes the coffee identity is SKU-encoded
  (decode before writing origin copy). Feedback from Scout's first agent-side run.

### Added

- **BLUF operating model in the server instructions** — the FastMCP `instructions` now lead with a
  bottom-line-up-front summary of the unusual operating model so any connected agent understands it
  without a pasted brief: two capabilities (catalog reads + a per-patron design library), the hard
  boundary (no product creation or design-write from the MCP — the browser courier does the
  session-bound ends), the branded-variant workflow (get_design_text → interview → update_design_text
  → courier applies), and the rule to never fetch_design for editing (it carries the ~2.3MB image).

### Added

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

### Added

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

### Added

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

### Changed

- Artwork is a thin passthrough of Roastify's own async API: `generate_artwork` returns
  the upstream job id and `artwork_status` checks it. `artwork_status` is category
  `free` — the wheel gates it without consulting Neon, because polling is how a caller
  learns the work finished and metering each look charges for waiting.

### Removed

- `modal_app.py`, `deploy-modal.yml`, `test_modal_app.py`, the registered job runner,
  `fetch_artwork`, and the nested timeout rings. Modal is the execution home for an
  operator's OWN long-running work; Roastify's render happens on Roastify's servers and
  both of our calls return immediately. The long-running task was manufactured by
  polling to completion inside a runner, and the detached executor existed to host the
  thing that manufactured it. With nothing of ours in flight after the POST returns,
  there is no operator-fault window for a job store to protect.
- `config.py` — every setting in it existed for those rings. The file was inherited from
  the template, which ships it unused.
- `session.py` — collapsed to one `SessionCache[str]` in `server.py`; a module for a
  three-line cache was ceremony.
- Dependencies `pydantic-settings` and `python-dotenv`, which only `config.py` used, and
  the `modal` extra from the SDK pin.

## [0.1.0] - 2026-08-11

Initial scaffold, forked from the `tollbooth-sample` exemplar via the
`bootstrap-dpyc-operator` skill.

### Added

- Operator bootstrap on `OperatorRuntime` + `register_standard_tools` with the full standard
  DPYC catalog (ledger, Secure Courier, pricing, constraints, Oracle, status).
- Per-patron Roastify credentials: `patron_credential_template` for `api_key`, vaulted per
  npub. No operator-held key and no fallback path — Roastify scopes catalog visibility and
  plan tier to the account behind the key, so a shared key would return one merchant's data
  to every caller.
- Six read tools: `browse_catalog`, `get_catalog_product`, `get_blend`, `list_my_products`,
  `get_my_product`, `check_stock`. Composed rather than mirroring the REST surface.
- Artwork generation as a durable claim-check job (`generate_artwork` → `fetch_artwork`),
  with `artwork_status` as an escape hatch onto the upstream job id. Pinned
  `tollbooth-dpyc[nostr,modal]` so a generation survives a serverless recycle.
- Idempotency: `client_req_id` maps to Roastify's `Idempotency-Key` header.
- Named upstream failures — rate limit, plan gate, revoked key, and permanent vault faults
  each get their own guidance rather than sharing one generic error.
- 28 tests covering happy paths and adversarial input (malformed artwork fields, absurd page
  limits, non-JSON error bodies, key redaction in reprs and error payloads).

### Notes

- Roastify's API is v0.3.1 and marked beta, "subject to change."
- Product create/update/delete and storefront sync are **not** implemented because they have
  no API surface; they are Merchant App capabilities. Order placement is deliberately out of
  scope. See the README for what that means for a generated artwork URL.
