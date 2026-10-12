# Project memory

Durable lessons recorded by coding agents working in this project. The engine reads this file at the start of every session and shows it to the next agent — append anything the next session should know.


## 2026-10-12 16:54:07

## Don't Be Dumb — build notes & sandbox lessons

- 🔴 The ChatOSS app sandbox BLOCKS dynamic script loading (`document.createElement('script')` fires `load` but the code NEVER executes) and `fetch()` to the app's own files ("Load failed"). Static `<script src>` tags in index.html are the ONLY reliable way to load a vendored library. That is why `libs/typescript.js` (8.5 MB) + `libs/tslibs.js` (~3 MB: all stdlib .d.ts as `window.__DBD_TS_LIBS__`) are static end-of-body tags — "on demand" refers to when they're USED, not loaded.
- 🔴 Heavy static scripts must go at the END of `<body>`, never in `<head>`: with the ~11 MB of TS bundles in head, the preview rendered a BLANK frame (parser/execution blocked before any content). End-of-body is verified healthy in the real preview.
- Verified working in the real sandbox preview: blob-URL Web Workers (primary code runner — `terminate()` gives real hard timeouts), sandboxed `srcdoc` iframes with `allow-scripts` (DOM/CSS assertion checker + fallback code runner), and the vendored TS compiler type-checking correctly (catches TS2322, clean code → 0 diagnostics).
- Remove srcdoc iframes ~150 ms AFTER receiving results — immediate `.remove()` produced an opaque "Script error." uncaught error in the parent frame.
- Vendored TS = typescript@5.6.3 from the npm registry tarball; regenerate `libs/tslibs.js` with `python3 tools/build-tslibs.py` (reads `libs/lib/*.d.ts`).
- App payload ≈ 14.2 MB (libs ≈ 14 MB) — under the 20 MB .aip limit; keep `tmp/` small because the publisher zips the folder.
- SQLite db name: `dont_be_dumb`. Generation prompts get the last 30 task titles+tags ("do not repeat") plus a client-side fingerprint dedupe.
- No `confirm()`/`alert()` in the sandbox — every destructive flow uses the platform `.overlay`/`.modal`.
- A temporary boot self-test (writes PASS/FAIL into `#footer-note` + `document.title`, read back via preview_check) is a reliable way to verify runtime capabilities — the preview snapshot timing is racy, so retry preview_check until a late snapshot appears.

## 2026-10-12 18:22:26

## v1.1.0 — console Run (single-call execution with logs)

- Code/bug drills now have a Run bar under the editor: test-case picker prefills the args input, any JSON args can be typed, and `DBD.runner.runOnce({code, fnName, args})` returns `{value, logs, error, fatal, timedOut, ms}` — the return value is now ALWAYS captured via the runner's `captureValues` flag (threaded through worker/iframe/function engines). "Run all tests" is unchanged and remains the only thing that counts as an attempt. Release: v1.1.0 on GitHub with app-v1.1.0.aip/.zip; store listing updates from the latest release.
- 🔴 Lesson for temporary boot self-tests: (1) they must POLL until `wireEvents()` has run (`typeof $('btn-…').onclick === 'function'`) before simulating clicks — the click race against boot wiring caused a false stall; (2) NEVER write textContent onto container elements like `#streak-card` — it destroys child ids (`#streak-count`) and later `renderStats()` throws; (3) report progress into an element EARLY in the visible text (the streak card region) so preview_check snapshots can't miss it. Verified end-to-end signature: `once=PASS view=ok wired=ok ui=PASS`.
- The Create preview DB is the SAME namespaced SQLite as the installed app — the preview shows real user data (drills generated in the dock app).

## 2026-10-12 18:23:03

- 🔴 `publish_app` zips the ENTIRE app folder (including `tmp/scratch/`) and enforces the 20 MB unpacked limit — release artifacts kept there (`*.aip` + `*.zip` ≈ 2.4 MB each) pushed the v1.1.0 dock publish to 24.2 MB and failed. Delete release artifacts from `tmp/scratch/` right after `gh release upload`; keep the runtime payload ≈ 14.2 MB (libs/ dominates). The GitHub release zips only runtime files (app.json, index.html, style.css, icon.svg, js/, libs/) — that one was fine at 15.0 MB unpacked.
