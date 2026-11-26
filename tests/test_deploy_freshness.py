"""Horizon deploy freshness — the metadata that forces a rebuild.

Deploy-verify compares the live ``service_status`` version / git sha against
``main``. When Horizon keeps serving a cached wheel, the live probe reports the
old package version (here ``0.23.4``) with a lagging build sha. The fleet's fix
is a package version bump plus a ``.deploy-trigger`` touch so the next push is
not byte-identical to the cached artifact.

These assertions are the headless stand-in for that probe: if either lever is
missing, CI fails the same way a stale Horizon would.
"""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# The version deploy-verify observed on the live service when it opened the
# stale-wheel issue. A redeploy that does not move past this is not a redeploy.
_STALE_LIVE_VERSION = "0.23.4"


def test_package_version_moved_past_the_stale_live_build() -> None:
    with (ROOT / "pyproject.toml").open("rb") as fh:
        version = tomllib.load(fh)["project"]["version"]
    assert version != _STALE_LIVE_VERSION, (
        f"pyproject version is still {_STALE_LIVE_VERSION!r}; Horizon was "
        "observed serving that build. Bump [project].version so the next "
        "deploy is not byte-identical to the cached wheel."
    )


def test_server_json_version_tracks_pyproject() -> None:
    with (ROOT / "pyproject.toml").open("rb") as fh:
        py_version = tomllib.load(fh)["project"]["version"]
    server = json.loads((ROOT / "server.json").read_text())
    assert server["version"] == py_version, (
        "server.json version must match pyproject [project].version so the "
        "registry entry and the live service report the same build."
    )


def test_deploy_trigger_file_exists_to_bust_horizon_cache() -> None:
    trigger = ROOT / ".deploy-trigger"
    assert trigger.is_file(), (
        "Missing .deploy-trigger. Horizon sometimes keeps serving a cached "
        "wheel across commits; a committed touch file is the fleet-wide lever "
        "that forces a rebuild (capability: Horizon Deploy Freshness)."
    )
    assert trigger.read_text().strip(), ".deploy-trigger must not be empty"
