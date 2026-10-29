# Region capture implementation plan

**Goal:** Add a selectable region capture mode using the existing local capture/editor/export flow.

**Design:** The menu has visible, region and full-page choices. Region mode freezes the current viewport in a dedicated extension tab. The user drags, may redraw, then confirms or cancels with Escape. The confirmed bitmap is physically cropped before opening the existing editor; undo cannot reveal pixels outside the selection. No new permission, network call or page injection is required.

**Implementation:** Add a small selection page and pure pixel-coordinate normalization. Mark intermediate IndexedDB records as pending. Atomically replace a pending record with its cropped blob, or delete only a still-pending record on explicit cancellation. A stale selection tab must not delete a finished capture. Preserve normal captures, editor tools and exports.

**Verification:** First run failing model and Chrome feature tests. Cover reverse drags, edges, tiny gestures, scaled display, DPR 1/2, cancellation, pending reload, duplicate tabs, storage failure/retry, physical PNG pixels, annotation and real clipboard writes. Run existing browser and stability suites after implementation, get code/security review, package and verify the release artifact.

**Scope:** The newly used storage error path must reject an actual Error rather than null. Other previously reviewed editor defects and the unresolved Chrome-wide popup delay are separate work.
