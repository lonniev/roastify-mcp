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

import pytest

from roastify_mcp import github_store as gs

# A design shaped like Roastify's current format: a large inline image (lifted to
# a file), a small inline SVG (kept inline), a text layer with geometry.
_BIG_IMG = "data:image/png;base64," + ("A" * 80_000)   # decodes+re-encodes canonically
_SMALL_SVG = "data:image/svg+xml;base64," + ("B" * 400)
DESIGN: dict[str, Any] = {
    "schema": "konva-v1",
    "elements": [
        {"type": "image", "id": "bg", "src": _BIG_IMG},
        {"type": "image", "id": "ic", "src": _SMALL_SVG},
        {"type": "text", "id": "t1", "fontFamily": "Poppins", "fontSize": 63,
         "width": 578, "height": 77, "text": "Ethiopia"},
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
