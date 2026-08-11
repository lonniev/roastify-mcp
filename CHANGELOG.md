# Changelog

All notable changes to roastify-mcp are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
