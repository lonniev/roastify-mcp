"""Unit tests for the per-patron design library store.

The store's job is to survive a 2.3 MB design (99 % of it one inline image)
through Neon's HTTP-SQL layer without loss, de-duplicating the heavy image
across a patron's variations. The independent oracle throughout is
byte-identity: what comes back must equal what went in.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from roastify_mcp import design_store as ds

# A design shaped like Roastify's current format: an inline base64 image (the
# heavy part), a text layer, and a fonts[] array.
_IMG = "data:image/png;base64," + ("A" * 900_000)  # forces multi-chunk storage
DESIGN: dict[str, Any] = {
    "schema": "konva-v1",
    "productType": "CoffeeBox12oz",
    "elements": [
        {"type": "image", "id": "bg", "src": _IMG},
        {"type": "text", "id": "t1", "fontFamily": "Poppins", "text": "Ethiopia"},
    ],
    "faceBackgrounds": {"front": "white"},
    "fonts": [{"family": "Poppins", "weights": [400, 700]}],
}


# ---------------------------------------------------------------------------
# Pure asset externalization
# ---------------------------------------------------------------------------


def test_externalize_inline_is_byte_identical():
    skeleton, assets = ds._externalize(DESIGN)
    assert json.dumps(ds._inline(skeleton, assets), sort_keys=True) == json.dumps(
        DESIGN, sort_keys=True
    )


def test_externalize_lifts_the_heavy_image_out_of_the_skeleton():
    skeleton, assets = ds._externalize(DESIGN)
    skeleton_json = json.dumps(skeleton)
    assert _IMG not in skeleton_json  # the megabyte never rides in the design row
    assert len(assets) == 1
    assert set(ds._ASSET_REF.findall(skeleton_json)) == set(assets)


def test_externalize_does_not_mutate_the_caller():
    before = json.dumps(DESIGN, sort_keys=True)
    ds._externalize(DESIGN)
    assert json.dumps(DESIGN, sort_keys=True) == before


# ---------------------------------------------------------------------------
# A fake Neon vault: dicts behind the handful of statements the store issues.
# Enough to prove the SQL-path logic (upsert, chunk, dedup, reassemble) without
# a live database.
# ---------------------------------------------------------------------------


class FakeVault:
    def __init__(self) -> None:
        self.designs: dict[tuple[str, str], dict[str, Any]] = {}
        self.assets: dict[str, dict[int, str]] = {}
        self.asset_writes = 0
        self._schema_prefix = ""

    def _t(self, table: str) -> str:
        return table

    async def _execute(self, query: str, params: list[Any] | None = None) -> dict[str, Any]:
        q = " ".join(query.split())
        p = params or []
        if q.startswith("CREATE TABLE"):
            return {}
        if "SELECT 1 FROM roastify_design_assets" in q:
            return {"rows": [{"n": 1}] if p[0] in self.assets else []}
        if q.startswith("INSERT INTO roastify_design_assets"):
            self.assets.setdefault(p[0], {})[p[1]] = p[2]
            self.asset_writes += 1
            return {"rowCount": 1}
        if "SELECT content FROM roastify_design_assets" in q:
            chunks = self.assets.get(p[0], {})
            return {"rows": [{"content": chunks[i]} for i in sorted(chunks)]}
        if q.startswith("INSERT INTO roastify_designs"):
            npub, did, label, product_id, source_title, skeleton, nbytes = p
            self.designs[(npub, did)] = {
                "design_id": did, "label": label, "product_id": product_id,
                "source_title": source_title, "skeleton": skeleton, "bytes": nbytes,
                "updated_at": "2026-08-12T00:00:00Z",
            }
            return {"rowCount": 1}
        if "WHERE npub = $1 AND design_id = $2" in q and q.startswith("SELECT"):
            row = self.designs.get((p[0], p[1]))
            return {"rows": [row] if row else []}
        if "ORDER BY updated_at DESC" in q:
            return {"rows": [r for (n, _), r in self.designs.items() if n == p[0]]}
        if q.startswith("DELETE FROM roastify_designs"):
            existed = (p[0], p[1]) in self.designs
            self.designs.pop((p[0], p[1]), None)
            return {"rowCount": 1 if existed else 0}
        raise AssertionError(f"unhandled query: {q[:90]}")


@pytest.fixture(autouse=True)
def _reset_schema_flag():
    ds._schema_ready = False
    yield
    ds._schema_ready = False


NPUB = "npub1patron"


async def test_put_then_get_is_byte_identical():
    v = FakeVault()
    meta = await ds.put_design(v, NPUB, DESIGN, label="Ethiopia", product_id="p1")
    got = await ds.get_design(v, NPUB, meta["design_id"])
    assert got is not None
    assert json.dumps(got["design"], sort_keys=True) == json.dumps(DESIGN, sort_keys=True)
    assert got["label"] == "Ethiopia"


async def test_identical_image_is_stored_once_across_variants():
    v = FakeVault()
    await ds.put_design(v, NPUB, DESIGN, label="v1")
    writes_after_first = v.asset_writes
    # A second design reusing the same image writes NO new asset chunks.
    variant = json.loads(json.dumps(DESIGN))
    variant["elements"][1]["text"] = "Colombia"
    await ds.put_design(v, NPUB, variant, label="v2")
    assert v.asset_writes == writes_after_first  # deduped by content hash
    assert len(v.designs) == 2


async def test_get_missing_returns_none_and_list_and_delete():
    v = FakeVault()
    assert await ds.get_design(v, NPUB, "nope") is None
    m = await ds.put_design(v, NPUB, DESIGN, label="only")
    listed = await ds.list_designs(v, NPUB)
    assert [d["design_id"] for d in listed] == [m["design_id"]]
    assert "skeleton" not in listed[0]  # metadata only, never the bytes
    assert await ds.delete_design(v, NPUB, m["design_id"]) is True
    assert await ds.delete_design(v, NPUB, m["design_id"]) is False
    assert await ds.list_designs(v, NPUB) == []


async def test_stash_is_scoped_by_npub():
    v = FakeVault()
    m = await ds.put_design(v, NPUB, DESIGN, label="mine")
    # Another patron cannot see or fetch it.
    assert await ds.get_design(v, "npub1stranger", m["design_id"]) is None
    assert await ds.list_designs(v, "npub1stranger") == []


# ---------------------------------------------------------------------------
# Field-level text read / edit
# ---------------------------------------------------------------------------


def test_text_layers_lists_only_text_with_ids():
    layers = ds.text_layers(DESIGN)
    assert [(x["id"], x["text"]) for x in layers] == [("t1", "Ethiopia")]
    assert layers[0]["fontFamily"] == "Poppins"


def test_apply_text_edits_changes_only_named_layers():
    d = json.loads(json.dumps(DESIGN))
    changed = ds.apply_text_edits(d, {"t1": "Colombia", "missing": "x"})
    assert changed == 1
    assert ds.text_layers(d)[0]["text"] == "Colombia"
    # the image element is untouched
    assert d["elements"][0]["src"] == _IMG


async def test_get_skeleton_never_inlines_images():
    v = FakeVault()
    m = await ds.put_design(v, NPUB, DESIGN, label="e")
    skel = await ds.get_skeleton(v, NPUB, m["design_id"])
    assert skel is not None
    # the heavy image is an asset:// marker in the skeleton, not the base64
    assert _IMG not in json.dumps(skel["skeleton"])
    assert "asset://" in json.dumps(skel["skeleton"])


async def test_update_via_store_makes_new_design_sharing_the_image():
    v = FakeVault()
    m = await ds.put_design(v, NPUB, DESIGN, label="master")
    writes = v.asset_writes
    skel = (await ds.get_skeleton(v, NPUB, m["design_id"]))["skeleton"]
    ds.apply_text_edits(skel, {"t1": "Guatemala"})
    m2 = await ds.put_design(v, NPUB, skel, label="Guatemala")
    # New design, no new asset chunks (the image is shared by content hash)…
    assert m2["design_id"] != m["design_id"]
    assert v.asset_writes == writes
    # …and fetching the new one re-inlines the shared image with the new text.
    got = await ds.get_design(v, NPUB, m2["design_id"])
    assert got["design"]["elements"][0]["src"] == _IMG
    assert ds.text_layers(got["design"])[0]["text"] == "Guatemala"
