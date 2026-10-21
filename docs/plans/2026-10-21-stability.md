# Continuous and multi-tab stability plan

**Goal:** Exercise repeated capture/edit/copy and multiple tabs in real Chrome, reproduce any data loss or recovery failures, and publish verified fixes.

**Scope approved by user:** Continuous use, multi-tab stability checks, necessary bug fixes and GitHub updates. Preserve the local-only architecture and permissions. Prefer targeted regression tests and small fixes over a broad refactor.

## Test first

Use an isolated temporary profile with the installed Google Chrome and the unmodified extension. Save each scenario's outcome in a machine-readable report.

1. Repeated captures from two differently colored source tabs, alternating visible/full modes. Verify unique IDs, source pixels, dimensions, scroll/style restoration and no record mixing.
2. Repeated edit/copy/reload in three independent editor tabs, including a long image and rapid queued edits. Verify persisted shapes, numbering and independent PNG output.
3. Duplicate an editor tab for the same capture. Make one tab save first, then edit the stale tab. Verify the newer saved work is not silently overwritten and the stale tab receives a clear recovery message.
4. Simulate an old capture that is still being edited, run capture cleanup and check that recent edits survive. This is a timestamp-boundary simulation, not a real 24-hour soak.
5. Pause full capture after scrolling, switch source tabs, then verify a clean cancellation, page restoration and a successful retry. Reject overlapping requests without leaving the capture lock stuck.
6. Terminate the idle extension worker through CDP, then verify a new capture and persisted edits recover after worker restart.

## Fix and verify

Record actual failures before changing runtime code. Apply the smallest fixes, add focused coverage for any concurrency/persistence state, then rerun failed cases and the existing test suite. Obtain code and security review before committing runtime/storage changes.

Publish raw scenario evidence and a bounded description of what was tested. If runtime changes are necessary, release v1.0.3 with a byte-verified ZIP. Keep v1.0.2 performance results identified as historical measurements rather than claiming a new benchmark.
