"""Unit tests for the Roastify API client.

Tool arguments arrive from an AI agent, so the adversarial cases matter as
much as the happy paths: malformed field lists, missing ids, plan gates, rate
limits, and upstream responses that are the wrong shape.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from roastify_mcp import roastify

KEY = "rty_test_abc123"
BASE = "https://api.roastify.app/v1"


# ---------------------------------------------------------------------------
# Catalog reads
# ---------------------------------------------------------------------------


@respx.mock
async def test_browse_catalog_joins_products_and_blends():
    respx.get(f"{BASE}/catalog/products").mock(
        return_value=httpx.Response(200, json=[{"id": "p1", "title": "12oz Box", "plan": "BASE"}]),
    )
    respx.get(f"{BASE}/catalog/blends").mock(
        return_value=httpx.Response(200, json=[{"id": "b1", "name": "Sunrise", "roastLevel": "MEDIUM"}]),
    )

    result = await roastify.browse_catalog(KEY)

    assert result["success"] is True
    assert result["products"][0]["id"] == "p1"
    assert result["blends"][0]["roastLevel"] == "MEDIUM"
    assert result["blends_available"] is True


@respx.mock
async def test_browse_catalog_survives_blend_outage_but_says_so():
    """An enrichment leg may fail softly; the caller must be able to tell."""
    respx.get(f"{BASE}/catalog/products").mock(
        return_value=httpx.Response(200, json=[{"id": "p1"}]),
    )
    respx.get(f"{BASE}/catalog/blends").mock(return_value=httpx.Response(500, json={}))

    result = await roastify.browse_catalog(KEY)

    assert result["success"] is True
    assert result["blends"] == []
    assert result["blends_available"] is False, "an empty list must not pass as 'no blends exist'"


@respx.mock
async def test_primary_resource_failure_raises_rather_than_returning_empty():
    """If the thing actually asked for cannot be read, do not answer confidently."""
    respx.get(f"{BASE}/catalog/products").mock(return_value=httpx.Response(500, json={}))
    respx.get(f"{BASE}/catalog/blends").mock(return_value=httpx.Response(200, json=[]))

    with pytest.raises(roastify.RoastifyError):
        await roastify.browse_catalog(KEY)


@respx.mock
async def test_get_catalog_product_folds_in_variants():
    respx.get(f"{BASE}/catalog/products/p1").mock(
        return_value=httpx.Response(200, json={"id": "p1", "dielineTemplateUrl": "https://x/d.pdf"}),
    )
    respx.get(f"{BASE}/variants/product/p1").mock(
        return_value=httpx.Response(200, json=[{"sku": "S1", "retailPrice": 2400}]),
    )

    result = await roastify.get_catalog_product(KEY, "p1")

    assert result["variants"][0]["retailPrice"] == 2400
    assert result["price_unit"] == "USD cents", "cents must be labeled, never silently rescaled"


async def test_get_catalog_product_rejects_empty_id():
    result = await roastify.get_catalog_product(KEY, "")
    assert result["success"] is False


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------


@respx.mock
async def test_list_my_products_surfaces_pagination_honestly():
    respx.get(f"{BASE}/products").mock(
        return_value=httpx.Response(
            200,
            json={
                "products": [{"id": "u1"}],
                "pageInfo": {"endCursor": "cur42", "hasNextPage": True},
            },
        ),
    )

    result = await roastify.list_my_products(KEY)

    assert result["has_next_page"] is True
    assert result["end_cursor"] == "cur42"


@respx.mock
async def test_list_my_products_clamps_absurd_limits():
    route = respx.get(f"{BASE}/products").mock(
        return_value=httpx.Response(200, json={"products": [], "pageInfo": {}}),
    )

    await roastify.list_my_products(KEY, limit=100_000)

    assert route.calls.last.request.url.params["limit"] == "100"


# ---------------------------------------------------------------------------
# Error interpretation — different causes must never share one reason
# ---------------------------------------------------------------------------


@respx.mock
async def test_rate_limit_is_named_as_a_rate_limit():
    respx.get(f"{BASE}/stock").mock(return_value=httpx.Response(429, json={"code": 429}))

    with pytest.raises(roastify.RoastifyError) as excinfo:
        await roastify.check_stock(KEY)

    assert "rate limit" in str(excinfo.value).lower()
    assert excinfo.value.status == 429


@respx.mock
async def test_plan_gate_is_not_reported_as_a_bad_key():
    respx.get(f"{BASE}/stock").mock(
        return_value=httpx.Response(403, json={"code": 403, "message": "Pro plan required"}),
    )

    with pytest.raises(roastify.RoastifyError) as excinfo:
        await roastify.check_stock(KEY)

    assert "Pro plan required" in str(excinfo.value)
    assert "key" not in str(excinfo.value).lower()


@respx.mock
async def test_bad_key_is_named_as_a_bad_key():
    respx.get(f"{BASE}/stock").mock(return_value=httpx.Response(401, json={}))

    with pytest.raises(roastify.RoastifyError) as excinfo:
        await roastify.check_stock(KEY)

    assert excinfo.value.status == 401


@respx.mock
async def test_error_payload_never_echoes_the_api_key():
    respx.get(f"{BASE}/stock").mock(return_value=httpx.Response(500, json={"message": "boom"}))

    try:
        await roastify.check_stock(KEY)
    except roastify.RoastifyError as exc:
        assert KEY not in str(exc)
        assert KEY not in repr(exc.as_dict())


# ---------------------------------------------------------------------------
# Artwork field validation — adversarial input
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "fields",
    [
        [],
        "not a list",
        [{"fieldId": "t", "type": "text"}],                       # no value
        [{"type": "text", "value": "v"}],                          # no fieldId
        [{"fieldId": "t", "type": "video", "value": "v"}],         # bad type
        [{"fieldId": "t", "type": "image", "value": "not-a-url"}],  # image not a URL
        ["a string, not an object"],
    ],
)
def test_validate_artwork_fields_rejects_malformed_input(fields):
    assert roastify.validate_artwork_fields(fields) is not None


def test_validate_artwork_fields_accepts_a_well_formed_list():
    assert roastify.validate_artwork_fields([
        {"fieldId": "placeholder_title", "type": "text", "value": "Sunrise Blend"},
        {"fieldId": "hero", "type": "image", "value": "https://example.com/a.png"},
    ]) is None


# ---------------------------------------------------------------------------
# Artwork lifecycle
# ---------------------------------------------------------------------------


@respx.mock
async def test_start_artwork_sends_idempotency_key():
    route = respx.post(f"{BASE}/artwork/new").mock(
        return_value=httpx.Response(202, json={"jobId": "j1", "status": "QUEUED"}),
    )

    await roastify.start_artwork(KEY, "p1", [{"fieldId": "t", "type": "text", "value": "v"}],
                                 idempotency_key="req-7")

    assert route.calls.last.request.headers["Idempotency-Key"] == "req-7"
    assert route.calls.last.request.headers["x-api-key"] == KEY


@respx.mock
async def test_start_artwork_omits_idempotency_header_when_unset():
    route = respx.post(f"{BASE}/artwork/new").mock(
        return_value=httpx.Response(202, json={"jobId": "j1", "status": "QUEUED"}),
    )

    await roastify.start_artwork(KEY, "p1", [{"fieldId": "t", "type": "text", "value": "v"}])

    assert "Idempotency-Key" not in route.calls.last.request.headers


@respx.mock
async def test_get_artwork_status_passes_the_upstream_state_through():
    """The status vocabulary is Roastify's. Report it; do not reinterpret it."""
    respx.get(f"{BASE}/artwork/status/j1").mock(
        return_value=httpx.Response(200, json={"jobId": "j1", "status": "COMPLETED",
                                               "artworkUrl": "https://cdn/x.png"}),
    )

    result = await roastify.get_artwork_status(KEY, "j1")

    assert result["status"] == "COMPLETED"
    assert result["artwork_url"] == "https://cdn/x.png"


@respx.mock
async def test_a_failed_job_carries_the_upstream_error():
    respx.get(f"{BASE}/artwork/status/j2").mock(
        return_value=httpx.Response(200, json={"jobId": "j2", "status": "FAILED",
                                               "error": "template field missing"}),
    )

    result = await roastify.get_artwork_status(KEY, "j2")

    assert result["status"] == "FAILED"
    assert result["error"] == "template field missing"
    assert result["artwork_url"] is None
