"""Detached execution for roastify-mcp's artwork jobs.

The wheel's ``ModalExecutor`` spawns ``run_job(claim)`` here instead of starting an
asyncio task on Horizon. What runs is the operator's OWN registered runner —
``_run_artwork_job``, unchanged — so this file adds a *place to run*, not a second
implementation.

Roastify generates artwork asynchronously and publishes no SLA, so the work is a poll
loop of unknown length. On Horizon that loop lives inside a serverless container that
may recycle; here it does not. The claim check the patron holds resolves either way,
because the job row in Neon is the source of truth.

**One secret, and it is the one an operator human actually knows.**

The container boots from exactly ``TOLLBOOTH_NOSTR_OPERATOR_NSEC``. From the nsec the
runtime derives the npub, finds the Authority's bootstrap DM on a Nostr relay, and
recovers BOTH the Neon URL and the vault encryption key. So nothing else is copied into
Modal: no database URL (the operator human does not reliably know it — the Authority
issues it), no vault key, and no Roastify API keys. Those are patron secrets, they live
in the vault this boot discovers, and each is resolved per job from the caller's npub.

The nsec is irreducible: it *is* the identity, and it cannot be fetched over Nostr
because decrypting a DM addressed to your npub requires the nsec you would be fetching.

Net effect: this container holds exactly what Horizon holds — no more.

Deploy::

    modal deploy modal_app.py

Then courier ``modal_token_id`` / ``modal_token_secret`` / ``modal_app_name`` into the
operator vault; the runtime installs ModalExecutor on its next job.
"""

import modal

# Safe at module scope in both places this file is imported: at deploy time from the
# project venv, and at container import via `add_local_python_source`. `config` pulls in
# only pydantic-settings and reads the environment — no runtime, no server, no I/O.
from roastify_mcp.config import get_settings

# Must match the vaulted ``modal_app_name``; the wheel resolves the function by
# (app_name, "run_job"). See tests/test_modal_app.py — renaming is a two-part change.
app = modal.App("roastify-artwork")

image = (
    modal.Image.debian_slim(python_version="3.12")
    # Dependencies from the single source of truth — the same pins the MCP runs,
    # including tollbooth-dpyc itself. A second dependency list here would drift from
    # pyproject.toml and be discovered as a version-skew bug months later.
    .pip_install_from_pyproject("pyproject.toml")
    # The operator's own package. `copy=False` mounts it at run time so a code change
    # does not force an image rebuild — it does NOT skip the redeploy.
    .add_local_python_source("roastify_mcp")
)

# Named, not inline: created once by the operator in Modal, holding the single field
# TOLLBOOTH_NOSTR_OPERATOR_NSEC.
operator_identity = modal.Secret.from_name("roastify-operator")


@app.function(
    image=image,
    secrets=[operator_identity],
    # The OUTERMOST budget ring, derived from the operator's configured poll budget
    # (see the ring properties in roastify_mcp.config). It must sit outside the job
    # store's attempt ceiling: a runner that gives up while the store still believes it
    # owns the job strands that artwork until the lease lapses, which reads as a hang
    # rather than as a timeout. Nothing here is bound to an HTTP response, so this is
    # the only ceiling in the path.
    timeout=get_settings().artwork_runner_timeout_s,
    # Artwork generation is I/O-bound: one POST, then polling while Roastify renders.
    # Requesting more CPU would buy nothing.
    cpu=1.0,
    memory=1024,
)
def run_job(claim: str) -> None:
    """Run one claimed artwork job to completion, detached from the caller.

    Returns ``None`` deliberately. ``_run_job`` persists its own outcome to the
    operator's Neon — success, curated situation, or refund — so the job row is the
    source of truth and this function's return value is not part of the contract. The
    wheel polls the Modal handle only to catch a run that died without writing a row at
    all (cancelled, crashed, or out of time).
    """
    import asyncio

    # Imported INSIDE the function: importing the server module registers the job
    # runners as a side effect, and doing that at container import would run it during
    # the image build too, where no secret is mounted.
    from roastify_mcp import server

    asyncio.run(server.runtime._run_job(claim))
