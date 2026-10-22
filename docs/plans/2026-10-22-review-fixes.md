# Review fixes implementation plan

**Goal:** Fix the four reviewed v1.0.5 defects and publish a verified v1.0.6 release.

**Architecture:** Keep the vanilla MV3 architecture and local storage format. Use one image-loading guard for initial restoration and file replacement. Extract screenshot overlap slicing and arrow geometry as pure model functions; renew the page restoration watchdog on capture activity.

**Tech Stack:** JavaScript, Canvas, IndexedDB, Node test runner, isolated Chrome with Playwright.

The user approved the four fixes, related refactoring, real verification and GitHub publication on 2026-10-22. No new UI feature or permission is needed.

## 1. Regressions before implementation

- Add `tests/review-regressions.mjs` for delayed initial decode and real full-page PNG header pixels. Run against unchanged runtime and retain the failure evidence locally.
- Extend `tests/model.test.js` with arrow empty-space/underlying selection, shaft and thick head cases.
- Add `tests/page-capture.test.js` exercising the real injected function with a controlled clock: active session survives its original deadline, idle timeout restores styles/scroll and removes the session.
- Run the tests and confirm failures correspond to the reported bugs.

## 2. Scoped fixes and refactoring

- `extension/editor.js`: share one loading lifecycle; disable file opening during initial restoration and replacement, release controls on failure.
- `extension/model.js`, `extension/background.js`: calculate the not-yet-captured strip and preserve overlapping earlier pixels.
- `extension/page-capture.js`: reset the recovery timer at each scroll request, preserve explicit and idle restoration.
- `extension/model.js`, `extension/render.js`: share arrow head geometry between drawing, bounds and hit testing; select the actual shaft/triangle rather than its bounding rectangle.

## 3. Verification and review

- Run failing regressions again, then unit, general browser, automatic-number and stability suites sequentially.
- Check decoded PNG pixels, persisted record IDs and recovery after decode errors, actual arrow selection, and page restoration.
- Get independent code/security review and address concrete findings. Do not claim popup latency improvements or 24-hour soak testing.

## 4. Delivery

- Bump manifest/package/lockfile to 1.0.6, update installation and verification documentation.
- Package, inspect ZIP contents, review diff, commit, merge the reviewed local branch and push to the personal repository.
- Publish the versioned ZIP and verify the remote commit and release asset bytes.
