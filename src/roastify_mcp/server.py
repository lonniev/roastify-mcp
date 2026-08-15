"""roastify-mcp — Roastify Developer API, monetized with Tollbooth DPYC.

Standard DPYC tools (check_balance, purchase_credits, Secure Courier, Oracle,
pricing, constraints) come from ``register_standard_tools``. Only the Roastify
domain tools are defined here.

Multi-tenant by construction: every patron delivers their own Roastify API key
through the Secure Courier, and it is vaulted per npub. There is no
operator-held Roastify key and no fallback path — Roastify scopes catalog
visibility, saved designs, and plan tier to the merchant account behind the
key, so a shared key would return one merchant's world to every caller. That
is a wrong answer, not a limitation to work around.

Run locally:
    python -m roastify_mcp.server
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated, Any

from fastmcp import FastMCP
from pydantic import Field
from tollbooth.credential_templates import CredentialTemplate, FieldSpec
from tollbooth.credential_validators import validate_btcpay_creds
from tollbooth.runtime import OperatorRuntime, register_standard_tools
from tollbooth.session_cache import SessionCache
from tollbooth.tool_identity import STANDARD_IDENTITIES, ToolIdentity

from roastify_mcp import __version__, dieline, github_store, roastify

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# FastMCP app
# ---------------------------------------------------------------------------

mcp = FastMCP(
    "roastify-mcp",
    instructions=(
        "Roastify MCP — AI agent access to the Roastify coffee catalog and "
        "packaging artwork generation, monetized via Tollbooth DPYC Bitcoin "
        "Lightning micropayments.\n\n"
        "## Operating model (BLUF)\n"
        "You do two things: read this merchant's Roastify catalog, and keep a "
        "private per-patron design LIBRARY. The Roastify API is read-only for "
        "products and design-write is browser-session-bound — but that is the "
        "shape of the TOOLS, not of the work. The merchant is the orchestrator: "
        "they create products in Roastify and Shopify, change plan tier, and "
        "author templates in Design Studio whenever the work calls for it. Design "
        "for what the merchant wants to BUILD, not for what their current catalog "
        "already holds; when a variant needs a product or plan that doesn't exist "
        "yet, say so plainly and keep going — don't treat it as a blocker or "
        "quietly narrow the work to fit.\n"
        "Division of labor: a companion 'courier' the human runs on "
        "merchant.roastify.app does the two session-bound steps — stash a "
        "product's design up into the library, and apply a finished design back "
        "onto a product. YOU read catalog facts and edit a design's TEXT.\n"
        "To make a branded variant of a saved design: "
        "`roastify_get_design_text(design_id)` to see the editable text layers → "
        "interview the human (read `roastify_get_catalog_product` for facts) → "
        "`roastify_update_design_text(design_id, edits={layer_id: text})` to save a "
        "NEW design → tell the human to apply it onto the product with the courier. "
        "NEVER call `roastify_fetch_design` to edit: it carries a ~2.3MB inline "
        "image and is the courier's, not yours — the field tools carry text only.\n"
        "Two disciplines that save the merchant a manual pass: the text box does "
        "not resize, so keep each replacement within roughly ±10% of the character "
        "count of the text it replaces (`get_design_text` reports each layer's "
        "`chars`, `fontSize`, and `width`); and a stash label states INTENT, not "
        "content — a design labeled for one coffee may still hold a donor "
        "template's words, so read the layers, don't trust the name. A "
        "`tool_not_priced` error means a tool isn't registered yet, not that the "
        "patron owes anything — report it and stop; don't offer to fix pricing.\n\n"
        "## Bring your own Roastify key\n"
        "Every patron uses their own Roastify API key. Roastify scopes the "
        "catalog, saved designs, and plan tier to the account behind the key, "
        "so this operator holds no key of its own.\n"
        "1. Call `roastify_get_patron_onboarding_status` to see what is missing.\n"
        "2. Call `roastify_request_patron_credentials` with your npub — you get "
        "a Nostr DM.\n"
        "3. Reply with your Roastify API key (a Base or Pro plan is required; "
        "find it in the Merchant App).\n"
        "4. Call `roastify_receive_patron_credentials` to vault it.\n\n"
        "## What this operator does and does not do\n"
        "It reads the catalog, blends, variants, stock, and your own saved "
        "products, and it generates packaging artwork from designs you already "
        "saved in the Roastify Design Studio.\n\n"
        "It does NOT create, update, delete, or sync products, and it does not "
        "place orders. Product creation and storefront sync have no Roastify "
        "API surface at all — they are Merchant App capabilities. Order "
        "placement is deliberately left to Shopify and Roastify.\n\n"
        "## Artwork is template personalization\n"
        "`roastify_generate_artwork` rewrites the named text and image "
        "placeholders of a design you authored in Design Studio. It cannot "
        "author a design from scratch, and the artwork URL it returns is not "
        "attached to a product — you carry it onward yourself. Rendering is asynchronous: `roastify_generate_artwork` hands back a job id and `roastify_artwork_status` checks it, free.\n\n"
        "## Design library (a GitHub repo YOU own)\n"
        "Your designs live in a GitHub repo you own; the operator is only the "
        "broker, committing on your behalf with a vaulted token. So you get "
        "version history, and you can browse, rename, and delete designs in "
        "GitHub itself. `roastify_stash_design` commits one, `roastify_list_designs` "
        "lists them, `roastify_fetch_design` returns one, `roastify_delete_design` "
        "removes one. Storage only — the operator never writes a design onto a "
        "Roastify product (that needs your Merchant App session, done by the "
        "browser courier).\n"
        "One-time setup: deliver a GitHub fine-grained token (Contents read/write) "
        "and your 'owner/repo' via `roastify_request_patron_credentials` (fields "
        "`github_token`, `github_repo`). The repo needs at least one commit (a "
        "README) so its default branch exists.\n\n"
        "## Generate a branded variant in chat\n"
        "To spin a new product from a saved design without moving megabytes of "
        "artwork: call `roastify_get_design_text` to see the design's editable "
        "text layers (id + current text + font — no images), interview the patron "
        "or read a catalog item (`roastify_get_catalog_product`) for the facts, "
        "then call `roastify_update_design_text(design_id, edits={layer_id: text})` "
        "to save a new, text-edited design. The patron applies that new design onto "
        "the new product with the browser courier. The original is never changed and "
        "the image never leaves the library.\n"
        "`get_design_text` also returns `elements` (non-text: background art, rules, a "
        "graphic roast scale), `panels` (the box's front/back/left/right columns), a "
        "real `face` per item, and per-layer geometry. A header with no text value is "
        "NOT necessarily a defect — its value may be a graphic in `elements`, and a "
        "layer may not print at all; don't report a missing value as a production "
        "error. Dimensions are MEASURED text bounds, not fixed frames: text grows "
        "rather than clips, so hold a layer's line count and longest line and its "
        "footprint won't change.\n"
        "To ADD copy to an empty region (e.g. a bare side panel), "
        "`roastify_add_design_element(design_id, face, text, style_from, position)` "
        "places a new text element that inherits an existing layer's typography and "
        "is refused if it leaves the panel or overlaps anything. Position it absolutely "
        "{x,y} in an empty panel, or relative to a sibling {below: layer_id, gap: G}.\n\n"
        "## Pricing\n"
        "Tool prices are set dynamically by the operator's pricing model. Use "
        "`roastify_check_price` to preview costs and `roastify_check_balance` "
        "to see your balance."
    ),
)

# ---------------------------------------------------------------------------
# Tool registry — frozen UUIDs, minted once at tool birth, never changed.
# Renaming a capability leaves these intact so its pricing rows in Neon stay
# keyed correctly.
# ---------------------------------------------------------------------------

BROWSE_CATALOG_UUID      = "f6fb4072-4945-53f9-b000-40e835b50fda"
GET_CATALOG_PRODUCT_UUID = "0611ec3e-a3b4-5d66-beaf-1ee6ba3dd38c"
GET_BLEND_UUID           = "4020c387-6410-59ba-94b8-da41aafa30e8"
LIST_MY_PRODUCTS_UUID    = "4dafdf3e-6b7c-5690-a6ae-ae2d17163e0b"
GET_MY_PRODUCT_UUID      = "67fbe1e5-0bc4-59cd-a2ed-2b32965f9c90"
CHECK_STOCK_UUID         = "a145146f-f0d5-59c7-9d30-8365d800c09f"
GENERATE_ARTWORK_UUID    = "eba5986f-659c-58c2-b269-ce7a5c4b51fe"
ARTWORK_STATUS_UUID      = "d2fc68a3-95bd-5345-8e1c-9f8230db791c"
STASH_DESIGN_UUID        = "93564249-f06f-5be2-bea6-d9ce2a5b3a51"
FETCH_DESIGN_UUID        = "b2635db7-064b-5751-9b7f-dcabe176bc19"
LIST_DESIGNS_UUID        = "9bcfb147-3bfb-58dd-98f7-bdc1d83f5d4c"
DELETE_DESIGN_UUID       = "45014cff-c156-5f3e-bfea-dfb9131340d9"
GET_DESIGN_TEXT_UUID     = "2569b7b5-a380-59fa-a60b-32c3666c1e1b"
UPDATE_DESIGN_TEXT_UUID  = "0acef2a3-c54a-5134-a30b-9a15e01b98d5"
ADD_DESIGN_ELEMENT_UUID  = "d786f8d9-16a9-5e32-84ed-26edadc10ba9"
MOVE_ELEMENTS_UUID       = "8b69215b-1d6d-54ad-9e20-14460d123f40"

_DOMAIN_TOOLS = [
    ToolIdentity(
        tool_id=BROWSE_CATALOG_UUID, capability="browse_catalog", category="read",
        intent="List the Roastify catalog with coffee blends and plan tiers",
    ),
    ToolIdentity(
        tool_id=GET_CATALOG_PRODUCT_UUID, capability="get_catalog_product", category="read",
        intent="Get one catalog product with its variants and dieline template",
    ),
    ToolIdentity(
        tool_id=GET_BLEND_UUID, capability="get_blend", category="read",
        intent="Get one coffee blend with roast level and its variants",
    ),
    ToolIdentity(
        tool_id=LIST_MY_PRODUCTS_UUID, capability="list_my_products", category="read",
        intent="List the merchant's own saved product designs",
    ),
    ToolIdentity(
        tool_id=GET_MY_PRODUCT_UUID, capability="get_my_product", category="read",
        intent="Get one of the merchant's saved product designs",
    ),
    ToolIdentity(
        tool_id=CHECK_STOCK_UUID, capability="check_stock", category="read",
        intent="Check stock for one SKU or the whole list",
    ),
    ToolIdentity(
        tool_id=GENERATE_ARTWORK_UUID, capability="generate_artwork", category="write",
        intent="Generate packaging artwork from a saved Design Studio template",
    ),
    # Free by category — the wheel gates it without consulting Neon. Polling is how
    # you learn the work finished; metering each look would charge for waiting.
    ToolIdentity(
        tool_id=ARTWORK_STATUS_UUID, capability="artwork_status", category="free",
        intent="Check a Roastify artwork job",
    ),
    # Design library — the patron's own designs, held in the operator's Neon.
    # Storage only: none of these call Roastify. Writing a design onto a product
    # needs the merchant session and is done by the browser courier, not here.
    ToolIdentity(
        tool_id=STASH_DESIGN_UUID, capability="stash_design", category="write",
        intent="Store a Roastify design JSON in the patron's library",
    ),
    ToolIdentity(
        tool_id=FETCH_DESIGN_UUID, capability="fetch_design", category="read",
        intent="Fetch one stored design from the patron's library",
    ),
    ToolIdentity(
        tool_id=LIST_DESIGNS_UUID, capability="list_designs", category="read",
        intent="List the patron's stored designs",
    ),
    ToolIdentity(
        tool_id=DELETE_DESIGN_UUID, capability="delete_design", category="write",
        intent="Delete one stored design from the patron's library",
    ),
    # Field-level editing — read the text layers, write a text-edited variant.
    # Small on the wire (no images), so an agent can drive product copy in chat.
    ToolIdentity(
        tool_id=GET_DESIGN_TEXT_UUID, capability="get_design_text", category="read",
        intent="List the editable text layers of a stored design",
    ),
    ToolIdentity(
        tool_id=UPDATE_DESIGN_TEXT_UUID, capability="update_design_text", category="write",
        intent="Save a text-edited copy of a stored design as a new design",
    ),
    ToolIdentity(
        tool_id=ADD_DESIGN_ELEMENT_UUID, capability="add_design_element", category="write",
        intent="Add a new text element to a stored design, saved as a new design",
    ),
    ToolIdentity(
        tool_id=MOVE_ELEMENTS_UUID, capability="move_elements", category="write",
        intent="Shift a group of elements together and/or resize elements, saved as a new design",
    ),
]

TOOL_REGISTRY: dict[str, ToolIdentity] = {ti.tool_id: ti for ti in _DOMAIN_TOOLS}

# ---------------------------------------------------------------------------
# OperatorRuntime
# ---------------------------------------------------------------------------

runtime = OperatorRuntime(
    service_name="Roastify",
    tool_registry={**STANDARD_IDENTITIES, **TOOL_REGISTRY},
    operator_credential_template=CredentialTemplate(
        service="roastify-operator",
        version=1,
        description="Operator credentials for BTCPay Lightning payments",
        fields={
            "btcpay_host": FieldSpec(
                required=True, sensitive=True,
                description=(
                    "The URL of your BTCPay Server instance "
                    "(e.g. https://btcpay.example.com)."
                ),
            ),
            "btcpay_api_key": FieldSpec(
                required=True, sensitive=True,
                description=(
                    "Your BTCPay Server API key. Generate one in BTCPay "
                    "under Account > Manage Account > API Keys."
                ),
            ),
            "btcpay_store_id": FieldSpec(
                required=True, sensitive=True,
                description=(
                    "Your BTCPay Store ID. Find it in BTCPay under "
                    "Stores > Settings > General."
                ),
            ),
        },
    ),
    # Each patron brings their own Roastify key. This is the whole tenancy
    # model — see the module docstring for why a shared key would be wrong.
    patron_credential_template=CredentialTemplate(
        service="roastify",
        version=1,
        description="Your own Roastify Developer API credentials",
        fields={
            "api_key": FieldSpec(
                required=True, sensitive=True,
                description=(
                    "Your Roastify API key from the Merchant App. Requires a "
                    "Base or Pro plan. Live keys start with 'rty_live_'; "
                    "sandbox keys start with 'rty_test_' and do not fulfill."
                ),
            ),
            # The design library lives in a repo you own; the operator commits to
            # it on your behalf. Only needed if you use the library.
            "github_token": FieldSpec(
                required=False, sensitive=True,
                description=(
                    "A GitHub fine-grained personal access token with Contents "
                    "read/write on the repo that stores your designs. Only needed "
                    "for the design library."
                ),
            ),
            "github_repo": FieldSpec(
                required=False, sensitive=False,
                description=(
                    "The 'owner/repo' that holds your designs, e.g. "
                    "'goodbrew/coffee-designs'. Only needed for the design library."
                ),
            ),
            "github_branch": FieldSpec(
                required=False, sensitive=False,
                description="Branch for design commits (default 'main').",
            ),
        },
    ),
    operator_credential_greeting=(
        "Hi — I'm Roastify MCP, a Tollbooth service for AI agent access to the "
        "Roastify coffee catalog and artwork generation. You (the operator) "
        "need to provide BTCPay credentials."
    ),
    patron_credential_greeting=(
        "Hi — I'm Roastify MCP. You (or your AI agent) requested a credential "
        "channel. Reply with your own Roastify API key; it is encrypted at "
        "rest and used only for your calls."
    ),
    credential_validator=validate_btcpay_creds,
    on_forget=lambda service, npub: _on_credentials_forgotten(service, npub),
)


# One patron's Roastify key, held only long enough to spare the vault a read per
# call. Persistence is the SDK vault's job; nothing durable lives here.
_keys: SessionCache[str] = SessionCache(ttl_seconds=900)


def _on_credentials_forgotten(service: str, npub: str) -> None:
    """Drop the cached key so the next call re-reads the vault (and finds none)."""
    _keys.clear(npub)
    _revoked_npubs.add(npub)
    logger.info("Session cleared for %s (service=%s)", npub[:20], service)


tool = register_standard_tools(
    mcp,
    "roastify",
    runtime,
    service_name="roastify-mcp",
    service_version=__version__,
)

# ---------------------------------------------------------------------------
# Patron credential gate
# ---------------------------------------------------------------------------

_revoked_npubs: set[str] = set()

# Every lifecycle state gets its own sentence. A patron whose vault could not
# be READ must never be told to re-deliver credentials that are sitting in it,
# and a permanent operator-side fault must never be dressed as "try again".
_SESSION_GUIDANCE: dict[str, str] = {
    "no_credentials": (
        "No Roastify API key is stored for your identity. This is expected on "
        "first use. Action: call roastify_request_patron_credentials with your "
        "npub, then reply to the Nostr DM with your own Roastify key."
    ),
    "credentials_revoked": (
        "Your Roastify credentials were cleared by a previous "
        "forget_credentials call. Action: call "
        "roastify_request_patron_credentials to deliver a fresh key."
    ),
    "api_key_invalid": (
        "Your Roastify API key was found in the vault but could not be used — "
        "it may have been rotated or revoked in the Merchant App. Action: call "
        "roastify_request_patron_credentials to deliver a fresh key."
    ),
    "vault_bootstrapping": (
        "The server is establishing its encrypted connection to the credential "
        "vault. This happens once after a cold start. Action: repeat your "
        "request shortly — no re-onboarding needed."
    ),
    "secure_courier_unavailable": (
        "The Secure Courier isn't available yet, so the credential vault can't "
        "be reached. Your stored credentials are unaffected. Action: repeat "
        "your request shortly."
    ),
    "operator_not_configured": (
        "The vault answered but held no Roastify key for you. Action: call "
        "roastify_request_patron_credentials to deliver one."
    ),
    "persistence_quota_exceeded": (
        "The operator's database has reached its provider quota, so stored "
        "credentials cannot be read right now. Retrying will not help and your "
        "credentials are unaffected. Action: notify the operator — capacity is "
        "restored by their Authority."
    ),
    "persistence_misconfigured": (
        "The operator's credential store rejected the read with a permanent "
        "error. This will not resolve by retrying and your credentials are "
        "unaffected. Action: notify the operator."
    ),
}


async def _require_key(npub: str) -> str:
    """Resolve ``npub`` to that patron's Roastify key, or refuse by name.

    Hard gate with no operator fallback. A caller with no vaulted credential
    gets a structured instruction naming the courier flow — never a raw
    upstream 401 passed through.
    """
    if npub in _revoked_npubs:
        _keys.clear(npub)
        _revoked_npubs.discard(npub)
        raise ValueError(_SESSION_GUIDANCE["credentials_revoked"])

    cached = _keys.get(npub)
    if cached:
        return cached

    # The wheel hands back (creds, situation). A situation means the vault
    # could not be read AT ALL, which is emphatically not the same as a patron
    # who has never onboarded.
    creds, vault_situation = await runtime.load_patron_session(npub)
    if vault_situation:
        raise ValueError(
            _SESSION_GUIDANCE.get(vault_situation, _SESSION_GUIDANCE["vault_bootstrapping"]),
        )
    if creds and creds.get("api_key"):
        return _keys.set(npub, creds["api_key"])
    if creds is not None:
        raise ValueError(_SESSION_GUIDANCE["operator_not_configured"])
    raise ValueError(_SESSION_GUIDANCE["no_credentials"])


async def _call(npub: str, fn: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
    """Run a domain function under the patron's key, naming upstream failures.

    ``RoastifyError`` becomes a structured tool result rather than a stack
    trace or a silent empty — the caller learns whether they hit a rate limit,
    a plan gate, or a bad key.
    """
    api_key = await _require_key(npub)
    try:
        return await fn(api_key, *args, **kwargs)
    except roastify.RoastifyError as exc:
        if exc.status == 401:
            _keys.clear(npub)
        return exc.as_dict()


# ---------------------------------------------------------------------------
# Domain tools — reads
# ---------------------------------------------------------------------------

_NPUB = Annotated[
    str,
    Field(description="Required. Your Nostr public key (npub1...) for credit billing."),
]


@tool
@runtime.paid_tool(BROWSE_CATALOG_UUID)
async def browse_catalog(npub: _NPUB = "", dpop_token: str = "") -> dict[str, Any]:
    """Browse the Roastify catalog: products and coffee blends together.

    Plan-gated items are returned with their tier marked, not hidden.

    Note that Roastify's catalog carries no origin, altitude, processing, or
    varietal data — those live only in the Merchant App UI. Roast level and
    decaf status come from the blend.
    """
    return await _call(npub, roastify.browse_catalog)


@tool
@runtime.paid_tool(GET_CATALOG_PRODUCT_UUID)
async def get_catalog_product(product_id: str, npub: _NPUB = "",
                              dpop_token: str = "") -> dict[str, Any]:
    """Get one catalog product with its variants, sizes, prices, and dieline.

    Args:
        product_id: The catalog product id from browse_catalog.
    """
    return await _call(npub, roastify.get_catalog_product, product_id)


@tool
@runtime.paid_tool(GET_BLEND_UUID)
async def get_blend(blend_id: str, npub: _NPUB = "",
                    dpop_token: str = "") -> dict[str, Any]:
    """Get one coffee blend: roast level, decaf status, and its variants.

    Args:
        blend_id: The blend id from browse_catalog.
    """
    return await _call(npub, roastify.get_blend, blend_id)


@tool
@runtime.paid_tool(LIST_MY_PRODUCTS_UUID)
async def list_my_products(cursor: str = "", limit: int = 20, npub: _NPUB = "",
                           dpop_token: str = "") -> dict[str, Any]:
    """List your own saved Roastify product designs, one page at a time.

    Returns has_next_page and end_cursor so you can tell a page from a
    complete list.

    Args:
        cursor: Page cursor from a previous call's end_cursor. Omit for page 1.
        limit: Items per page (1-100, default 20).
    """
    return await _call(npub, roastify.list_my_products, cursor, limit)


@tool
@runtime.paid_tool(GET_MY_PRODUCT_UUID)
async def get_my_product(product_id: str, npub: _NPUB = "",
                         dpop_token: str = "") -> dict[str, Any]:
    """Get one of your saved product designs in full, with all its variants.

    The coffee's IDENTITY (which blend) is not a named field — it is encoded in the
    variant SKU, e.g. `COF-WHB-12O-HGL-BOX` → `HGL` → the High Lakes blend. Decode
    the SKU before writing origin/roast copy: a product's title can say one thing
    while its SKU is really a different blend.

    Args:
        product_id: Your product id from list_my_products.
    """
    return await _call(npub, roastify.get_my_product, product_id)


@tool
@runtime.paid_tool(CHECK_STOCK_UUID)
async def check_stock(sku: str = "", npub: _NPUB = "",
                      dpop_token: str = "") -> dict[str, Any]:
    """Check Roastify stock for one SKU, or the whole stock list.

    Args:
        sku: A variant SKU. Omit to get the full stock list.
    """
    return await _call(npub, roastify.check_stock, sku)


# ---------------------------------------------------------------------------
# Domain tools — artwork
# ---------------------------------------------------------------------------


@tool
@runtime.paid_tool(GENERATE_ARTWORK_UUID)
async def generate_artwork(
    product_id: str,
    fields: list[dict[str, Any]],
    client_req_id: str = "",
    npub: _NPUB = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Generate packaging artwork from one of your saved Design Studio designs.

    This personalizes a template you already authored: it rewrites that design's
    named text and image placeholders. It cannot author a design from scratch, and
    the artwork it produces is NOT attached to a product — Roastify's API has no
    product-create or storefront-sync surface. You get an artwork URL and carry it
    onward yourself.

    Roastify renders asynchronously, so this returns a job id straight away. Check
    it with roastify_artwork_status, which is free.

    Args:
        product_id: A saved design's id, from list_my_products.
        fields: Placeholders to rewrite, each
            {"fieldId": "placeholder_title", "type": "text"|"image",
             "value": "..."}. An image value must be an https:// URL.
        client_req_id: Your own idempotency key. Reusing it makes a repeated
            request safe — Roastify will not generate the artwork twice.
    """
    if not product_id:
        return {"success": False, "error": "product_id is required"}
    invalid = roastify.validate_artwork_fields(fields)
    if invalid:
        return {"success": False, "error": invalid}
    result = await _call(npub, roastify.start_artwork, product_id, fields, client_req_id)
    if result.get("success") is False:
        return result
    return {"success": True, **result}


@tool
@runtime.paid_tool(ARTWORK_STATUS_UUID)
async def artwork_status(job_id: str, npub: _NPUB = "",
                         dpop_token: str = "") -> dict[str, Any]:
    """Check a Roastify artwork job. Free — polling never costs anything.

    A finished job carries ``artwork_url``; a failed one carries ``error``.

    Args:
        job_id: The job id returned by roastify_generate_artwork.
    """
    if not job_id:
        return {"success": False, "error": "job_id is required"}
    result = await _call(npub, roastify.get_artwork_status, job_id)
    if result.get("success") is False:
        return result
    return {"success": True, **result}


# ---------------------------------------------------------------------------
# Design library — the patron's own designs, stored in a GitHub repo THEY own.
#
# Storage only. None of these tools call Roastify: the browser courier reads a
# product's design (merchant session) and stashes it here; an agent edits its
# text; the courier fetches it back and writes it onto a product. The operator
# is only the broker — it holds a vaulted GitHub token and commits on the
# patron's behalf. Git gives version history, free content-addressed image
# de-dup, and GitHub's own UI as the management surface.
# ---------------------------------------------------------------------------


_GITHUB_MISSING = (
    "No design-library repo is configured for your identity. The library lives "
    "in a GitHub repo you own; deliver a fine-grained GitHub token (Contents: "
    "read/write) and your 'owner/repo' via roastify_request_patron_credentials "
    "— fields github_token and github_repo (and optionally github_branch)."
)


async def _require_github(npub: str) -> github_store.GitHubStore:
    """Resolve ``npub`` to a client for that patron's design repo, or refuse."""
    creds, situation = await runtime.load_patron_session(npub)
    if situation:
        raise ValueError(_SESSION_GUIDANCE.get(situation, _SESSION_GUIDANCE["vault_bootstrapping"]))
    if not creds:
        raise ValueError(_SESSION_GUIDANCE["no_credentials"])
    token, repo = creds.get("github_token", ""), creds.get("github_repo", "")
    if not token or not repo:
        raise ValueError(_GITHUB_MISSING)
    return github_store.GitHubStore.from_spec(token, repo, creds.get("github_branch", ""))


async def _run_github(npub: str, op: Any) -> dict[str, Any]:
    """Run a design-library op against the patron's repo, naming failures."""
    try:
        store = await _require_github(npub)
    except ValueError as exc:
        return {"success": False, "error": str(exc)}
    try:
        return await op(store)
    except github_store.GitHubError as exc:
        return {"success": False, "error": str(exc), "status": exc.status}
    except Exception as exc:  # noqa: BLE001
        logger.warning("design library op failed: %s", exc)
        return {
            "success": False,
            "error": "The design library is temporarily unavailable; retry shortly.",
        }


@tool
@runtime.paid_tool(STASH_DESIGN_UUID)
async def stash_design(
    design: dict[str, Any],
    label: str = "",
    product_id: str = "",
    source_title: str = "",
    design_id: str = "",
    npub: _NPUB = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Store a Roastify design JSON in your library (a commit in your GitHub repo).

    The browser courier reads a saved product's design and calls this to shuttle it
    up. On the way in, the design's fonts[] is REPAIRED — Roastify's own schema
    migration leaves a lossy fonts[] (a dropped family, a bad weight), so a stashed
    design would otherwise carry that damage; the repair rebuilds fonts[] from the
    families the text actually uses so it renders in its intended fonts. Only the
    load list changes; the text and its fonts are untouched. Inline images are
    de-duplicated. This does NOT touch Roastify.

    Args:
        design: The full Roastify design JSON object (elements/faceBackgrounds…).
        label: Your name for this design, e.g. "Ethiopian — light".
        product_id: The Roastify product id it came from, for your reference.
        source_title: The product's title at stash time, for your reference.
        design_id: Optional explicit folder id. Omit and the id is the slug of the
            label, so re-stashing the same design commits a new version in place
            instead of creating a duplicate.
    """
    if not isinstance(design, dict) or not design:
        return {"success": False, "error": "design must be a non-empty JSON object"}

    async def op(store: github_store.GitHubStore) -> dict[str, Any]:
        meta = await store.put_design(
            design, design_id=design_id, label=label,
            product_id=product_id, source_title=source_title, repair=True,
        )
        return {"success": True, **meta}

    return await _run_github(npub, op)


@tool
@runtime.paid_tool(FETCH_DESIGN_UUID)
async def fetch_design(design_id: str, npub: _NPUB = "",
                       dpop_token: str = "") -> dict[str, Any]:
    """Fetch one of your stored designs in full, with its images re-inlined.

    Args:
        design_id: The id from roastify_stash_design or roastify_list_designs.
    """
    if not design_id:
        return {"success": False, "error": "design_id is required"}

    async def op(store: github_store.GitHubStore) -> dict[str, Any]:
        found = await store.get_design(design_id)
        if found is None:
            return {"success": False, "error": f"no design '{design_id}' in your library"}
        return {"success": True, **found}

    return await _run_github(npub, op)


@tool
@runtime.paid_tool(LIST_DESIGNS_UUID)
async def list_designs(npub: _NPUB = "", dpop_token: str = "") -> dict[str, Any]:
    """List your stored designs — metadata only, newest first."""

    async def op(store: github_store.GitHubStore) -> dict[str, Any]:
        designs = await store.list_designs()
        return {"success": True, "count": len(designs), "designs": designs}

    return await _run_github(npub, op)


@tool
@runtime.paid_tool(DELETE_DESIGN_UUID)
async def delete_design(design_id: str, npub: _NPUB = "",
                        dpop_token: str = "") -> dict[str, Any]:
    """Delete one of your stored designs.

    Args:
        design_id: The id from roastify_list_designs.
    """
    if not design_id:
        return {"success": False, "error": "design_id is required"}

    async def op(store: github_store.GitHubStore) -> dict[str, Any]:
        removed = await store.delete_design(design_id)
        return {"success": removed, "deleted": removed, "design_id": design_id}

    return await _run_github(npub, op)


@tool
@runtime.paid_tool(GET_DESIGN_TEXT_UUID)
async def get_design_text(design_id: str, npub: _NPUB = "",
                          dpop_token: str = "") -> dict[str, Any]:
    """List the editable text layers of a stored design — the fields you can change.

    Returns each text layer's id, current text, `chars` (its length), font, and box
    geometry (`fontSize`, `width`, `height`) — but NOT the design's images, so it
    stays small enough to reason over in a conversation. Each layer's current text
    is its own label: infer its role (product name, tagline, story, recipe, tasting
    notes, …) from the words it holds. The same name often appears in several layers
    and inside longer blurbs; change every id that should carry it.

    Also returns `sheet` (the overall design extent), `panels` (the box's panel
    columns — front/back/left/right — recovered from the dieline, each with bounds),
    and a real `face` per layer/element (which panel its x-centre sits on, not the
    constant "sheet"). And `elements` — the NON-text elements (images, shapes, rules)
    read-only, each with id, type, name, and bounds.
    Read those before judging the design: a header with no text value beneath it is
    NOT necessarily a defect — the value may be a graphic in `elements` (e.g. a
    five-dot roast scale under a ROAST header), and it tells you where NOT to place
    new text. Roastify's migrated format carries no visibility flag, so a layer that
    exists may still not print — do not report a missing value as a production error.

    Geometry: each layer's `x`/`y` is its top-left corner in design units (the sheet
    origin is its top-left). `width`/`height` are MEASURED text bounds, not fixed
    frames — text does not clip, it grows, so a revision that holds the line count
    and longest-line length keeps the footprint.

    Two things to respect:
    - A stash label states INTENT, not content: a design labeled for one coffee may
      still hold a donor template's words. Trust these layers, not the label.
    - `width` is the fixed wrap frame; `height` is the grown extent and re-measures
      when you edit the text. Keep each replacement within roughly ±10% of the
      layer's `chars`; longer copy grows the box downward and can overrun its
      neighbour, which the merchant then fixes by hand. `fontSize`/`width` gauge how
      tight a layer is; to change a label's `fontSize` (or its wrap frame), use
      roastify_move_elements.

    Pair with roastify_update_design_text to save your changes.

    Args:
        design_id: The id from roastify_list_designs.
    """
    if not design_id:
        return {"success": False, "error": "design_id is required"}

    async def op(store: github_store.GitHubStore) -> dict[str, Any]:
        found = await store.get_skeleton(design_id)
        if found is None:
            return {"success": False, "error": f"no design '{design_id}' in your library"}
        skeleton = found["skeleton"]
        product_type = skeleton.get("productType", "")
        panels = await dieline.panels_for(product_type)
        layers = github_store.text_layers(skeleton)
        elements = github_store.non_text_elements(skeleton)
        # Assign a real panel `face` by which body column each item's x-centre
        # falls in (derived from the dieline; the design itself only says "sheet").
        if panels:
            for item in [*layers, *elements]:
                x, w = item.get("x"), item.get("width")
                if isinstance(x, (int, float)) and isinstance(w, (int, float)):
                    item["face"] = dieline.face_of(x + w / 2, panels) or item.get("face")
        return {
            "success": True,
            "design_id": design_id,
            "label": found["label"],
            "product_id": found["product_id"],
            "product_type": product_type,
            "sheet": github_store.sheet_size(skeleton),
            "panels": panels,
            "count": len(layers),
            "layers": layers,
            "elements": elements,
        }

    return await _run_github(npub, op)


@tool
@runtime.paid_tool(UPDATE_DESIGN_TEXT_UUID)
async def update_design_text(
    design_id: str,
    edits: dict[str, str],
    label: str = "",
    npub: _NPUB = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Apply text edits to a stored design and commit a new version of it.

    The store is configuration management: the edit is committed back to the SAME
    design_id (git tracks the diff), not saved as a new file. Apply it onto a product
    with the browser courier. Only the words change — fonts, layout, and images are
    preserved, and the heavy image is never moved (the design keeps referencing the
    same content-addressed assets).

    The box does not resize, so keep each new text within roughly ±10% of the
    character count of the layer it replaces (see `chars` from get_design_text);
    longer copy overflows and the merchant fixes it by hand.

    Args:
        design_id: The design to edit, from roastify_list_designs.
        edits: A map of {layer_id: new_text}, using ids from roastify_get_design_text.
            Include every layer that should change, including ones that repeat a
            value or embed it in a longer blurb.
        label: Rename the design (optional). Defaults to keeping its current label.
    """
    if not design_id:
        return {"success": False, "error": "design_id is required"}
    edit_map = {str(k): str(v) for k, v in (edits or {}).items()}
    if not edit_map:
        return {"success": False, "error": "edits must be a non-empty {layer_id: new_text} map"}

    async def op(store: github_store.GitHubStore) -> dict[str, Any]:
        found = await store.get_skeleton(design_id)
        if found is None:
            return {"success": False, "error": f"no design '{design_id}' in your library"}
        skeleton = found["skeleton"]
        changed = github_store.apply_text_edits(skeleton, edit_map)
        if changed == 0:
            return {
                "success": False,
                "error": "none of those layer ids matched; call roastify_get_design_text for valid ids",
            }
        # Echo each edited layer's post-edit bounds so the caller can verify the
        # change landed. height re-measures with the new copy; width is the fixed
        # wrap frame and so is expected to hold.
        edited = []
        for lid in edit_map:
            el = github_store.find_element(skeleton, lid)
            if el and el.get("type") == "text":
                edited.append({
                    "id": lid, "chars": len(el.get("text", "")),
                    "width": el.get("width"), "height": el.get("height"),
                    "fontSize": el.get("fontSize"),
                })
        meta = await store.put_design(
            skeleton, design_id=design_id,
            label=label or found["label"],
            product_id=found["product_id"], source_title=found["source_title"],
            repair=True,  # heal Roastify's lossy migrated fonts[] on every save
        )
        return {
            "success": True,
            "design_id": meta["design_id"],
            "label": meta["label"],
            "layers_changed": changed,
            "layers": edited,
        }

    return await _run_github(npub, op)


# Inset kept clear of a panel edge. The dieline carries no real safe area
# (bleed is 0), so this is a conservative default, not a printer's spec.
_PANEL_MARGIN = 60


@tool
@runtime.paid_tool(ADD_DESIGN_ELEMENT_UUID)
async def add_design_element(
    design_id: str,
    face: str,
    text: str,
    style_from: str,
    position: dict[str, Any],
    width: int = 0,
    label: str = "",
    client_req_id: str = "",
    npub: _NPUB = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Add a new TEXT element to a design and commit a new version of it.

    The store is configuration management: the element is committed back to the SAME
    design_id (git tracks the diff). The new element's id comes back, so you can
    immediately edit its text by id with update_design_text.
    Placement is validated server-side and REFUSED, not warned: the element must
    fall inside the named panel (with a default margin — the dieline carries no real
    safe area) and must not overlap any existing element (the collider's id is
    named). Typography is inherited, so a new element matches the template.

    Args:
        design_id: The design to add to, from roastify_list_designs.
        face: The panel to place it on — one of the `panels` from get_design_text
            (e.g. "right"). The element's centre must land in that panel.
        text: The element's text (\\n for line breaks).
        style_from: An existing TEXT layer id (from get_design_text) whose font,
            size, weight, colour, alignment, and leading the new element inherits.
        position: Where to place it. Either absolute {"x": N, "y": M} (top-left in
            design units), or relative to an existing element:
            {"below"|"above"|"rightOf"|"leftOf": "layer_id", "gap": G}. Relative is
            best when there's a sibling to anchor to; an empty panel needs absolute.
        width: The text box (wrap) width in design units. Defaults to the panel
            width minus margins.
        label: Rename the design (optional). Defaults to keeping its current label.
        client_req_id: Your idempotency key.
    """
    for name, val in (("design_id", design_id), ("face", face), ("text", text), ("style_from", style_from)):
        if not val:
            return {"success": False, "error": f"{name} is required"}
    if not isinstance(position, dict) or not position:
        return {"success": False, "error": "position must be {x,y} or a relative anchor"}

    async def op(store: github_store.GitHubStore) -> dict[str, Any]:
        found = await store.get_skeleton(design_id)
        if found is None:
            return {"success": False, "error": f"no design '{design_id}' in your library"}
        design = found["skeleton"]
        panels = await dieline.panels_for(design.get("productType", ""))
        panel = panels.get(face.lower())
        if not panel:
            return {"success": False,
                    "error": f"unknown panel '{face}'; panels are {sorted(panels) or 'unavailable'}"}

        box_w = int(width) if width else max(80, panel["width"] - 2 * _PANEL_MARGIN)

        # Resolve position: absolute, or relative to an existing element.
        if "x" in position and "y" in position:
            px, py = float(position["x"]), float(position["y"])
        else:
            rel = next((k for k in ("below", "above", "rightOf", "leftOf") if k in position), "")
            ref = github_store.find_element(design, str(position.get(rel, ""))) if rel else None
            if ref is None:
                return {"success": False,
                        "error": "position needs {x,y} or a valid {below|above|rightOf|leftOf: layer_id}"}
            gap = float(position.get("gap", _PANEL_MARGIN))
            rx, ry, rw, rh = ref["x"], ref["y"], ref["width"], ref["height"]
            px, py = rx, ry
            if rel == "below":
                py = ry + rh + gap
            elif rel == "above":
                py = ry - gap  # top of the new box lands gap above the ref's top
            elif rel == "rightOf":
                px = rx + rw + gap
            elif rel == "leftOf":
                px = rx - gap

        el, err = github_store.build_text_element(
            design, text=text, style_from=style_from, x=px, y=py, width=box_w,
            new_id=f"add-{uuid.uuid4().hex[:8]}",
        )
        if el is None:
            return {"success": False, "error": err}

        # Refuse rather than warn: inside the panel (with margin), and no overlap.
        pl, pt = panel["x"] + _PANEL_MARGIN, panel["y"] + _PANEL_MARGIN
        pr, pb = panel["x"] + panel["width"] - _PANEL_MARGIN, panel["y"] + panel["height"] - _PANEL_MARGIN
        if not (pl <= el["x"] and el["x"] + el["width"] <= pr and pt <= el["y"] and el["y"] + el["height"] <= pb):
            return {"success": False,
                    "error": (f"element ({el['x']},{el['y']} {el['width']}x{el['height']}) falls outside the "
                              f"'{face}' panel safe box (x {pl}–{pr}, y {pt}–{pb}). Move it or narrow the width.")}
        hit = github_store.first_collision(el, design)
        if hit:
            return {"success": False, "error": f"element would overlap existing element '{hit}'. Reposition it."}

        design.setdefault("elements", []).append(el)
        meta = await store.put_design(
            design, design_id=design_id, label=label or found["label"],
            product_id=found["product_id"], source_title=found["source_title"],
            repair=True,  # heal Roastify's lossy migrated fonts[] on every save
        )
        return {
            "success": True,
            "design_id": meta["design_id"],
            "element_id": el["id"],
            "face": face.lower(),
            "placed": {"x": el["x"], "y": el["y"], "width": el["width"], "height": el["height"]},
        }

    return await _run_github(npub, op)


@tool
@runtime.paid_tool(MOVE_ELEMENTS_UUID)
async def move_elements(
    design_id: str,
    edits: list[dict[str, Any]],
    label: str = "",
    npub: _NPUB = "",
    dpop_token: str = "",
) -> dict[str, Any]:
    """Move a group of elements together and/or resize elements; commit a new version.

    The Designer can move only one layer at a time, so a block of layered content
    (a spec panel, a logo lockup) drifts out of alignment when its backing shape is
    moved alone. This relocks that block: name the ids and shift them as one rigid
    object, and separately re-centre or resize individual rectangles. The store is
    configuration management: the edit is committed back to the SAME design_id (git
    tracks the diff). Apply it onto the product with the browser courier.

    Nothing is validated against panel bounds here (unlike add_design_element): you
    are re-aligning existing, deliberately-placed content, so the caller owns the
    coordinates. The heavy background image is never moved unless you name its id.

    Args:
        design_id: The design to edit, from roastify_list_designs.
        edits: A list of geometry edits, each one of:
            - group shift: {"ids": ["a", "b", ...], "dx": N, "dy": M} — add the same
              delta to every listed element's x/y (design units; +dy is down, +dx is
              right). Use this to move a whole block together.
            - absolute set: {"id": "a", "x": ?, "y": ?, "width": ?, "height": ?,
              "fontSize": ?} — set only the keys you include. What the size keys mean
              depends on the element: on a RECTANGLE/line/image, width and height are
              the frame and set directly; on a TEXT layer, width is the wrap frame and
              fontSize the type size (both settable) while height is DERIVED — it
              re-measures from the reflowed text, and a height you pass for a text
              layer is ignored. Use fontSize to match one label's size to a peer.
            Get element ids and their current geometry from roastify_get_design_text.
        label: Rename the design (optional). Defaults to keeping its current label.
    """
    if not design_id:
        return {"success": False, "error": "design_id is required"}
    if not isinstance(edits, list) or not edits:
        return {"success": False, "error": "edits must be a non-empty list of geometry edits"}

    async def op(store: github_store.GitHubStore) -> dict[str, Any]:
        found = await store.get_skeleton(design_id)
        if found is None:
            return {"success": False, "error": f"no design '{design_id}' in your library"}
        design = found["skeleton"]
        changed, missing = github_store.edit_geometry(design, edits)
        if changed == 0:
            return {
                "success": False,
                "error": (f"no elements matched; unknown ids: {missing}. "
                          "Call roastify_get_design_text for valid ids." if missing
                          else "edits changed nothing; each edit needs {ids,dx,dy} or {id,x/y/width/height}"),
            }
        # Echo the post-edit geometry of every element the edits touched (text
        # layers report their re-measured height and any new fontSize) so the
        # caller verifies against ground truth, not stale numbers.
        touched: list[str] = []
        for e in edits:
            if e.get("ids"):
                touched += [str(i) for i in e["ids"]]
            elif e.get("id") is not None:
                touched.append(str(e["id"]))
        elements = []
        for tid in dict.fromkeys(touched):
            el = github_store.find_element(design, tid)
            if el:
                elements.append({
                    "id": tid, "type": el.get("type"),
                    "x": el.get("x"), "y": el.get("y"),
                    "width": el.get("width"), "height": el.get("height"),
                    "fontSize": el.get("fontSize"),
                })
        meta = await store.put_design(
            design, design_id=design_id, label=label or found["label"],
            product_id=found["product_id"], source_title=found["source_title"],
            repair=True,  # heal Roastify's lossy migrated fonts[] on every save
        )
        return {
            "success": True,
            "design_id": meta["design_id"],
            "label": meta["label"],
            "elements_changed": changed,
            "unknown_ids": missing,
            "elements": elements,
        }

    return await _run_github(npub, op)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    """Main entry point for the server."""
    from tollbooth import validate_operator_tools

    missing = validate_operator_tools(mcp, "roastify")
    if missing:
        import sys

        print(
            f"⚠ Missing base-catalog tools: {', '.join(missing)}",
            file=sys.stderr,
        )
    mcp.run()


if __name__ == "__main__":
    main()
