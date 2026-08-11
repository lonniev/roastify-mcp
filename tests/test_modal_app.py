"""The detached artwork app's identity is coupled to something outside this repo.

The wheel resolves the detached function by ``(modal_app_name, "run_job")``, and
``modal_app_name`` is an operator secret delivered by Secure Courier into the vault —
where this test cannot see it. So renaming the app here is not a local edit: the runtime
would keep dispatching to the old name, find nothing, and ``service_status`` would keep
reporting a healthy executor while no artwork ever generated.

CI deploys with a Modal token rather than the operator nsec (a build runner has no
business holding the credential that opens the vault), which means the deploy cannot
compare the two names for us. This test is what remains: it makes the rename loud and
deliberate instead of silent, by failing until someone acknowledges the second half of
the change.
"""

from __future__ import annotations

from roastify_mcp.config import Settings

# The name the operator vault must also carry. Changing it is a TWO-part change:
# re-courier `modal_app_name` into the operator vault, then update this pin. Doing only
# one leaves the runtime dispatching into the void.
VAULTED_APP_NAME = "roastify-artwork"


def test_the_app_name_matches_what_the_runtime_dispatches_to():
    import modal_app

    assert modal_app.app.name == VAULTED_APP_NAME, (
        f"modal_app.py declares {modal_app.app.name!r} but the runtime resolves "
        f"{VAULTED_APP_NAME!r} from the vault. Re-courier `modal_app_name` before "
        "changing this pin, or artwork jobs will dispatch to a function that does "
        "not exist."
    )


def test_the_runner_is_the_operator_s_own_registered_runner():
    """`run_job` must stay a thin shim over the runtime's own dispatch.

    The point of the Modal app is to be *a place to run*, not a second implementation —
    that is what let the sealed-closure apparatus be deleted in tollbooth-dpyc 0.82.0. A
    fork in behaviour here would be invisible locally, because nothing in this repo runs
    the Modal path.
    """
    import inspect

    import modal_app

    body = inspect.getsource(modal_app.run_job.get_raw_f())
    assert "_run_job" in body, "run_job must delegate to the runtime's own dispatch"
    assert "from roastify_mcp import server" in body, (
        "the server import must stay INSIDE the function; at container import it would "
        "also run during the image build, where no secret is mounted"
    )


def test_the_rings_strictly_nest():
    """Each ceiling must sit strictly outside the one it contains.

    Equal rings are the failure this shape exists to prevent: the detached runner and
    the job row would expire in the same instant, so a job still writing its result
    could be reaped as stale — a refund for work that actually succeeded.
    """
    s = Settings()
    assert s.artwork_poll_budget_s < s.artwork_job_attempt_s < s.artwork_runner_timeout_s, (
        f"rings must nest strictly: poll={s.artwork_poll_budget_s} "
        f"attempt={s.artwork_job_attempt_s} runner={s.artwork_runner_timeout_s}"
    )


def test_the_expectation_sits_inside_the_budget():
    """`expected_seconds` is a prediction that shapes poll cadence, not a ceiling.

    An expectation larger than the budget would advise a client to sleep past the point
    where the job can still be running.
    """
    s = Settings()
    assert s.artwork_expected_seconds < s.artwork_poll_budget_s


def test_the_modal_timeout_is_the_outermost_ring():
    """What modal_app.py bakes in must be the OUTERMOST ring, not an inner one.

    Modal does not expose the resolved timeout on the function spec, and the value is
    evaluated on the deploy runner rather than here — so this asserts on the source: the
    function must take its ceiling from ``artwork_runner_timeout_s``. Wiring it to the
    attempt or poll budget instead would bake in a runner that kills work the job store
    still believes is in flight.
    """
    import inspect

    import modal_app

    src = inspect.getsource(modal_app)
    assert "timeout=get_settings().artwork_runner_timeout_s" in src, (
        "the Modal function must bake in the outermost ring"
    )
    for inner in ("artwork_poll_budget_s", "artwork_job_attempt_s"):
        assert f"timeout=get_settings().{inner}" not in src
