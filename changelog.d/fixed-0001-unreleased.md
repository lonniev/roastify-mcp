- **`list_design_versions` now includes description-only commits and their tags.** The
  history query was path-scoped to `designs/<id>/design.json`, so a
  `set_product_description` write (which updates `meta.json` while leaving `design.json`
  byte-identical) never appeared — even though the version tag existed and collided on
  reuse. The filter now walks the whole design folder, so description edits are
  discoverable for rollback and next-semver calculation.

- **Fetch now actually applies the description (correct product field names).** The
  earlier fix guessed `title`/`retailPrice`; the real `getProductById` result names the
  product `productName` and has **no** top-level price — the store price is
  `max(variants[].retailPrice)` in cents. `applyDescription` now reads those, so the
  read-modify-write to `updateStoreMetadata` succeeds instead of logging "couldn't read
  the product's store fields." The skip message now also names which field was missing.

- **Fetch now applies the stored description (the field-name bug).** The read-modify-write
  guarded on `name`/`retailPrice`, but Roastify's product carries its name as **`title`**
  and its price as integer **`retailPrice`** (cents) — so the guard tripped and logged
  "couldn't read the product's store fields," skipping the description. It now reads
  `title` (falling back to `name`) and echoes `retailPrice` verbatim, so the description
  applies while price and coffee attributes are preserved.

- **`update_design_text` accepts multi-key `edits` delivered as a JSON string**
  (field report roastify-mcp#38). FastMCP/Pydantic validate tool args with
  `validate_python`, so a stringified object failed schema validation
  (`Input should be a valid dictionary`) while a native dict succeeded —
  batching two layer edits into one call (one commit) was rejected even though
  the same keys worked as two single-key calls. `edits` is now
  `Annotated[dict[str, str], BeforeValidator(coerce_str_dict)]`: the published
  schema stays an object, and a JSON object string is parsed before the body
  runs. This closes roastify-mcp#38.

- **Font repair now runs on every edit, not only on stash.** `stash_design` healed
  Roastify's lossy migrated `fonts[]` (`repair=True`), but `update_design_text`,
  `add_design_element`, and `move_elements` did not — so a design that entered the
  library flawed (stashed before repair existed, or otherwise) kept rendering fallback
  fonts in Edit Design through every subsequent CA revision. All three edit tools now
  pass `repair=True`, so any save heals the font load list. Repair is idempotent for an
  already-healed design and degrades to a plain-family URL if Google Fonts is
  unreachable, so it never fails a save.
- **`update_design_text` re-measures a text layer's `height` after an edit.** It set
  the new copy but left `height` (and the response) unchanged, so an agent verifying
  its own edit read stale bounds and concluded the change hadn't taken, and any later
  placement reasoning ran on numbers describing a design that no longer existed. Height
  now re-measures, anchored on the renderer's exact prior value and scaled by the
  reflowed line count — an edit that doesn't cross a wrap boundary reports no drift.
  `width` is documented for what it is: the fixed wrap frame, not a measured bound.
- Both `update_design_text` and `move_elements` now **echo the touched elements'
  post-edit geometry** in their response, so a caller verifies against ground truth.
- **Courier strips Roastify's `(copy)` / `(copy revised)` suffix from a stashed
  design's label.** Roastify stamps that lineage artifact when a design is duplicated
  in the Designer; the courier was carrying it verbatim into the stash label (and any
  slug derived from it). `cleanTitle` now peels the trailing `(copy…)` at capture, so
  the label states the design — not how it was made — whether the design is draft or
  published.

- **Applied designs lost their background image.** GitHub's Contents API returns EMPTY content for
  files over ~1 MB, and a design's background artwork is ~1.7 MB — so `fetch_design` re-inlined it
  as an empty `data:image/png;base64,` and the applied design came back with no background.
  `_get_file` now falls back to the Git Blobs API (base64 up to 100 MB) by sha whenever the Contents
  API returns no content, recovering the full image. Affected every real design (they all carry a
  full-bleed background over 1 MB).
