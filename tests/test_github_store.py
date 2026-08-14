"""Unit tests for the GitHub-backed design library.

The store's job is to survive a design (with a heavy inline image) through a repo
without loss, de-duplicating the image across variants, and to project the text
layers for editing. The independent oracle throughout is byte-identity of the
re-inlined design, and the recorded set of files in a fake repo.
"""

from __future__ import annotations

import base64
import json
from typing import Any

import httpx
import pytest
import respx

from roastify_mcp import github_store as gs

# A design shaped like Roastify's current format: a large inline image (lifted to
# a file), a small inline SVG (kept inline), a text layer with geometry.
_BIG_IMG = "data:image/png;base64," + ("A" * 80_000)   # decodes+re-encodes canonically
_SMALL_SVG = "data:image/svg+xml;base64," + ("B" * 400)
DESIGN: dict[str, Any] = {
    "schema": "konva-v1",
    "sheet": {"width": 3900, "height": 5700},
    "elements": [
        {"type": "image", "id": "bg", "x": 0, "y": 0, "width": 3900, "height": 5700, "src": _BIG_IMG},
        {"type": "shape", "id": "sc", "name": "roast-scale", "x": 100, "y": 200, "width": 300, "height": 40},
        {"type": "image", "id": "ic", "x": 50, "y": 50, "width": 120, "height": 120, "src": _SMALL_SVG},
        {"type": "text", "id": "t1", "fontFamily": "Poppins", "fontSize": 63,
         "x": 500, "y": 900, "width": 578, "height": 77, "text": "Ethiopia"},
    ],
}


# ---------------------------------------------------------------------------
# pure helpers
# ---------------------------------------------------------------------------


def test_externalize_lifts_only_large_images():
    skeleton, assets = gs.externalize(DESIGN)
    s = json.dumps(skeleton)
    assert _BIG_IMG not in s          # the megabyte image left as a marker…
    assert "asset://" in s
    assert _SMALL_SVG in s            # …but the small SVG stays inline
    assert len(assets) == 1


def test_externalize_inline_roundtrip_preserves_the_image():
    skeleton, assets = gs.externalize(DESIGN)
    back = gs.inline(skeleton, assets)
    assert json.dumps(back, sort_keys=True) == json.dumps(DESIGN, sort_keys=True)


def test_text_layers_carries_geometry():
    layers = gs.text_layers(DESIGN)
    assert [(x["id"], x["text"]) for x in layers] == [("t1", "Ethiopia")]
    assert layers[0]["chars"] == len("Ethiopia")
    assert layers[0]["fontSize"] == 63 and layers[0]["width"] == 578
    assert layers[0]["x"] == 500 and layers[0]["y"] == 900   # position for placement


def test_non_text_elements_lists_shapes_and_images_with_bounds():
    els = gs.non_text_elements(DESIGN)
    by = {e["id"]: e for e in els}
    assert set(by) == {"bg", "sc", "ic"}          # every non-text element, no text
    assert by["sc"]["type"] == "shape" and by["sc"]["name"] == "roast-scale"
    assert by["sc"]["x"] == 100 and by["sc"]["width"] == 300
    assert "src" not in by["bg"]                   # read-only bounds, not the bytes
    assert all(e["type"] != "text" for e in els)


def test_sheet_size():
    assert gs.sheet_size(DESIGN) == {"width": 3900, "height": 5700}
    assert gs.sheet_size({}) == {"width": None, "height": None}


# ---------------------------------------------------------------------------
# element creation
# ---------------------------------------------------------------------------


def test_estimate_text_height_tracks_lines():
    one = gs.estimate_text_height("hi", 100, 10_000)          # fits one line
    assert one == round(100 * 1.21)
    three = gs.estimate_text_height("a\nb\nc", 50, 10_000)     # explicit newlines
    assert three == round(3 * 50 * 1.21)


def test_build_text_element_inherits_style():
    d = json.loads(json.dumps(DESIGN))
    el, err = gs.build_text_element(d, text="New copy", style_from="t1",
                                    x=3100, y=1200, width=700, new_id="add-x")
    assert err == "" and el is not None
    assert el["fontFamily"] == "Poppins" and el["fontSize"] == 63   # inherited from t1
    assert (el["x"], el["y"], el["width"], el["id"]) == (3100, 1200, 700, "add-x")
    assert el["height"] > 0


def test_build_text_element_rejects_bad_style_from():
    d = json.loads(json.dumps(DESIGN))
    el, err = gs.build_text_element(d, text="x", style_from="bg", x=0, y=0, width=100, new_id="a")
    assert el is None and "not text" in err                  # bg is an image
    el2, err2 = gs.build_text_element(d, text="x", style_from="nope", x=0, y=0, width=100, new_id="a")
    assert el2 is None and "not found" in err2


def test_first_collision_skips_background_flags_content():
    d = json.loads(json.dumps(DESIGN))
    # bg is the full-sheet image → ignored; sc is the small roast-scale shape (100,200,300,40).
    over_scale = {"id": "new", "x": 150, "y": 210, "width": 50, "height": 20}
    assert gs.first_collision(over_scale, d) == "sc"
    clear = {"id": "new", "x": 3200, "y": 1200, "width": 400, "height": 300}   # empty right area
    assert gs.first_collision(clear, d) is None


def test_edit_geometry_group_shift_moves_together():
    d = json.loads(json.dumps(DESIGN))
    changed, missing = gs.edit_geometry(d, [{"ids": ["sc", "t1"], "dx": 10, "dy": -5}])
    assert (changed, missing) == (2, [])
    by = {e["id"]: e for e in d["elements"]}
    assert (by["sc"]["x"], by["sc"]["y"]) == (110, 195)   # 100+10, 200-5
    assert (by["t1"]["x"], by["t1"]["y"]) == (510, 895)   # 500+10, 900-5
    assert by["bg"]["x"] == 0 and by["bg"]["y"] == 0       # unnamed element untouched


def test_edit_geometry_absolute_set_only_named_keys():
    d = json.loads(json.dumps(DESIGN))
    changed, missing = gs.edit_geometry(d, [{"id": "sc", "x": 250, "width": 500}])
    assert (changed, missing) == (1, [])
    sc = {e["id"]: e for e in d["elements"]}["sc"]
    assert sc["x"] == 250 and sc["width"] == 500
    assert sc["y"] == 200 and sc["height"] == 40           # keys not named are preserved


def test_edit_geometry_reports_unknown_ids():
    d = json.loads(json.dumps(DESIGN))
    changed, missing = gs.edit_geometry(d, [{"ids": ["sc", "nope"], "dx": 1, "dy": 0}])
    assert changed == 1 and missing == ["nope"]


def test_edit_geometry_translates_line_endpoints():
    # A line carries its geometry in absolute x1/y1/x2/y2 (and points), not x/y —
    # shifting x/y alone would leave the drawn line behind.
    d = {"elements": [{"type": "shape", "shape": "line", "id": "ln",
                       "x": 100, "y": 200, "width": 3, "height": 90,
                       "x1": 100, "y1": 200, "x2": 100, "y2": 290,
                       "points": [100, 200, 100, 290]}]}
    changed, missing = gs.edit_geometry(d, [{"ids": ["ln"], "dx": 10, "dy": -5}])
    assert (changed, missing) == (1, [])
    ln = d["elements"][0]
    assert (ln["x"], ln["y"]) == (110, 195)
    assert (ln["x1"], ln["y1"], ln["x2"], ln["y2"]) == (110, 195, 110, 285)
    assert ln["points"] == [110, 195, 110, 285]


def test_edit_geometry_absolute_set_moves_line_endpoints_too():
    d = {"elements": [{"type": "shape", "shape": "line", "id": "ln",
                       "x": 100, "y": 200, "width": 3, "height": 90,
                       "x1": 100, "y1": 200, "x2": 100, "y2": 290}]}
    gs.edit_geometry(d, [{"id": "ln", "x": 130}])   # implied dx=+30
    ln = d["elements"][0]
    assert ln["x"] == 130 and ln["x1"] == 130 and ln["x2"] == 130
    assert ln["y1"] == 200 and ln["y2"] == 290       # y untouched


def test_apply_text_edits_changes_only_named_layers():
    d = json.loads(json.dumps(DESIGN))
    assert gs.apply_text_edits(d, {"t1": "Colombia", "nope": "x"}) == 1
    assert gs.text_layers(d)[0]["text"] == "Colombia"
    assert d["elements"][0]["src"] == _BIG_IMG   # image untouched


@pytest.mark.parametrize("spec,owner,repo", [
    ("goodbrew/coffee", "goodbrew", "coffee"),
    ("https://github.com/goodbrew/coffee.git", "goodbrew", "coffee"),
    ("https://github.com/goodbrew/coffee", "goodbrew", "coffee"),
])
def test_from_spec_parses_repo_forms(spec, owner, repo):
    store = gs.GitHubStore.from_spec("tok", spec)
    assert store.owner == owner and store.repo == repo and store.branch == "main"


def test_from_spec_rejects_bad_repo():
    with pytest.raises(gs.GitHubError):
        gs.GitHubStore.from_spec("tok", "not-a-repo")


@respx.mock
async def test_get_file_small_uses_contents_api():
    store = gs.GitHubStore("tok", "owner", "repo", "main")
    respx.get(url__regex=r"contents/designs/x/meta\.json").mock(
        return_value=httpx.Response(200, json={
            "encoding": "base64", "content": base64.b64encode(b'{"a":1}').decode()}))
    async with httpx.AsyncClient() as client:
        assert await store._get_file(client, "designs/x/meta.json") == b'{"a":1}'


@respx.mock
async def test_get_file_large_falls_back_to_blob_api():
    # GitHub's Contents API returns EMPTY content for files >1MB (encoding "none");
    # _get_file must then fetch the git blob by sha, or the artwork comes back empty.
    store = gs.GitHubStore("tok", "owner", "repo", "main")
    payload = b"\x89PNG\r\n\x1a\n" + b"pixels" * 300_000    # ~1.8MB
    respx.get(url__regex=r"contents/assets/big\.png").mock(
        return_value=httpx.Response(200, json={"encoding": "none", "content": "", "sha": "blob1"}))
    respx.get(url__regex=r"git/blobs/blob1").mock(
        return_value=httpx.Response(200, json={
            "encoding": "base64", "content": base64.b64encode(payload).decode()}))
    async with httpx.AsyncClient() as client:
        got = await store._get_file(client, "assets/big.png")
    assert got == payload    # full image recovered, not an empty string


# ---------------------------------------------------------------------------
# font repair — undo Roastify's lossy migration
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("v,n", [("bold", 700), ("normal", 400), (700, 700), ("300", 300), (None, 400), ("weird", 400)])
def test_weight_num(v, n):
    assert gs._weight_num(v) == n


def test_used_fonts_collects_families_and_weights():
    d = {"elements": [
        {"type": "text", "id": "a", "fontFamily": "Montserrat", "fontWeight": "bold", "text": "X"},
        {"type": "text", "id": "b", "fontFamily": "Montserrat", "fontWeight": "normal", "text": "Y"},
        {"type": "text", "id": "c", "fontFamily": "Roboto", "text": "Z"},
        {"type": "image", "id": "i", "src": "x"},
    ]}
    used = gs.used_fonts(d)
    assert used["Montserrat"] == {400, 700}
    assert used["Roboto"] == {400}
    assert "i" not in used


_FONTY = {
    "elements": [
        {"type": "text", "id": "a", "fontFamily": "Montserrat", "fontWeight": "bold", "text": "Bold"},
        {"type": "text", "id": "b", "fontFamily": "Montserrat", "fontWeight": "normal", "text": "Reg"},
        {"type": "text", "id": "c", "fontFamily": "Fjalla One", "fontWeight": "bold", "text": "Head"},
        {"type": "text", "id": "d", "fontFamily": "Roboto", "fontWeight": "normal", "text": "Body"},
    ],
    "fonts": [{"family": "STALE"}],  # the damaged list Roastify's migration left
}


@respx.mock
async def test_repair_fonts_rebuilds_with_resolvable_urls():
    # Google keeps Montserrat's weights but drops Fjalla One's (it has no 700).
    def side_effect(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        return httpx.Response(200, text="dropped" if "Fjalla" in url else "@font-face Montserrat")
    respx.get(url__regex=r"fonts\.googleapis\.com").mock(side_effect=side_effect)

    d = json.loads(json.dumps(_FONTY))
    fonts = await gs.repair_fonts(d)
    by = {f["family"]: f for f in fonts}
    assert set(by) == {"Montserrat", "Fjalla One", "Roboto"}
    assert by["Montserrat"]["url"].endswith(":wght@400;700&display=swap")   # valid weights kept
    assert ":wght@" not in by["Fjalla One"]["url"]                          # invalid weight → plain family
    assert ":wght@" not in by["Roboto"]["url"]                             # single 400 → plain, no fetch
    # non-destructive: the stale fonts[] is replaced, but text + fontFamily untouched
    assert d["fonts"] == fonts
    assert d["elements"][0]["fontFamily"] == "Montserrat" and d["elements"][0]["text"] == "Bold"


async def test_put_with_repair_rebuilds_fonts_and_reports_them():
    r = FakeGitHubStore()
    # DESIGN's one text layer is Poppins at the default (400) weight, so repair
    # needs no network (single-400 → plain family). Copy — repair mutates fonts[].
    meta = await r.put_design(json.loads(json.dumps(DESIGN)), label="e", repair=True)
    assert meta["fonts_repaired"] == ["Poppins"]
    stored = json.loads(r.files[f"designs/{meta['design_id']}/design.json"])
    assert [f["family"] for f in stored["fonts"]] == ["Poppins"]


# ---------------------------------------------------------------------------
# A fake repo: an in-memory {path: bytes} behind the three file primitives.
# ---------------------------------------------------------------------------


class FakeGitHubStore(gs.GitHubStore):
    def __init__(self) -> None:
        super().__init__("tok", "owner", "repo", "main")
        self.files: dict[str, bytes] = {"README.md": b"# designs"}
        self.commits = 0
        self.blob_writes = 0

    async def _get_file(self, client: Any, path: str) -> bytes | None:  # type: ignore[override]
        return self.files.get(path)

    async def _list_dir(self, client: Any, path: str) -> list[dict[str, Any]]:  # type: ignore[override]
        prefix = path.rstrip("/") + "/"
        seen: dict[str, str] = {}
        for p in self.files:
            if not p.startswith(prefix):
                continue
            rest = p[len(prefix):]
            head = rest.split("/", 1)
            name = head[0]
            seen[name] = "dir" if len(head) > 1 else "file"
        return [{"name": n, "path": prefix + n, "type": t} for n, t in seen.items()]

    async def _commit(self, client: Any, message: str,  # type: ignore[override]
                      writes: dict[str, bytes], deletes: list[str]) -> str:
        self.blob_writes += len(writes)
        self.files.update(writes)
        for d in deletes:
            self.files.pop(d, None)
        self.commits += 1
        return f"sha{self.commits}"


async def test_put_then_get_roundtrips_the_full_design():
    r = FakeGitHubStore()
    meta = await r.put_design(DESIGN, label="Ethiopia", product_id="p1")
    did = meta["design_id"]
    assert f"designs/{did}/design.json" in r.files
    assert f"designs/{did}/content.json" in r.files
    assert f"designs/{did}/meta.json" in r.files
    assert any(p.startswith("assets/") for p in r.files)   # image externalized to assets/
    got = await r.get_design(did)
    assert json.dumps(got["design"], sort_keys=True) == json.dumps(DESIGN, sort_keys=True)
    assert got["label"] == "Ethiopia"


async def test_put_id_is_the_label_slug_and_re_put_commits_in_place():
    r = FakeGitHubStore()
    a = await r.put_design(DESIGN, label="Ethiopian SO — Light")
    assert a["design_id"] == "ethiopian-so-light"          # deterministic slug, no hash
    variant = json.loads(json.dumps(DESIGN))
    variant["elements"][3]["text"] = "Colombia"
    b = await r.put_design(variant, label="Ethiopian SO — Light")
    assert b["design_id"] == a["design_id"]                # same folder — a new version, not a sibling
    dirs = {p.split("/")[1] for p in r.files if p.startswith("designs/")}
    assert dirs == {"ethiopian-so-light"}                  # exactly one design folder


async def test_put_with_explicit_design_id_overwrites_that_folder():
    r = FakeGitHubStore()
    await r.put_design(DESIGN, design_id="canonical", label="whatever the label")
    assert "designs/canonical/design.json" in r.files
    dirs = {p.split("/")[1] for p in r.files if p.startswith("designs/")}
    assert dirs == {"canonical"}                            # label did not spawn a slug folder


async def test_image_is_stored_once_across_variants():
    r = FakeGitHubStore()
    await r.put_design(DESIGN, label="v1")
    asset_paths = {p for p in r.files if p.startswith("assets/")}
    writes_after_first = r.blob_writes
    variant = json.loads(json.dumps(DESIGN))
    variant["elements"][2]["text"] = "Colombia"
    await r.put_design(variant, label="v2")
    # No new asset blob — the second commit reused the existing content-addressed file.
    assert {p for p in r.files if p.startswith("assets/")} == asset_paths
    new_writes = r.blob_writes - writes_after_first
    assert new_writes == 3  # design.json + content.json + meta.json only, no asset


async def test_list_newest_first_then_delete():
    r = FakeGitHubStore()
    a = await r.put_design(DESIGN, label="A")
    b = await r.put_design(DESIGN, label="B")
    listed = await r.list_designs()
    ids = {d["design_id"] for d in listed}
    assert ids == {a["design_id"], b["design_id"]}
    assert "skeleton" not in listed[0]        # metadata only
    assert await r.delete_design(a["design_id"]) is True
    assert await r.delete_design(a["design_id"]) is False   # already gone
    assert not any(p.startswith(f"designs/{a['design_id']}/") for p in r.files)


async def test_get_skeleton_never_inlines_the_image():
    r = FakeGitHubStore()
    m = await r.put_design(DESIGN, label="e")
    skel = await r.get_skeleton(m["design_id"])
    assert skel is not None
    assert _BIG_IMG not in json.dumps(skel["skeleton"])
    assert "asset://" in json.dumps(skel["skeleton"])


async def test_edit_flow_new_design_shares_image():
    r = FakeGitHubStore()
    m = await r.put_design(DESIGN, label="master")
    skel = (await r.get_skeleton(m["design_id"]))["skeleton"]
    gs.apply_text_edits(skel, {"t1": "Guatemala"})
    writes_before = r.blob_writes
    m2 = await r.put_design(skel, label="Guatemala")   # skeleton already has asset:// markers
    assert m2["design_id"] != m["design_id"]
    assert r.blob_writes - writes_before == 3           # no asset re-upload
    got = await r.get_design(m2["design_id"])
    assert gs.text_layers(got["design"])[0]["text"] == "Guatemala"
    assert got["design"]["elements"][0]["src"] == _BIG_IMG
    # decode sanity: the re-inlined image is valid base64 of the same bytes
    assert base64.b64decode(got["design"]["elements"][0]["src"].split(",", 1)[1]) == b"\x00" * 60_000
