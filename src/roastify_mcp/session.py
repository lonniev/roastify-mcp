"""Per-patron Roastify credential assembly.

Not a vault. The real credential vault is the SDK's
(``tollbooth.vaults.neon.NeonVault``, AES-256-GCM, keyed by the operator's
nsec) and it owns persistence. This module only holds a decrypted key in
memory for the length of a TTL so a burst of calls from one patron does not
re-read Neon on every tool invocation.

Kept deliberately small: the domain functions in ``roastify.py`` take an
``api_key`` argument, so there is no client object to build.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from tollbooth.session_cache import SessionCache

SESSION_TTL_SECONDS = 900  # 15 minutes


@dataclass
class PatronSession:
    """One patron's Roastify credential, held in memory only."""

    api_key: str
    created_at: float = field(default_factory=time.time)

    def __repr__(self) -> str:
        # The key must never reach a log line, a traceback, or a tool response.
        age = int(time.time() - self.created_at)
        return f"PatronSession(age={age}s, api_key=<redacted>)"

    @property
    def is_test_key(self) -> bool:
        """Roastify sandbox keys are prefixed ``rty_test_`` and do not fulfill."""
        return self.api_key.startswith("rty_test_")


_sessions: SessionCache[PatronSession] = SessionCache(ttl_seconds=SESSION_TTL_SECONDS)


def get_session(npub: str) -> PatronSession | None:
    """Return the cached session for ``npub``, or None if absent/expired."""
    return _sessions.get(npub)


def set_session(npub: str, api_key: str) -> PatronSession:
    """Cache a patron's key for the TTL window."""
    return _sessions.set(npub, PatronSession(api_key=api_key))


def clear_session(npub: str) -> None:
    """Drop a patron's cached key — called when credentials are forgotten."""
    _sessions.clear(npub)
