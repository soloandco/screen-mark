# Capture and editor performance implementation plan

**Goal:** Improve visible capture, drag rendering and clipboard export, with a reproducible before/after Chrome comparison.

**Architecture:** Keep the current local MV3 architecture and permissions. Preserve Chrome's PNG for visible capture, coalesce pointer redraws with requestAnimationFrame, and share PNG export work with a single bounded cache. A document change invalidates the cache; pending clipboard writes are shared rather than duplicated.

**Tech stack:** Vanilla JavaScript, Canvas, IndexedDB, Node test runner, Playwright, Windows process memory API.

The user approved the three priorities on 2026-10-21. Frame coalescing is preferred over adding full-size canvas layers because extra layers retain another large image surface. Lazy PNG reuse is preferred over continuous background encoding because copying is the user's main export action and background work would compete with editing.

## 1. Preserve a baseline and write regression checks

- Baseline: public main d5aed23, copied without changing runtime permissions.
- Add render helper tests for frame coalescing, cancellation, pending export sharing, invalidation, size bounds and failure retry.
- Run the tests before production changes and confirm missing behavior fails.
- Add a real Chrome benchmark with identical fixtures, fresh profiles and alternating before/after runs.

## 2. Implement the three improvements

- `extension/background.js`: keep screenshot Blob; decode only for dimension validation or stitching. Do not re-encode a visible capture.
- `extension/render.js`: frame scheduler and one-result PNG cache capped at 16 MiB; release temporary export canvases after encoding completes.
- `extension/editor.js`: schedule pointermove redraws; cancel a queued draw when synchronously rendering the final state. Invalidate exports on commit, undo, redo and image replacement. Share a pending clipboard write, preserve its user activation, and recover after errors.

## 3. Verify behavior and measure

- `npm test` and `npm run test:browser`: original-resolution PNGs, rectangle/number labels, undo/redo, crop, persistence, both capture modes and actual clipboard writes.
- Extend browser checks for no visible-capture re-encoding, export reuse, edit invalidation, duplicate shortcut handling and frame batching.
- Benchmark installed Google Chrome in an isolated headless profile. Measure visible capture request and editor readiness, a deterministic high-frequency drag workload, first/repeated actual clipboard writes and sampled private working set of all isolated browser processes.
- Record raw runs, trial count, exact Chrome version, viewport and workload; report medians and limits. Do not describe browser-wide memory as extension-only memory or claim comparison with other extensions.

## 4. Review and publish

- Obtain agent code review and address important findings.
- Bump to 1.0.2, package and verify the ZIP. Update README with benchmark reproduction and update instructions.
- Commit only intended files, integrate into main, push and publish v1.0.2 with the ZIP and measurement report.
