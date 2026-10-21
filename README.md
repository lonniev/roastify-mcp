# roastify-mcp

A [Tollbooth DPYC](https://github.com/lonniev/dpyc-community) operator for the
[Roastify](https://roastify.app/) Developer API. Roastify is a white-label coffee
dropshipper: it roasts, prints branded packaging, and ships direct to customers.

This operator lets an AI agent read the Roastify catalog, generate packaging artwork, and
keep a private library of designs in a GitHub repo the patron owns — paid for in Bitcoin
Lightning satoshis with no account, no KYC, and no subscription.

## What you're building

```
      YOU (operator, human in the loop)
        │                         │
        │ set & tune prices       │ drive credential intake
        ▼                         ▼
  ┌───────────────┐        ┌──────────────────────────────────────────────┐
  │ Pricing Studio│ prices │        Roastify — YOUR OPERATOR MCP           │
  │    (iOS)      ├───────▶│        FastMCP · deployed on Horizon          │
  └───────────────┘  Neon  │  ┌────────────────────────────────────────┐  │
                           │  │ roastify domain module ◀─ Roastify API  │  │
   Patron (Citizen)        │  │ @runtime.paid_tool(FROZEN_UUID) tools   │  │
   + MCP client  ─────────▶│  ├────────────────────────────────────────┤  │
   (Claude, etc.)  npub    │  │ tollbooth-dpyc SDK (the wheel)          │  │
                    +sats  │  │  ledger · vault (AES-256-GCM) · pricing │  │
                           │  │  /ConstraintGate · Secure Courier·audit │  │
                           │  └────────────────────────────────────────┘  │
                           └───┬─────────┬──────────┬───────────┬─────────┘
                               ▼         ▼          ▼           ▼
                         Neon Postgres  BTCPay▶  Sponsor     Nostr relays
                         (your schema)  Lightning Authority   proofs·courier
                         ledger+pricing invoices  certify +    DMs·audit
                                                  provision        │
                     api.roastify.app ◀── domain      │            ▼
                     (each patron's         calls      └──▶ DPYC Oracle +
                      own API key)                          dpyc-community
```

### Onboarding roadmap

1. **Nostr keypair** — generate one (`nak key generate`). The nsec is the only env var:
   `TOLLBOOTH_NOSTR_OPERATOR_NSEC`.
2. **Sponsor Authority** — register; it provisions your Neon schema automatically.
3. **Secure Courier** — deliver your BTCPay secrets (`btcpay_host`, `btcpay_api_key`,
   `btcpay_store_id`) by Nostr DM. They are vaulted, never put in the environment.
4. **Set prices in Pricing Studio** — see below. Tools start unpriced and uncallable.
5. **Deploy on Prefect Horizon** — `fastmcp.json` is ready.

### Get Pricing Studio

Your tools ship **unpriced**, and nobody can call a paid tool that has no price.
**Pricing Studio** (iOS) is the operator console: it reads and writes the pricing model live
in Neon, so prices never live in code — see
[tollbooth-pricing-studio](https://github.com/lonniev/tollbooth-pricing-studio).

That indirection is the point. Dynamic per-tool pricing — surge, happy-hour, loyalty
discounts, free trials for a first-time patron — is what DPYC gives you that a flat paywall
never could.

## Bring your own Roastify key

Every patron delivers **their own** Roastify API key through the Secure Courier, vaulted per
npub. There is no operator-held key and no fallback path.

This follows from the domain rather than being a policy choice. Roastify scopes the catalog,
saved designs, and plan tier to the merchant account behind the key — a patron on Base sees a
different catalog than one on Pro. A single operator-held key would hand one merchant's world
to every caller, which is a wrong answer rather than a limitation to work around. It also
means this operator never holds a credential it could misuse, and revoking your key in the
Merchant App severs access without involving the operator.

```
roastify_get_patron_onboarding_status   # what's missing
roastify_request_patron_credentials     # → you get a Nostr DM
   (reply with your Roastify API key)
roastify_receive_patron_credentials     # vaulted, encrypted at rest
```

The same reply may carry the optional `github_token` (a fine-grained token with Contents
read/write), `github_repo` (`owner/repo`) and `github_branch` (default `main`) that the design
library needs.

Live keys start `rty_live_`. Sandbox keys start `rty_test_` and do not fulfill — useful for
exercising the read tools without touching production.

## Tools

| Tool | Tier | What it does |
|---|---|---|
| `roastify_browse_catalog` | read | Catalog products and coffee blends together, plan tier marked |
| `roastify_get_catalog_product` | read | One product with variants, prices, stock, dieline template |
| `roastify_get_blend` | read | One blend: roast level, decaf status, variants |
| `roastify_list_my_products` | read | Your saved Roastify products, cursor-paginated |
| `roastify_get_my_product` | read | One saved product design in full |
| `roastify_check_stock` | read | Stock for one SKU or the whole list |
| `roastify_generate_artwork` | write | Generate artwork from a saved design |
| `roastify_artwork_status` | free | Check that job |
| **Design library** | | |
| `roastify_stash_design` | write | Store a design in your library — a commit in your GitHub repo |
| `roastify_list_designs` | read | Your stored designs, metadata only, newest first |
| `roastify_fetch_design` | read | One stored design in full, images re-inlined (for the courier) |
| `roastify_list_design_versions` | read | A design's committed versions — its git history |
| `roastify_delete_design` | write | Delete one stored design |
| `roastify_get_design_text` | read | A design's editable text layers, with each layer's size |
| `roastify_update_design_text` | write | Apply text edits and commit a new version |
| `roastify_add_design_element` | write | Add a text or image element and commit a new version |
| `roastify_move_elements` | write | Move or resize a group of elements and commit a new version |
| `roastify_set_product_description` | write | Set the product's store-page description on a stored design |

Plus the standard DPYC catalog (balance, purchase, courier, pricing, Oracle, status).

## What this operator does not do, and why

**It cannot create, update, delete, or sync products.** Not a missing feature — the Roastify
API has no such endpoints. `/v1/products` is read-only, and the words *integration*, *sync*,
*shopify*, and *upload* do not appear anywhere in the
[OpenAPI spec](https://docs.roastify.app/openapi.json). Saved products and storefront sync are
Merchant App capabilities by design.

**It does not place orders.** Roastify already routes orders to its own operations and reports
tracking back to your storefront. An MCP layer between those adds a hop without adding
judgment, so order automation is deliberately left to Shopify and Roastify.

**Artwork generation is template personalization, not design.** `roastify_generate_artwork`
rewrites the named text and image placeholders of a design *you already authored* in the
Roastify Design Studio. It cannot author a design from scratch.

**A generated artwork URL is not attached to anything.** In Roastify's API the only consumer
of an artwork URL is an order line — and orders are out of scope here. You receive a URL and
carry it onward yourself. That seam is accepted deliberately; it is not an oversight, and this
operator will not simulate a design flow the API cannot complete.

**The catalog has no palate data.** Origin, region, altitude, processing method, and varietal
exist only in the Merchant App UI. The machine-readable signals are `roastLevel`, `isDecaf`,
size, and price; everything else about a coffee's character is prose in its description. Bean
selection is correspondingly weaker than it looks, and this operator does not dress up an
LLM's reading of a description as structured provenance data.

## The design library, the courier and the Design Bench

Designs live in a GitHub repo the patron owns, one folder per design, and the operator commits
to it on the patron's behalf with the vaulted token. Every save is a commit, so a design has
real version history, and the patron can browse, rename or delete designs in GitHub itself.

Reading or writing a design on a Roastify product needs the merchant's own browser session,
which no API offers. `frontend/` carries two pieces for that:

- **The courier** — a script a bookmarklet injects into `merchant.roastify.app`. It stashes a
  product's design into the library and applies a finished design back onto a product. It
  holds no editing logic.
- **The Design Bench** — the web app at `roastify.tollbooth-dpyc.com`, where designs are edited.
  Its Cloudflare function proxies `/mcp` so the courier can reach this operator from the
  merchant's origin.

An agent edits a design's text with `roastify_get_design_text` and `roastify_update_design_text`;
the human applies the new version with the courier.

## Artwork is asynchronous

Roastify renders artwork on its own servers, so `roastify_generate_artwork` hands back a job
id straight away and `roastify_artwork_status` checks it. Status checks are **free** — you
learn the work finished by looking, and charging for each look would be charging for waiting.

```
job = roastify_generate_artwork(product_id=..., fields=[...], client_req_id="my-req-1")
roastify_artwork_status(job_id=job["job_id"])   # free, poll until artwork_url appears
```

Pass `client_req_id` and a repeated request is safe: it becomes Roastify's
`Idempotency-Key`, so the artwork is not generated twice.

The operator does no waiting of its own — both calls return immediately — so there is no
detached executor here and nothing to recycle. That machinery would earn its place only if
this operator ever rendered artwork itself.

## Development

```bash
pip install -e ".[dev]"
ruff check .
pytest -v
python -m roastify_mcp.server   # needs TOLLBOOTH_NOSTR_OPERATOR_NSEC to fully run
```

## Upstream status

Roastify's API is version **0.3.1** and its own spec marks it **beta, "subject to change."**
Expect to follow breaking upstream edits, and weigh that before promising this operator's
catalog to third-party merchants.

## License

Apache 2.0 — see [LICENSE](LICENSE).
