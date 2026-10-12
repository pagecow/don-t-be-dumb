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
