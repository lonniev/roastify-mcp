"""Settings for the roastify-mcp service.

With nsec-only bootstrap, Settings contains only the operator's Nostr
identity and tuning parameters with sensible defaults. All secrets — the
operator's BTCPay keys and every patron's Roastify API key — arrive via
Secure Courier and live in the SDK vault, never in the environment.
"""

from __future__ import annotations

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
    # Generation is asynchronous upstream with no published SLA. The
    # ceiling is generous because a detached runner waiting costs nothing;
    # the expectation is what the advised poll cadence is built from.
    artwork_max_runtime_seconds: int = 900
    artwork_expected_seconds: int = 45
    artwork_result_ttl_seconds: int = 86400  # 24h to redeem a claim check

    # ── Constraint Engine (opt-in) ───────────────────────────────────
    constraints_enabled: bool = False
    constraints_config: str | None = None  # JSON string

    # ── Nostr relays (optional override) ─────────────────────────────
    tollbooth_nostr_relays: str | None = None

    model_config = {"env_prefix": "", "env_file": ".env"}


# Lazy singleton — avoids loading env vars at import time.
_settings: Settings | None = None


def get_settings() -> Settings:
    """Return the cached Settings singleton."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
