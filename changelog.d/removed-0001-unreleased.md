- `modal_app.py`, `deploy-modal.yml`, `test_modal_app.py`, the registered job runner,
  `fetch_artwork`, and the nested timeout rings. Modal is the execution home for an
  operator's OWN long-running work; Roastify's render happens on Roastify's servers and
  both of our calls return immediately. The long-running task was manufactured by
  polling to completion inside a runner, and the detached executor existed to host the
  thing that manufactured it. With nothing of ours in flight after the POST returns,
  there is no operator-fault window for a job store to protect.
- `config.py` — every setting in it existed for those rings. The file was inherited from
  the template, which ships it unused.
- `session.py` — collapsed to one `SessionCache[str]` in `server.py`; a module for a
  three-line cache was ceremony.
- Dependencies `pydantic-settings` and `python-dotenv`, which only `config.py` used, and
  the `modal` extra from the SDK pin.
