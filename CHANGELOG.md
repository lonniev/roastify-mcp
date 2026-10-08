# Changelog

All notable changes to roastify-mcp are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Changes not yet released live in `changelog.d/`, one file per change — see the README there for why, and `scripts/changelog.py` for what folds them in at release time.

## [0.22.6] — 2026-08-24

### Security — track tollbooth-dpyc 0.88.1 (cryptography floor raised to >=49.0.0)

Picks up the SDK's fix for GHSA-m2h6-j472-rp4c: the X.509 verifier accepted
wildcard DNS SANs, escaping `permittedSubtrees`. The advisory is fixed in
cryptography 49.0.0, and the SDK previously declared a floor of `>=46.0.5` —
which admitted every affected release.

No install here was exposed: the resolved lock already carried a patched
cryptography. What changes is what a fresh resolve is *allowed* to land on.
See tollbooth-dpyc v0.88.1.

## [0.22.5] — 2026-08-22

### Changed — track tollbooth-dpyc 0.88.0

A relay down for a moment no longer becomes a permanent verdict.
The bootstrap relay poll is retried on a bounded ladder, and a
transient failure is no longer cached for the life of the process.

## [0.22.4] — 2026-08-22

### Changed — track tollbooth-dpyc 0.87.3

Recovering an orphaned job now uses the detached executor it was
dispatched to. The recovery path never resolved the executor, so a
job orphaned by a container recycle was retried in-process on the
new front — bypassing the detached runner precisely when it was
the point.

## [0.22.3] — 2026-08-22

### Changed — track tollbooth-dpyc 0.87.2

An object argument a client serialised as a JSON string is now parsed
rather than refused as `dict_type`. Fixes `update_post` rejecting a
large patch and `update_design_text` rejecting a multi-key edits
object.

## [0.22.2] — 2026-08-22

### Changed — track tollbooth-dpyc 0.87.1

Picks up the relay-reliability work: `COURIER_RELAY_UNREACHABLE` so an
unreachable pinned rendezvous is no longer reported as the patron never
replying, relay-failure reporting to the Oracle, and a publish that counts
only when the relay acknowledges that exact event.

## 0.22.1 — 2026-08-17

### Changed — track tollbooth-dpyc 0.86.0 (GitHub-free bootstrap)

Picks up the GitHub-free operator bootstrap: relays and Authority resolution now come from the Oracle via MCP, so this operator no longer reads the dpyc-community registry on GitHub — closing the fleet-wide bootstrap SPOF.

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
