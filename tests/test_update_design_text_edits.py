"""update_design_text must accept multi-key edits whether dict or JSON string.

Field report #38: a two-key ``edits`` payload failed FastMCP/Pydantic schema
validation when it arrived as a JSON string (``Input should be a valid
dictionary``), while the same keys succeeded as two single-key calls. Batching
related copy changes into one call is one commit; the parameter must accept the
serialized form some MCP clients send.
"""

from __future__ import annotations

import json

import pytest
from fastmcp.tools.function_tool import FunctionTool
from pydantic import TypeAdapter, ValidationError

from roastify_mcp.server import _STR_DICT, coerce_str_dict

# ---------------------------------------------------------------------------
# pure coercion (the boundary the tool now relies on)
# ---------------------------------------------------------------------------


def test_coerce_str_dict_accepts_native_multi_key_dict():
    out = coerce_str_dict({"FKl8797y6-": "Colombia - Medium", "ajQ2zyLf6B": "Brew"})
    assert out == {"FKl8797y6-": "Colombia - Medium", "ajQ2zyLf6B": "Brew"}


def test_coerce_str_dict_accepts_multi_key_json_string():
    """The #38 failure mode: two keys, delivered as one JSON object string."""
    payload = json.dumps({
        "FKl8797y6-": "Colombia - Medium",
        "ajQ2zyLf6B": "Pour a silky cappuccino.\nTemp 93°C → bloom.",
    })
    out = coerce_str_dict(payload)
    assert set(out) == {"FKl8797y6-", "ajQ2zyLf6B"}
    assert out["FKl8797y6-"] == "Colombia - Medium"
    assert "93°C" in out["ajQ2zyLf6B"] and "→" in out["ajQ2zyLf6B"]


def test_coerce_str_dict_accepts_single_key_json_string():
    out = coerce_str_dict('{"FKl8797y6-": "Colombia - Medium"}')
    assert out == {"FKl8797y6-": "Colombia - Medium"}


def test_coerce_str_dict_stringifies_non_str_values():
    assert coerce_str_dict({1: 2}) == {"1": "2"}


def test_coerce_str_dict_rejects_non_object_json():
    with pytest.raises(ValueError, match="map"):
        coerce_str_dict('["not", "an", "object"]')


def test_coerce_str_dict_rejects_invalid_json():
    with pytest.raises(ValueError, match="invalid JSON"):
        coerce_str_dict("not-json{")


def test_coerce_str_dict_empty_string_is_empty_map():
    assert coerce_str_dict("") == {}
    assert coerce_str_dict("   ") == {}


# ---------------------------------------------------------------------------
# Annotated type used on the tool parameter (FastMCP validation path)
# ---------------------------------------------------------------------------


def test_str_dict_typeadapter_accepts_multi_key_json_string():
    ta = TypeAdapter(_STR_DICT)
    multi = '{"a": "one", "b": "two"}'
    assert ta.validate_python(multi) == {"a": "one", "b": "two"}
    assert ta.validate_python({"a": "one", "b": "two"}) == {"a": "one", "b": "two"}


def test_str_dict_typeadapter_still_rejects_non_object():
    ta = TypeAdapter(_STR_DICT)
    with pytest.raises(ValidationError):
        ta.validate_python(["a"])


@pytest.mark.asyncio
async def test_fastmcp_tool_run_accepts_multi_key_edits_as_json_string():
    """End-to-end at the FastMCP boundary — the exact ValidationError from #38."""

    def sample(edits: _STR_DICT) -> dict:
        return {"n": len(edits), "keys": sorted(edits)}

    tool = FunctionTool.from_function(sample)

    # Native dict (always worked).
    ok_dict = await tool.run({"edits": {"a": "1", "b": "2"}})
    assert json.loads(ok_dict.content[0].text) == {"n": 2, "keys": ["a", "b"]}

    # Multi-key JSON string — this is the regression #38 reported.
    multi = json.dumps({
        "FKl8797y6-": "Colombia - Medium",
        "ajQ2zyLf6B": "Pour a silky cappuccino.",
    })
    ok_str = await tool.run({"edits": multi})
    body = json.loads(ok_str.content[0].text)
    assert body["n"] == 2
    assert body["keys"] == ["FKl8797y6-", "ajQ2zyLf6B"]

    # Single-key JSON string still works.
    ok_one = await tool.run({"edits": '{"a": "only"}'})
    assert json.loads(ok_one.content[0].text) == {"n": 1, "keys": ["a"]}
