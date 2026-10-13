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

## 2026-10-12 21:28:09

## v1.2.0 — Replit-style layout + editor shortcut

- Layout rework: shell is now a 4-track grid — skills/history | AI panel | code column | console column — with `--dbd-sidebar-w / --dbd-ai-w / --dbd-console-w` vars on `.dbd-shell`; collapse states are classes on `<html>` (`dbd-sidebar-collapsed`, `dbd-ai-collapsed`); the console column exists only in the task view (`html[data-view]`, set by `showView`), and `applyConsoleWidth()` zeroes the track on the dashboard. The code editor + console col fill their column height (`.dbd-work-main` flex column, `#editor-host` flex, `.dbd-editor` flex:1). Corner `.dbd-grip` elements (code + console, bottom-right) drag the console width (window-level pointermove; divider follows the pointer; persists to settings.layout.consoleWidth). Collapse/grip/prompt-fold states persist in `scopedData` settings.layout.
- `S.booted = true` at the end of boot() gives temporary selftests a reliable "boot finished" signal (avoids races with boot's own showView).
- Editor: Cmd/Ctrl+/ toggles line comments (per-line `//` for JS/TS with all-commented/uncomment logic; `/* */` / `<!-- -->` wrap-unwrap for CSS/HTML), reusing lineInfo/setRange.
- Verified end-to-end in the sandbox: `booted=ok layout=ok fullH=ok(260) collapse=ok grip=ok(380→520) cmt=ok`. Temporary selftest blocks can be removed with `sed -i '' '/__DBD_SELFTEST_START__/,/__DBD_SELFTEST_END__/d'` — no giant old_string matching needed.
- ⚠ preview_check can occasionally report a false "BLANK frame" while the 8.5 MB `libs/typescript.js` parses in the ~1 s after boot — a re-run shows the healthy state. Don't chase it.

## 2026-10-12 21:59:29

## v1.3.0 — two-screen layout, pausable timer, collapse removal

- The column-collapse feature from v1.2 broke the real installed window (screenshot evidence) and leaked polluted layout settings into the user's scopedData. Removed collapse entirely; the app is now TWO screens via plain [hidden] toggles: home = sidebar(main request/rot) + AI panel; task = task rail | full-height editor | full-height console (run buttons in the console head). `showView()` swaps them; `applyConsoleWidth()` writes an inline width on #console-col with clamps (280…window−620). Grip drags = window-level pointermove, divider follows pointer, saved under settings.layout.consoleWidth.
- Layout settings are sanitized at load (`sanitizeLayout()`): only `consoleWidth` survives, clamped and numeric. Settings → "Reset layout" (wipeLayout) clears it.
- 🔴 Lesson: the Create preview seems to share scopedData/SQLite with the installed app — temporary boot selftests must snapshot ALL of `S.settings` and restore it in a finally block, and fake tasks/attempts must use id -1 and never be inserted into the DB.
- 🔴 Lesson: a failed edit_file partial-move left a duplicate `const` in the same scope → SyntaxError → the whole app.js stopped parsing, and because the app frame has an opaque origin the syntax error surfaces only as a masked uncaught "Script error." Diagnosis pattern: syntax error in app.js ⇒ title never changes, boot never runs, "Script error." once — then `node --check` finds it instantly. Also: `sed -i '' '/__DBD_SELFTEST_START__/,/__DBD_SELFTEST_END__/d'` is the reliable way to delete selftest blocks (no giant edit_file matching).
- Timer: hours format in fmtElapsed (h:mm:ss or m:ss), pause/resume via S.paused + baseSeconds/resumedAt, paused seconds persisted to attempts via updateAttempt on pause and on save.
- Reviews stream into #review-out in the console column while in a task (AI panel is hidden there).
- preview_check flakes to expect: an occasional false BLANK frame during the ~1s typescript.js parse; re-run.
- Verified end-to-end signature: `booted=ok view=ok fullH=ok(754/800) btns=ok timerH=ok(1:02:05) grip=ok(400→560) cmt=ok reviewOut=ok pause=ok(1:02:05)`. (A second run showed grip=BAD(560→580) only because the first run persisted consoleWidth=580 and 560→580 hit the window-edge clamp.)

## 2026-10-13 11:23:40

## v1.4.0 — improvement loop, seed v2 (multi-language), DB forensics

- The drill workspace now stays fully live after unlock: `runCurrent()` no longer gates on `c.active`, `$('btn-run').disabled` stays false, `saveAttemptCode()` persists edits when `!c.active` (removed that guard), and `completeAttempt()` dropped its `!c.active` guard so a green re-run upgrades the attempt to passed (never downgrades — non-passing runs just refresh results). Multiple AI reviews append into #review-out (hr separators) instead of replacing.
- Seed v2 in db.js: `SEED_VERSION` + a `meta` table (`INSERT OR REPLACE`), init() migrates v1→v2 (deletes Next.js/Tailwind ONLY when pristine: practice_count=0, last_practiced_at NULL, unchanged seed notes; then `insertSeedSkills()` inserts any missing seed by name via `INSERT … SELECT … WHERE NOT EXISTS`). 20 default skills now: JS, TS, React, Node, HTML, CSS, Expo, Python, Java, C#, C, C++, Go, Rust, SQL, PHP, Ruby, Swift, Kotlin, Bash.
- ai.js: the generator prompt now has an EXECUTABLE VS WRITTEN LANGUAGES section — only JS/TS ("code"/"bug") and HTML+CSS ("dom") can run; every other language/framework must be kind "quiz" with one self-contained 6-15 line snippet in quiz.question (predict output / spot the bug / pick the idiom), and a requested runnable kind for an unrunnable language is silently swapped to quiz.
- 🔴 DB forensics path: `~/Library/Application Support/com.chatoss.desktop/app-dbs/<app-id>/dont_be_dumb.db` (app id here: dev.tjmccarty.dont-be-dumb). Readable with plain sqlite3 while ChatOSS runs (WAL). Use it to VERIFY selftest cleanliness instead of guessing.
- 🔴 Selftest rollback pattern that worked: snapshot the affected skill row (last_practiced_at/practice_count/pass_count), run with a temp task (DELETE rows afterwards), then restore the skill row with a direct UPDATE. Verified against the real DB afterwards — counters matched to the microsecond.
- Test-data gotcha: for a case-transform drill, `(''.toUpperCase()) === ''.toLowerCase()` — the empty-string case passes either way; choose data that actually flips between the wrong and right implementations.
- Verified end-to-end signature: `booted=ok seed=ok(20) pass=ok editSave=ok rerun=ok(passed, no downgrade) loop=ok`.
