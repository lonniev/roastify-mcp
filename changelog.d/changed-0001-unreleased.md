- **Every design commit an AI agent makes now requires a real commit message and the
  next semver version.** `update_design_text`, `add_design_element`, `move_elements`, and
  `set_product_description` — the agent-facing edit tools, which used to auto-commit with a
  generic message and no tag — now take required `commit_message` + `version_tag`. Tool
  metadata prompts a *specific* message (what changed and why, not the human dev's lazy
  "save this") and the *next* semver (check `list_design_versions` and increment), and a
  shared `_check_commit` guard rejects placeholder messages (`save`/`update`/`wip`/…),
  too-short messages, and non-semver/`v`-prefixed versions. `stash_design` uses the same
  guard. So each commit lands with a meaningful message and a proper version in the picker.

- **The courier panel is wider and resizable.** Default width is 560px (was 420),
  expand goes to 920px, and a bottom-right grip drags the panel to any size — the chosen
  width/height persists across reloads (`localStorage`). Expand resets to a preset.

- **Commit/Fetch/Delete now use one in-panel form instead of native alert/prompt
  stacks.** Each shows its consequence labels, any fields, and Confirm/Cancel in a
  single modal over the panel — Commit collects the message + version in one place,
  Fetch and Delete confirm without leaving the panel. No more chained `confirm()`/
  `prompt()` dialogs.
- **The version must be semver `MAJOR.MINOR.PATCH` (e.g. `1.2.3`), no leading `v`.**
  Enforced in the Commit form (Confirm blocks until valid, with an inline hint) and in
  `stash_design` (rejected server-side), so a malformed version never reaches a git tag.

- **Courier panel: compact, git-native controls that give the designs room.** The
  full-width Send / Apply / Delete buttons crowded out each design's identity, so:
  the "Product" selector is relabelled **"Roastify Design"** and gets an explicit
  dropdown chevron; **Send → an octocat "Commit"** button (compact, top-left); each
  row's **Apply → an octocat "Fetch"** and **Delete → a bare trashcan**, both small
  and right-aligned. Freed space now goes to the row's repo path and commit-SHA link.
  The octocat mark is defined once and reused on Commit and Fetch (both GitHub ops).

- **The design store is now configuration management.** Editing a design
  (`update_design_text`, `add_design_element`, `move_elements`) commits a new version
  of the **same** `design_id` — git tracks the diff — instead of saving a new file;
  the suffix labels (" (edited)", " +text", " (aligned)") are gone. A design's folder
  id is the deterministic slug of its label (no random `-<hash>`), so re-stashing the
  same design overwrites its folder rather than spawning a duplicate. Two genuinely
  different designs just need different labels.

- **Design library now lives in a GitHub repo the patron owns, not the operator's Neon.** The MCP
  is the broker: it holds a vaulted fine-grained GitHub token (new optional patron credential
  fields `github_token` / `github_repo` / `github_branch`) and commits/reads on the patron's
  behalf. The tool surface (`stash`/`fetch`/`list`/`delete`/`get_design_text`/`update_design_text`)
  and the browser courier are unchanged. Why: git is content-addressed, so a design's heavy
  artwork is de-duplicated across variants for free (no hand-rolled asset table); every save is a
  commit, so there is real version history and rollback; the patron owns the store and can browse,
  rename, and delete designs in GitHub's own UI (the management surface the courier alone used to
  be); and a design is a readable folder — `designs/<id>/{design.json, content.json, meta.json}`
  plus shared `assets/<sha>.<ext>` — rather than a 2.3 MB row. Writes are single atomic commits via
  the Git Data API; large inline images are lifted to asset files while small SVGs stay inline so
  `design.json` diffs cleanly. Retires `design_store` (Neon) and its schema.

- **Acted on first-live-run field notes (design shuttle).** The instruction text now reframes the
  read-only-API boundary as tool-scoped, not the endeavour: the *merchant is the orchestrator* —
  they create products, change plan tier, and author templates, so an agent should design for what
  the merchant wants to build, not narrow the work to the current catalog. Added two editing
  disciplines to the intent and the tool docs: keep replacement text within ~±10% of the layer's
  character count (the box doesn't resize), and a stash label states intent, not content (read the
  layers, don't trust the name). Noted that `tool_not_priced` is a registration gap, not a patron
  debt. `get_design_text` now returns per-layer `chars`, `fontSize`, `width`, and `height` so an
  editor can gauge fit. `get_my_product`'s description notes the coffee identity is SKU-encoded
  (decode before writing origin copy). Feedback from Scout's first agent-side run.

- Artwork is a thin passthrough of Roastify's own async API: `generate_artwork` returns
  the upstream job id and `artwork_status` checks it. `artwork_status` is category
  `free` — the wheel gates it without consulting Neon, because polling is how a caller
  learns the work finished and metering each look charges for waiting.
