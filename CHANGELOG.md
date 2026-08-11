# Changelog

All notable changes to roastify-mcp are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
