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
from typing import Annotated, Any

from fastmcp import FastMCP
from pydantic import Field
from tollbooth.credential_templates import CredentialTemplate, FieldSpec
from tollbooth.credential_validators import validate_btcpay_creds
from tollbooth.runtime import OperatorRuntime, register_standard_tools
from tollbooth.tool_identity import STANDARD_IDENTITIES, ToolIdentity

from roastify_mcp import __version__, roastify
from roastify_mcp.config import get_settings
from roastify_mcp.session import clear_session, get_session, set_session

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
        "attached to a product — you carry it onward yourself.\n\n"
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
FETCH_ARTWORK_UUID       = "27fab358-1f94-5e30-91a5-245bfd07f9e4"
ARTWORK_STATUS_UUID      = "d2fc68a3-95bd-5345-8e1c-9f8230db791c"

ARTWORK_JOB_KIND = "roastify_artwork"

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
        tool_id=GENERATE_ARTWORK_UUID, capability="generate_artwork", category="heavy",
        intent="Generate packaging artwork from a saved Design Studio template",
    ),
    ToolIdentity(
        tool_id=FETCH_ARTWORK_UUID, capability="fetch_artwork", category="read",
        intent="Redeem an artwork claim check",
    ),
    ToolIdentity(
        tool_id=ARTWORK_STATUS_UUID, capability="artwork_status", category="read",
        intent="Poll a Roastify artwork job directly by its upstream job id",
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


def _on_credentials_forgotten(service: str, npub: str) -> None:
    """Drop the cached key so the next call re-reads the vault (and finds none)."""
    clear_session(npub)
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
        clear_session(npub)
        _revoked_npubs.discard(npub)
        raise ValueError(_SESSION_GUIDANCE["credentials_revoked"])

    session = get_session(npub)
    if session:
        return session.api_key

    # The wheel hands back (creds, situation). A situation means the vault
    # could not be read AT ALL, which is emphatically not the same as a patron
    # who has never onboarded.
    creds, vault_situation = await runtime.load_patron_session(npub)
    if vault_situation:
        raise ValueError(
            _SESSION_GUIDANCE.get(vault_situation, _SESSION_GUIDANCE["vault_bootstrapping"]),
        )
    if creds and creds.get("api_key"):
        return set_session(npub, creds["api_key"]).api_key
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
            clear_session(npub)
        return exc.as_dict()


# ---------------------------------------------------------------------------
# Artwork job runner — registered by name so a recycled container can resume
# ---------------------------------------------------------------------------


async def _run_artwork_job(npub: str = "", product_id: str = "",
                           fields: list[dict[str, Any]] | None = None,
                           idempotency_key: str = "", **_: Any) -> dict[str, Any]:
    """Perform one artwork generation, start to finish, off the request path.

    Raises on failure so the SDK's job store records it and refunds the fare —
    the operator keeps nothing for work that produced no artwork.
    """
    settings = get_settings()
    api_key = await _require_key(npub)
    return await roastify.generate_artwork(
        api_key,
        product_id,
        fields or [],
        idempotency_key=idempotency_key,
        max_wait_seconds=settings.artwork_max_runtime_seconds,
    )


runtime.register_job_runner(ARTWORK_JOB_KIND, _run_artwork_job)


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

    This personalizes a template you already authored: it rewrites that
    design's named text and image placeholders. It cannot author a design from
    scratch, and the artwork it produces is NOT attached to a product —
    Roastify's API has no product-create or storefront-sync surface. You get an
    artwork URL and carry it onward yourself.

    Generation is asynchronous, so this returns a claim check immediately.
    Redeem it with roastify_fetch_artwork.

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

    # Prove the patron is onboarded BEFORE persisting a job — a claim check
    # that can only ever resolve to "you have no credentials" is worse than a
    # refusal here.
    await _require_key(npub)

    settings = get_settings()
    return await runtime.start_async_job(
        ARTWORK_JOB_KIND,
        npub,
        {
            "npub": npub,
            "product_id": product_id,
            "fields": fields,
            "idempotency_key": client_req_id,
        },
        tool_id=GENERATE_ARTWORK_UUID,
        max_runtime_seconds=settings.artwork_max_runtime_seconds,
        result_ttl_seconds=settings.artwork_result_ttl_seconds,
        expected_seconds=settings.artwork_expected_seconds,
    )


@tool
@runtime.paid_tool(FETCH_ARTWORK_UUID)
async def fetch_artwork(claim: str, npub: _NPUB = "",
                        dpop_token: str = "") -> dict[str, Any]:
    """Redeem an artwork claim check from roastify_generate_artwork.

    Reports every lifecycle state as guidance, including still-running. A job
    that fails refunds its fare.

    Args:
        claim: The claim check returned by roastify_generate_artwork.
    """
    return await runtime.fetch_async_job(claim, npub)


@tool
@runtime.paid_tool(ARTWORK_STATUS_UUID)
async def artwork_status(job_id: str, npub: _NPUB = "",
                         dpop_token: str = "") -> dict[str, Any]:
    """Poll a Roastify artwork job directly by its upstream job id.

    An escape hatch for a job whose claim check outlived its result window, or
    one that was still running when the durable runner gave up. Prefer
    roastify_fetch_artwork with a claim check.

    Args:
        job_id: The Roastify job id.
    """
    if not job_id:
        return {"success": False, "error": "job_id is required"}
    result = await _call(npub, roastify.get_artwork_status, job_id)
    if result.get("success") is False:
        return result
    return {"success": True, **result}


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
