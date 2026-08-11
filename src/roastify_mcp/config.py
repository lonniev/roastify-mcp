"""Settings for the roastify-mcp service.

With nsec-only bootstrap, Settings contains only the operator's Nostr
identity and tuning parameters with sensible defaults. All secrets — the
operator's BTCPay keys and every patron's Roastify API key — arrive via
Secure Courier and live in the SDK vault, never in the environment.
"""

from __future__ import annotations

import math

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Environment-driven configuration.

    Only one env var is required to boot: TOLLBOOTH_NOSTR_OPERATOR_NSEC.
    """

    # ── Nostr identity (one env var to boot) ─────────────────────────
    tollbooth_nostr_operator_nsec: str | None = None

    # ── Credit economics (tuning with defaults) ──────────────────────
    seed_balance_sats: int = 25
    credit_ttl_seconds: int = 604800  # 7 days

    # ── Artwork job durations ────────────────────────────────────────
    # Generation is asynchronous upstream with no published SLA, so these are
    # nested rings rather than one number, each strictly outside the last.
    # A ring that merely *equals* the one inside it is the bug this shape
    # prevents: the runner and the job row would expire in the same instant,
    # and a job still being written could be reaped as stale.
    #
    # innermost — how long we will poll Roastify for one generation
    artwork_poll_budget_s: int = 900
    # how much room each ring gets over the one it contains
    artwork_ring_safety: float = 1.25
    # a real prediction, not a ceiling — it shapes the advised poll cadence
    artwork_expected_seconds: int = 45
    artwork_result_ttl_seconds: int = 86400  # 24h to redeem a claim check

    # ── Constraint Engine (opt-in) ───────────────────────────────────
    constraints_enabled: bool = False
    constraints_config: str | None = None  # JSON string

    # ── Nostr relays (optional override) ─────────────────────────────
    tollbooth_nostr_relays: str | None = None

    model_config = {"env_prefix": "", "env_file": ".env"}

    @property
    def artwork_job_attempt_s(self) -> int:
        """Ceiling on ONE artwork attempt: the poll budget, plus room to persist it.

        Handed to ``start_async_job`` as ``max_runtime_seconds``, which is also the
        staleness threshold the watchdog recovers from.
        """
        return math.ceil(self.artwork_poll_budget_s * self.artwork_ring_safety)

    @property
    def artwork_runner_timeout_s(self) -> int:
        """The detached runner's own ceiling — outermost, so the runner is never what
        kills work the job store still believes is in flight.

        Baked into the Modal function at deploy time. A runner that gives up while the
        store still holds the claim strands that artwork until the lease lapses, which
        reads as a hang rather than as a timeout.
        """
        return math.ceil(self.artwork_job_attempt_s * self.artwork_ring_safety)


# Lazy singleton — avoids loading env vars at import time.
_settings: Settings | None = None


def get_settings() -> Settings:
    """Return the cached Settings singleton."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
