# Changelog

All notable changes to roastify-mcp are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
