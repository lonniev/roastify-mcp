"""Roastify Developer API client.

Pure domain logic: every function takes an ``api_key`` and returns a plain
dict. No npub, no billing, no SDK imports — monetization lives in
``server.py``.

The API is documented at https://docs.roastify.app/ but the prose guides are
incomplete; the authoritative surface is the OpenAPI spec at
https://docs.roastify.app/openapi.json (version 0.3.1, marked beta and
"subject to change" — expect to follow breaking upstream edits).

Auth is a per-merchant API key in the ``x-api-key`` header. Keys are
environment-prefixed: ``rty_test_`` is a sandbox that does not fulfill,
``rty_live_`` is production. Everything the API returns is scoped to the
merchant account behind the key, which is why this operator vaults a key per
patron rather than holding one of its own.

Money is USD in cents throughout. We pass it through unrescaled and label the
unit rather than converting, so a 2400 cannot be misread as dollars.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

_BASE = "https://api.roastify.app/v1"
_TIMEOUT = 20.0

# Upstream allows 100 requests/min per key. Composed tools fan out a few
# GETs per call, so keep the fan-out small and bounded.
_MAX_FANOUT = 8


class RoastifyError(Exception):
    """An upstream failure worth surfacing to the caller by name.

    Carries the upstream ``code``/``message`` when Roastify supplies them so a
    tool can report *what* went wrong rather than a generic failure. Never
    carries the API key.
    """

    def __init__(self, message: str, *, status: int | None = None, code: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code

    def as_dict(self) -> dict[str, Any]:
        return {
            "success": False,
            "error": str(self),
            "upstream_status": self.status,
            "upstream_code": self.code,
        }


def _headers(api_key: str, idempotency_key: str = "") -> dict[str, str]:
    """Build request headers. The key is never logged or echoed."""
    headers = {"x-api-key": api_key, "accept": "application/json"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    return headers


def _interpret(resp: httpx.Response) -> RoastifyError | None:
    """Map a non-2xx response to a named error, or None if it succeeded.

    Roastify returns ``{"code": ..., "message": ...}`` on failure. 429 and 403
    get their own wording because they are actionable in different ways — a
    rate limit clears on its own, a plan gate does not.
    """
    if resp.is_success:
        return None
    code: Any = None
    detail = ""
    try:
        body = resp.json()
    except ValueError:
        # Not JSON — an edge/proxy error page. Fall through to the status wording.
        body = None
    if isinstance(body, dict):
        code = body.get("code")
        # Roastify's own message may name the resource; it never contains the key.
        detail = str(body.get("message") or "")

    if resp.status_code == 429:
        msg = "Roastify rate limit reached (100 requests/minute per API key). Retry shortly."
    elif resp.status_code == 401:
        msg = "Roastify rejected the API key. It may have been rotated or revoked."
    elif resp.status_code == 403:
        msg = detail or "Roastify denied access. This resource may require a higher plan tier."
    elif resp.status_code == 404:
        msg = detail or "Roastify has no such resource."
    else:
        msg = detail or f"Roastify returned HTTP {resp.status_code}."
    return RoastifyError(msg, status=resp.status_code, code=code)


async def _get(client: httpx.AsyncClient, path: str, api_key: str,
               params: dict[str, Any] | None = None) -> Any:
    resp = await client.get(f"{_BASE}{path}", headers=_headers(api_key), params=params or {})
    error = _interpret(resp)
    if error is not None:
        raise error
    return resp.json()


async def _get_optional(client: httpx.AsyncClient, path: str, api_key: str) -> Any:
    """GET that degrades to ``None`` instead of failing the whole composed call.

    Used only for the *enrichment* legs of a composed read (variants, stock).
    The primary resource still raises — a caller must never receive a
    confidently-empty answer when the thing they asked for could not be read.
    """
    try:
        return await _get(client, path, api_key)
    except RoastifyError:
        return None


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


async def browse_catalog(api_key: str) -> dict[str, Any]:
    """List catalog products alongside the coffee blends, plan tier marked.

    Two collections, one answer: an agent choosing a coffee needs the product
    (format, category) and the blend (roast level, decaf) together.

    Plan-gated items are returned with their tier marked, never omitted — a
    caller on Base should still be able to see that a Pro product exists.
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        products, blends = await asyncio.gather(
            _get(client, "/catalog/products", api_key),
            _get_optional(client, "/catalog/blends", api_key),
        )
    return {
        "success": True,
        "products": products,
        "blends": blends if blends is not None else [],
        "blends_available": blends is not None,
        "price_unit": "USD cents",
        "note": (
            "Catalog detail carries no origin, altitude, processing, or varietal — "
            "those exist only in the Roastify Merchant App UI. Roast level and decaf "
            "status come from the blend; everything else about a coffee's character "
            "is prose in its description."
        ),
    }


async def get_catalog_product(api_key: str, product_id: str) -> dict[str, Any]:
    """One catalog item with its variants folded in.

    Includes ``dielineTemplateUrl`` — the print template a designer needs to
    author artwork outside Design Studio.
    """
    if not product_id:
        return {"success": False, "error": "product_id is required"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        product = await _get(client, f"/catalog/products/{product_id}", api_key)
        variants = await _get_optional(client, f"/variants/product/{product_id}", api_key)
    return {
        "success": True,
        "product": product,
        "variants": variants if variants is not None else [],
        "variants_available": variants is not None,
        "price_unit": "USD cents",
    }


async def get_blend(api_key: str, blend_id: str) -> dict[str, Any]:
    """One coffee blend with its variants.

    The blend is where the only machine-readable palate signal lives:
    ``roastLevel`` and ``isDecaf``.
    """
    if not blend_id:
        return {"success": False, "error": "blend_id is required"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        blend = await _get(client, f"/catalog/blends/{blend_id}", api_key)
        variants = await _get_optional(client, f"/variants/blend/{blend_id}", api_key)
    return {
        "success": True,
        "blend": blend,
        "variants": variants if variants is not None else [],
        "variants_available": variants is not None,
        "price_unit": "USD cents",
    }


# ---------------------------------------------------------------------------
# The merchant's own saved products
# ---------------------------------------------------------------------------


async def list_my_products(api_key: str, cursor: str = "", limit: int = 20) -> dict[str, Any]:
    """The merchant's saved designs, one cursor page at a time.

    Pagination is reported honestly: ``has_next_page`` and ``end_cursor`` come
    straight from upstream so a caller can tell a page from a complete list.
    """
    limit = max(1, min(int(limit or 20), 100))
    params: dict[str, Any] = {"limit": limit}
    if cursor:
        params["cursor"] = cursor
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        data = await _get(client, "/products", api_key, params)
    page = data.get("pageInfo") or {} if isinstance(data, dict) else {}
    products = data.get("products") if isinstance(data, dict) else data
    return {
        "success": True,
        "products": products or [],
        "end_cursor": page.get("endCursor"),
        "has_next_page": bool(page.get("hasNextPage")),
        "price_unit": "USD cents",
    }


async def get_my_product(api_key: str, product_id: str) -> dict[str, Any]:
    """One of the merchant's saved designs in full."""
    if not product_id:
        return {"success": False, "error": "product_id is required"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        product = await _get(client, f"/products/{product_id}", api_key)
    return {"success": True, "product": product, "price_unit": "USD cents"}


async def check_stock(api_key: str, sku: str = "") -> dict[str, Any]:
    """Stock for one SKU, or the whole stock list when ``sku`` is empty."""
    path = f"/stock/{sku}" if sku else "/stock"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        stock = await _get(client, path, api_key)
    return {"success": True, "sku": sku or None, "stock": stock}


# ---------------------------------------------------------------------------
# Artwork
# ---------------------------------------------------------------------------


def validate_artwork_fields(fields: list[dict[str, Any]]) -> str | None:
    """Return an error message if ``fields`` is malformed, else ``None``.

    Tool arguments arrive from an AI agent and are treated as adversarial.
    Upstream requires every entry to carry ``fieldId``, ``type`` (only ``text``
    or ``image``), and ``value``; an image value must be a URL it can fetch.
    Rejecting here turns a 422 into a sentence the agent can act on.
    """
    if not isinstance(fields, list) or not fields:
        return "fields must be a non-empty list of {fieldId, type, value} objects"
    for i, field in enumerate(fields):
        if not isinstance(field, dict):
            return f"fields[{i}] must be an object with fieldId, type, and value"
        missing = [k for k in ("fieldId", "type", "value") if not field.get(k)]
        if missing:
            return f"fields[{i}] is missing {', '.join(missing)}"
        if field["type"] not in ("text", "image"):
            return f"fields[{i}].type must be 'text' or 'image', got {field['type']!r}"
        if field["type"] == "image" and not str(field["value"]).startswith("https://"):
            return f"fields[{i}] is an image field, so its value must be an https:// URL"
    return None


async def start_artwork(api_key: str, product_id: str, fields: list[dict[str, Any]],
                        idempotency_key: str = "") -> dict[str, Any]:
    """Kick off artwork generation. Returns the upstream job id.

    ``product_id`` names a design already saved in the Roastify Merchant App —
    this endpoint personalizes an existing template by rewriting its named
    placeholders. It cannot author a design from scratch.
    """
    body = {"productId": product_id, "fields": fields}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{_BASE}/artwork/new",
            headers=_headers(api_key, idempotency_key),
            json=body,
        )
    error = _interpret(resp)
    if error is not None:
        raise error
    data = resp.json()
    return {"job_id": data.get("jobId"), "status": data.get("status")}


async def get_artwork_status(api_key: str, job_id: str) -> dict[str, Any]:
    """Poll one artwork job. Terminal states carry ``artworkUrl`` or ``error``."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        data = await _get(client, f"/artwork/status/{job_id}", api_key)
    return {
        "job_id": data.get("jobId", job_id),
        "status": data.get("status"),
        "artwork_url": data.get("artworkUrl"),
        "error": data.get("error"),
    }


# Upstream never publishes its status vocabulary, so treat anything that is not
# a known terminal state as still-running rather than guessing it failed.
_DONE = {"COMPLETED", "COMPLETE", "SUCCEEDED", "SUCCESS", "DONE", "READY", "FINISHED"}
_FAILED = {"FAILED", "FAILURE", "ERROR", "CANCELED", "CANCELLED"}


def artwork_terminal_state(status: Any) -> str | None:
    """Classify an upstream status as ``done``, ``failed``, or ``None`` (running)."""
    token = str(status or "").strip().upper()
    if token in _DONE:
        return "done"
    if token in _FAILED:
        return "failed"
    return None


async def generate_artwork(api_key: str, product_id: str, fields: list[dict[str, Any]],
                           idempotency_key: str = "",
                           max_wait_seconds: int = 600,
                           poll_seconds: float = 3.0) -> dict[str, Any]:
    """Start artwork generation and poll it to a terminal state.

    This is the body of the durable job runner. It is deliberately the only
    place that blocks: the tool that requests artwork returns a claim check
    immediately, and this runs detached where a long wait costs nothing.

    Raises :class:`RoastifyError` on upstream failure so the SDK's job store
    records the failure and refunds — the operator does not keep a fare for
    work that did not produce artwork.
    """
    started = await start_artwork(api_key, product_id, fields, idempotency_key)
    job_id = started.get("job_id")
    if not job_id:
        raise RoastifyError("Roastify accepted the request but returned no job id.")

    waited = 0.0
    last = {"job_id": job_id, "status": started.get("status")}
    while waited < max_wait_seconds:
        await asyncio.sleep(poll_seconds)
        waited += poll_seconds
        last = await get_artwork_status(api_key, job_id)
        state = artwork_terminal_state(last.get("status"))
        if state == "done":
            return {
                "success": True,
                "job_id": job_id,
                "status": last.get("status"),
                "artwork_url": last.get("artwork_url"),
                "waited_seconds": int(waited),
            }
        if state == "failed":
            raise RoastifyError(
                last.get("error") or f"Roastify artwork generation ended as {last.get('status')}.",
                code=last.get("status"),
            )

    # Not a failure — the job may still finish. Say which, and hand back the
    # upstream id so the caller can keep asking without paying to start over.
    raise RoastifyError(
        f"Roastify artwork job {job_id} was still {last.get('status')!r} after "
        f"{int(waited)}s. It may still complete — poll it with roastify_artwork_status.",
        code="still_running",
    )
