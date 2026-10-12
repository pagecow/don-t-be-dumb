# Don't Be Dumb

An AI drill trainer for developers who refuse to let AI make them dumb.

You tell it the skills you want to keep — TypeScript, React, CSS, whatever you actually
use — and it writes fresh, interview-style drills for them, one at a time, and never the
same one twice. You solve in a strict, no-help workspace with real tests. When you pass
(or give up), the reference solution and an AI review of your code unlock.

Built as a ChatOSS app (`.aip`).

## What's inside

- **Fresh drills every time** — every generated drill is stored in a local SQLite
  database, and the last 30 titles + concept tags are fed back into the generation
  prompt so scenarios never repeat. Exact collisions auto-regenerate.
- **Real test runners, locally** — JS/TS function drills execute in a sandboxed Web
  Worker with a hard timeout (infinite loops get killed); HTML/CSS builds render in a
  sandboxed iframe and are checked against real computed styles.
- **Genuine TypeScript checking** — the official TypeScript compiler (5.6.3) is
  vendored in; TS drills run through it, and "type-check my TS" reports real
  strict-mode diagnostics with line numbers.
- **Strict mode** — description, editor, Run tests. Hints, solutions and reviews only
  unlock after you pass or formally give up.
- **Rot radar** — per-skill last-practiced, decay warnings, pass rates and streaks, so
  you can see what you're about to forget.
- **Optional daily nudge** — one gentle reminder if a skill is rotting (toggleable in
  Settings).

## Install

1. Download `app-v1.0.0.aip` from [Releases](../../releases).
2. Open it with ChatOSS (or drop it on the Apps app).

Requires ChatOSS and an AI model configured in its Models section.

## Repo layout

- `app.json` — the ChatOSS app manifest
- `index.html`, `style.css` — the app shell
- `js/` — editor, sandboxed runners, TypeScript layer, data layer, AI layer, app logic
- `libs/` — vendored TypeScript compiler + stdlib (`libs/tslibs.js` is generated from
  `libs/lib/*.d.ts` by `tools/build-tslibs.py`)
- `tools/build-tslibs.py` — regenerates the embedded stdlib bundle

## License

MIT — see [LICENSE](LICENSE).
