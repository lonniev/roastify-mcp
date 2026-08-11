"""Shared test fixtures for tollbooth-sample."""

from __future__ import annotations

import pytest
from tollbooth.ledger import UserLedger


@pytest.fixture
def funded_ledger() -> UserLedger:
    """A ledger pre-funded with 100 api_sats."""
    ledger = UserLedger()
    ledger.credit_deposit(100, "test-invoice-001", ttl_seconds=86400)
    return ledger


@pytest.fixture
def empty_ledger() -> UserLedger:
    """An empty ledger with zero balance."""
    return UserLedger()
