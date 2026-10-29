# Fewer Clicks Implementation Plan

**Goal:** Reduce repeated pointer clicks in capture, annotation adjustment and opening clipboard images.

**Architecture:** Keep the local capture/editor storage flow. Region selection opens the editor on a valid pointer release by default, with a remembered checkbox for manual confirmation. Ctrl/Command temporarily selects existing marks while dragging, without changing the active drawing tool. A user paste event opens an image through the existing file import validation and loading lock.

**Tech Stack:** Chrome MV3, vanilla JavaScript, IndexedDB, localStorage preferences, Playwright and installed isolated Chrome.

## Review and choices

- Region capture currently requires toolbar click, region menu click, drag and a separate confirm click. Default auto-confirm removes one click. Keep manual mode for users who need to redraw before confirming.
- Moving a label during rectangle drawing currently needs selecting the move tool and restoring the rectangle tool. A modifier drag removes those two tool clicks and keeps Undo available.
- Opening an image already on the clipboard currently requires saving a file and choosing it. Ctrl/Command+V in the editor uses a trusted paste event and does not request clipboard read permission.
- Rejected for this change: replacing the toolbar popup with immediate capture would hide the three capture choices; automatically copying every edit would overwrite the clipboard before the user finishes.

## Implementation and validation

1. Extend `tests/region.mjs` with a failing drag-to-editor case. Preserve explicit manual-mode, duplicate-tab and persistence-error checks. Cover tiny gestures and preference restoration.
2. Add `tests/interaction.mjs` and observe failures for actual clipboard image paste and modifier dragging. Check original PNG pixels, shape count and position, active tool, Undo, ordinary rectangle drawing, paste in text inputs, loading exclusion and invalid input.
3. Implement only those paths in `extension/selection.*` and `extension/editor.*`. Selection errors must leave a retry path. Import preserves existing pending-save/conflict confirmation and validation.
4. Run unit, region at normal/high DPI, editor interaction and existing relevant browser suites sequentially. Inspect screenshots, obtain code/security agent review and apply findings.
5. Document before/after action counts with drag counted separately. Update actual UI images, package a versioned ZIP, compare every file and publish the verified GitHub release.
