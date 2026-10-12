# Don’t Be Dumb — ChatOSS .aip project

You are building a ChatOSS `.aip` app in the project folder `com.example.don-t-be-dumb`.
The complete, current guide for building ChatOSS apps follows. It is the
authoritative API contract — follow it exactly and do not invent APIs that
are not documented here.

---

# How to build a ChatOSS app (.aip)

You are building an app for **ChatOSS**, a desktop "operating system for AI work." Follow this guide exactly — it is the complete, current contract.

## What a .aip is

A ChatOSS app is a **folder of plain HTML, CSS, and JavaScript** with an `app.json` manifest, **zipped**, with the zip named `<anything>.aip`. No frameworks, no build step, no npm, no server. The user installs it by dropping the file onto ChatOSS's Apps app; it appears in their dock with its icon and runs in a sandboxed window.

Deliver your work as the individual files (clearly labeled with their paths), plus the instruction: "zip these files (they must sit at the zip root), rename the zip to `yourapp.aip`, and drop it on the ChatOSS Apps app."

**If you are running inside ChatOSS's Code app**, you have an extra ability: a `publish_app` tool that installs the finished app directly into the user's dock — no manual zip/drop needed. The user gets a Publish / Cancel prompt; on Publish the folder is zipped, validated, and installed (same pipeline as dropping a .aip on the Apps app). When the app is done, **ask the user if they'd like you to publish it now** rather than only handing them zip instructions, and call `publish_app` with the app folder's path if they say yes.

## Folder structure

```
my-app/
├── app.json      ← manifest (REQUIRED, at the root)
├── index.html    ← entry point (REQUIRED; the name is configurable via "entry")
├── main.js       ← any JS/CSS/images, any names, any subfolders
├── style.css
├── icon.svg      ← the dock icon (recommended)
└── libs/         ← vendored third-party browser libraries, if needed
```

Files are served at real URLs at runtime, so relative references all work: `<script src="main.js">`, `<link rel="stylesheet" href="style.css">`, `<img src="icon.svg">`, and `fetch('data.json')` (for reading the app's own bundled files).

Constraints:
- `app.json` and the entry HTML must be at the **zip root** (zipping the parent folder is also accepted — one shared root directory is stripped).
- Unpacked size limit: **20 MB**.
- Need a JS library? Vendor its prebuilt browser file into `libs/` and load it with a script tag. There is no npm install.

## app.json — the manifest

```json
{
  "id": "com.you.myapp",
  "name": "My App",
  "version": "1.0.0",
  "description": "One honest sentence about what this app does.",
  "icon": "icon.svg",
  "capabilities": ["chatApi", "fileAccess"],
  "scopedDataKeys": ["myapp.state"],
  "dataStoreRequests": [],
  "toolsStoreRequests": []
}
```

| Field | Required | Rules |
|---|---|---|
| id | yes | Unique, reverse-DNS, **lowercase** letters/digits/dots/dashes only (it becomes a URL host). `com.chatoss.*` is reserved. Reinstalling the same id updates the app in place. |
| name | yes | Shown in the dock and Apps manager. |
| version | yes | Free-form string. |
| description | yes | One line. |
| icon | no | An image file in the folder (PNG/JPEG/WebP/GIF/SVG), square, ≥64×64. Becomes the dock icon. Without it, a letter fallback is used. |
| entry | no | The HTML file to open. Defaults to "index.html". |
| capabilities | no | Array of: "chatApi", "fileAccess", "fileDrop", "terminal", "webSearch", "webview", "notifications", "clipboardRead", "clipboardWrite", "hostHttp", "globalShortcut", "openExternal", "background", "documents", "boards", "sqlite", "appInstall", "preview", "proposeTask", "secrets", "mcp", "drive", "driveShared". Undeclared capabilities = those APIs are refused at runtime. Declare ONLY what you use. |
| webviewAllowlist | no | Required WITH "webview": array of allowed domains (e.g. ["wikipedia.org", "khanacademy.org"]). The OS restricts every webview window to these hosts (subdomains included). Ignored without the "webview" capability. |
| httpAllowlist | no | Required WITH "hostHttp": array of allowed domains (e.g. ["api.example.com"]). Requests are restricted to these hosts (subdomains match) AND to public IPs — a Rust SSRF guard blocks localhost/private/cloud-metadata even if a listed domain resolves there, and redirects aren't followed. Ignored without "hostHttp". |
| shortcuts | no | Required WITH "globalShortcut": array of accelerators (e.g. ["CmdOrCtrl+Shift+K"]) the app may register as system-wide hotkeys. First registration of each prompts. Ignored without "globalShortcut". |
| openExternalAllowlist | no | With "openExternal": http/https hosts (subdomains match) the app may open in the default browser. Enforced in Rust (scheme http/https/mailto only — never file:// or a local path). Optional — mailto: links always work. Ignored without "openExternal". |
| backgroundTasks | no | Required WITH "background": array of { "id", "name"?, "description"?, "trigger" } the app may run while its window is closed (max 8). `trigger` is one of { "type": "manual" } · { "type": "interval", "minutes": n } (floored to 5) · { "type": "daily", "hour": 0-23, "minute": 0-59 } · { "type": "weekly", "weekday": 0-6, "hour", "minute" } (0 = Sunday). Ignored without "background". |
| scopedDataKeys | no | The private storage keys you use (documentation; private storage never prompts). |
| dataStoreRequests | no | Only to WRITE shared OS-wide data: array of { "key", "what", "why" } — shown verbatim in the user's approval prompt. |
| toolsStoreRequests | no | Only to publish a tool to ChatOSS's own agents: array of { "toolName", "description", "why" }. Rare. |
| terminalCommandPrefixes | no | With "terminal": command prefixes (first tokens, e.g. ["git", "ls", "grep"]) the app declares it will run. Declared prefixes are disclosed + approved at install and then run WITHOUT per-command prompts; undeclared prefixes still prompt. In headless/background runs, ONLY declared prefixes may run. Ignored without "terminal". |
| apiExports | no | Functions this app EXPORTS for other apps to call: array of { "name", "description", "params"?, "why" }. Names must be valid function names and unique. Exported APIs also become global tools named "<appId>.<name>" that any AI agent can call — even when this app is closed. |
| apiRequests | no | Other apps' APIs this app wants to CALL: array of { "appId", "methods"?, "minVersion"?, "why" }. Approved at install — zero runtime prompts. Without an entry for an app id, apps.call to it is refused. `"appId": "*"` is the WILDCARD: "may call the exported API of ANY installed app or built-in service" — the broadest grant in the system, disclosed unmistakably at install, so use it only for a genuine developer tool (an API explorer) that cannot name its targets. An exact appId entry WINS over the wildcard, so you can hold `"*"` and still pin one named app. `"minVersion"` (dotted-numeric, e.g. "1.2.0") is ENFORCED at call time against the target's manifest `version` — an older target is refused with an error naming both versions; it is rejected outright on a `"*"` entry (a pin against every app on the machine is meaningless). `"methods": ["*"]` (or omitting methods) = any method the target exports. |
| supersedes | no | Built-in dock apps this app REPLACES, e.g. `["code"]`. While your app is installed and dock-visible, that built-in's dock pill and section slot route to your app instead. Legal ids: "chat", "kanban", "code", "models", "connect", "docs" ("apps" is deliberately NOT supersedable — it is the only surface that can uninstall you). 🔴 Reversible by construction: uninstalling or hiding your app restores the built-in immediately. It is disclosed at install as the highest-risk line on the screen ("This app replaces the built-in Code app"), so only declare it when replacing the built-in IS the point of the app. |
| window | no | Opt in to opening as your app's OWN floating, dock-free OS window instead of inside the main ChatOSS window: `{ "floating": true, "width": 720, "height": 460, "minWidth"?: 320, "minHeight"?: 240, "alwaysOnTop"?: false, "decorations"?: true, "resizable"?: true, "skipTaskbar"?: false, "title"?: "Terminal" }`. For an app that wants to be small and always to hand (a terminal, a calculator, a clock) — it opens like a Terminal window on a Mac, and its window renders NO app dock. `floating` is REQUIRED and must be a boolean; every other field is optional with the defaults shown (title defaults to your app `name`). Sizes are logical px, 200-8000, and a `minWidth`/`minHeight` larger than `width`/`height` is rejected. 🔴 This is NOT a capability and grants your app NOTHING: it is the same sandboxed iframe, the same bridge, the same declared capabilities — only the geometry changes, so there is no prompt and no install-disclosure line. Omit the block (or say `{ "floating": false }`) and your app opens inline exactly as before. The user can still open a floating app inline from its dock pill's right-click menu ("Open in Main Window"). Cannot be combined with `supersedes` (a superseding app renders in the main window's section slot). Per-OS: `alwaysOnTop` works on macOS + Windows and may be ignored by a Wayland compositor; `skipTaskbar` is a NO-OP on macOS (there is no per-window taskbar) and hides the window from the Windows taskbar / Linux window list; `decorations: false` removes the system title bar (and its close button) on every platform — your window is then closed by the × in the titlebar ChatOSS draws for you, and on Windows/Linux it may no longer be resizable by dragging its edges. |

## Styling — the platform stylesheet (READ THIS BEFORE YOU WRITE ANY CSS)

ChatOSS injects TWO stylesheets into every app frame, before your own CSS, in this order:

1. `appTheme.css` — the design **tokens** as CSS custom properties (`--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-2`, `--muted`, `--faint`, `--accent`, `--accent-fg`, `--accent-soft`, `--link`, `--danger`, `--danger-fg`, `--green`, `--amber`, `--blue`, `--purple`, `--radius`, `--sans`, `--mono`, …). These are the SAME names and values the built-in ChatOSS sections use, so an app styled with them is literally the same colour as the OS around it.
2. `appUi.css` — the platform **component classes**: `.app-shell` / `.app-shell--two` / `.app-shell--plain`, `.app-sidebar`, `.app-sidebar-label`, `.app-main`, `.app-aside`, `.app-titlebar`, `.app-title`, `.app-body`, `.app-footer`, `.toolbar`, `.spacer`; `.btn` `.btn-primary` `.btn-danger` `.btn-ghost` `.btn-sm` `.btn-icon` `.btn-row` `.seg`/`.seg-item`; `.field` `.field-row` `.label` `.hint` `.input` `.textarea` `.select` `.checkbox`; `.list` `.list-row` `.list-row-title` `.list-row-meta`; `.chat` `.msg` `.msg-role` `.bubble` `.msg-body` `.composer` `.tool`/`.tool-head`/`.tool-name`/`.tool-status`/`.tool-body`; `.badge` (+`-success`/`-warn`/`-danger`/`-info`) `.chip` `.chip-dot` `.statusline` `.spinner` `.card`; `.overlay` `.modal` `.modal-head`/`-body`/`-foot` `.modal-close`; `.empty`/`.empty-title`/`.empty-text`, `.code-block`; `.muted` `.faint` `.mono` `.truncate` `.nowrap`. Bare `<input>`/`<textarea>`/`<select>`/`<button>`/`h1–h4`/`a`/`hr` are styled too, so plain semantic HTML already looks right.

🔴 **The three rules. Every app in the ChatOSS app catalogue had to be repaired for breaking them.**

1. **Build your UI out of the platform classes and tokens first.** Reach for `class="btn btn-primary"` and `var(--surface-2)`, not a hand-rolled palette. Your own CSS loads LAST and nothing is namespaced, so you can still override any platform selector — but override, don't replace.
2. **NEVER redefine the colour tokens on `:root`** (`:root { --bg: #fff; --text: #111; … }`). That overwrites the host's palette for your frame only, so your app freezes in one theme while the rest of the OS switches, and it strands you on the wrong text/background pairing. Define your OWN new variables under an app-specific name if you need extras (`--myapp-note-yellow`), never the platform names.
3. **NEVER use `@media (prefers-color-scheme: dark)`.** The host does not follow the OS preference — it follows the ChatOSS Light/Dark/System setting, which it publishes by stamping `data-theme="light"` or `data-theme="dark"` on your document's root element (and re-stamping it live when the user changes it). A `prefers-color-scheme` rule therefore fires at the wrong times: a user in explicit Light mode on a dark-mode machine sees your app go dark while every other app stays light. If you genuinely need a per-theme rule of your own, key it off the stamp: `[data-theme='dark'] .my-thing { … }`. Almost always you need no such rule at all — style with the tokens and both themes come for free.

Both themes must be checked. Never hardcode `#fff` as the text on an `--accent` surface: `--accent` is near-black in light and near-white in dark, so use its paired `var(--accent-fg)`.

## The runtime API — window.chatoss

The app runs in a sandboxed iframe. `window.chatoss` is injected before your code runs; it is the ONLY bridge to the OS. **Every method returns a Promise — always await.**

### 🔴 There are NO native dialogs in the sandbox — confirm() / alert() / prompt() DO NOT WORK

The app frame is `sandbox="allow-scripts"` and deliberately does **not** get `allow-modals`. So:

- `window.confirm(...)` **always returns `false`**, immediately, without showing anything.
- `window.alert(...)` and `window.prompt(...)` are no-ops (`prompt` returns `null`).
- `window.print()` is blocked too (use the `documents` API instead).

This is silent — no exception, no console warning — and it is the single most destructive mistake in a ChatOSS app: `if (!confirm('Delete this card?')) return;` makes the delete button do **nothing, forever**. Every delete/discard/overwrite path written that way is dead code.

Build your own confirmation with the platform classes instead:

```js
// A real, in-frame confirm. .overlay + .modal are platform classes; [hidden] is
// forced display:none by the platform sheet, so toggling the attribute works.
function confirmDialog(message) {
  return new Promise((resolve) => {
    const el = document.getElementById('confirm');
    el.querySelector('.modal-body').textContent = message;
    el.hidden = false;
    const done = (ok) => { el.hidden = true; resolve(ok); };
    el.querySelector('.confirm-ok').onclick = () => done(true);
    el.querySelector('.confirm-cancel').onclick = () => done(false);
  });
}
if (await confirmDialog('Delete this card?')) await deleteCard(id);
```

### 🔴 Two filesystems — `files` vs `drive`. Never confuse them.

- **`window.chatoss.files`** — the **user's real disk**. Needs a native folder/file picker; every path is confined to a root the user explicitly granted. Capability `fileAccess`. This is where a coding agent or an editor works on the user's own project.
- **`window.chatoss.drive`** — **ChatOSS-managed storage**. No picker, no prompt: your app writes into its own container the way it writes into its own SQLite database. Backup-eligible, and the user browses it in the built-in **Files** app. Capability `drive`.

Ask yourself: *is this the user's project, or is this my output?* Project → `files`. Output (a generated report, an exported chart, a scraped dataset, a saved transcript) → `drive`. They are separate namespaces with separate capabilities on purpose — `files` carries the "every path was user-consented" invariant end to end, and `drive` is the thing cloud backup will cover. See `docs/drive-design.md` §1 and §6.

### Private storage (no capability, never prompts)

```js
await window.chatoss.scopedData.set('myapp.state', anyJsonValue);
const value = await window.chatoss.scopedData.get('myapp.state'); // undefined if unset
await window.chatoss.scopedData.delete('myapp.state');
const keys = await window.chatoss.scopedData.list();  // every key this app has stored
// keys() is an alias for list() — no need to track your key names yourself.
```

Persists across launches, private to this app. Use this for all app state unless other apps must read it.

### Private SQLite databases (capability: "sqlite"; no prompt — declare only)

For structured data that outgrows key-value storage — conversations, terminal history, rows you want to query — declare `"sqlite"` and get your own **private, persistent SQLite database files** (one per name you open). No approval prompt; the files live under the app's private data directory and survive restarts.

```js
// app.json: "capabilities": ["sqlite"]

const name = await window.chatoss.db.open('myapp');   // → 'myapp' (sanitized) or null
await window.chatoss.db.exec('myapp', 'CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT)');
await window.chatoss.db.exec('myapp', 'INSERT INTO notes (text) VALUES (?)', ['hello']); // params optional
const rows = await window.chatoss.db.query('myapp', 'SELECT * FROM notes WHERE text = ?', ['hello']);
// → [{ id: 1, text: 'hello' }] — rows as objects keyed by column name
await window.chatoss.db.close('myapp'); // drops the cached handle; the file persists
```

The FLAT shape above — `exec(name, sql, params?)` / `query(name, sql, params?)` / `close(name)`, with the database name as the first argument — is the real bridge surface and the one to prefer. `open(name)` also returns a **handle** built client-side on top of those same flat calls, if you find it tidier:

```js
const db = await window.chatoss.db.open('myapp');   // → handle, or null on failure
await db.exec('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT)');
const rows = await db.query('SELECT * FROM notes WHERE text = ?', ['hello']);
await db.close();
```

Rules:
- `open(name)` creates/opens a private DB file (name is sanitized to `[a-zA-Z0-9_-]`), one file per name.
- `exec(name, sql, params?)` runs DDL/DML (CREATE/INSERT/UPDATE/DELETE) and returns the affected-row count. `query(name, sql, params?)` runs a SELECT and returns rows as objects keyed by column name.
- 🔴 **`params` really are bound.** Use `?` placeholders and pass values positionally — never string-concatenate SQL. (In an older build `params` was silently dropped, so `INSERT … VALUES (?)` inserted nothing; that is fixed, and a build old enough to drop them is old enough to fail loudly elsewhere.)
- `close(name)` drops the cached connection; the file persists.
- Each app can only touch its OWN databases — the app id comes from the manifest host-side, never from your arguments, so there is no cross-app access and nothing to spoof.
- **A previewed / in-development app gets a real database too.** An app with no installed record (running under `preview.launch`, or from the Create app's live preview) is namespaced to its own container rather than refused, so you can build and test the whole schema before publishing.

### AI chat (capability: "chatApi", no prompt)

Build an in-app model picker from ChatOSS's credential-free model list. Never ask for or handle API keys:

```js
const models = await window.chatoss.chat.listModels();
// [{ id, name, source: 'local'|'cloud'|'custom', capabilities,
//    contextLength, available, unavailableReason? }]
const defaultModel = await window.chatoss.chat.getDefaultModel();

// Show models in your own <select>; disable rows where available is false.
// Save the chosen opaque id in your app/project state, then pass it explicitly:
const result = await window.chatoss.chat.runTurn({
  model: selectedModelId || defaultModel,
  messages: [                       // REQUIRED. Roles: system | user | assistant
    { role: 'system', content: 'You are concise.' },
    { role: 'user', content: 'Hello' }
  ],
  onToken: (t) => { out.textContent += t; },   // streamed reply chunks — use for live UI
  onThinking: (t) => {},            // streamed reasoning, when the model exposes it
  tools: TOOLS,                     // optional function-calling (see below)
  onToolCall: async (call) => '…',  // executes your tools; return a STRING result
  think: true,                      // optional: ask the model to reason first
  signal: abortController.signal    // optional: abort() stops the turn
});
// result = { content, thinking, toolCalls, usage?, aborted }
```

- If `model` is omitted, the app-wide ChatOSS default answers.
- `listModels()` exposes model ids and display metadata only — never credentials, tokens, or account details.
- Multi-turn memory = keep your own messages array and send all of it each turn.
- Your app's chats see ONLY the tools you pass — never the user's other tools.

Function calling: describe tools with JSON schema; the engine loops automatically (model calls tool → your onToolCall returns a string → model continues). There is **no round limit** — the loop runs until the model stops calling tools, so a long orchestration is not truncated part-way. It ends early only if you abort the turn (`signal`), which sets `aborted` on the result.

### Web (capability: "webSearch")

Declare `"webSearch"` and the model can call the OS's `web_search` / `web_fetch` tools during a `chat.runTurn` — ChatOSS answers them itself (your `onToolCall` is not called for them). You can also search directly:

```js
const results = await window.chatoss.web.search('latest Ollama release', 5); // -> [{ title, url, content }]
const page = await window.chatoss.web.fetch('https://example.com');           // -> { title, content, links }
```

Web access rides the user's backend (a signed-in Ollama account, or a paid ChatOSS plan). When neither is available, the tools aren't advertised and `web.search`/`web.fetch` reject with a clear error.

### Webview — open real websites (capability: "webview")

An app runs in a sandboxed iframe, so embedding another site with `<iframe src="https://…">` only works for sites that permit framing — any site sending `X-Frame-Options: DENY/SAMEORIGIN` or a CSP `frame-ancestors` renders blank, and there is no client-side way around it. To build a browser / kiosk / kid-safe app that opens real sites, declare the `"webview"` capability plus a `"webviewAllowlist"`, then open a real top-level window:

```js
// app.json: { "capabilities": ["webview"], "webviewAllowlist": ["wikipedia.org", "khanacademy.org"] }
const { id } = await window.chatoss.webview.open({ url: 'https://en.wikipedia.org', title: 'Wikipedia' });
// …later:
await window.chatoss.webview.close(id);
```

The window's navigation is locked to your `webviewAllowlist` **at the OS level** (enforced in Rust): a click or redirect to any host not on the list is cancelled before it loads — a real firewall your page JS can't widen or escape. Because it's a top-level window (not an iframe), sites that refuse framing load fine. `open()` rejects if the URL's host isn't on the allowlist. This is the ONLY way to enforce a navigation allowlist — a JS-only allowlist inside an iframe is not a security boundary.

### Embedded web views — real web pages INSIDE your app (capability: "webview")

Same capability + allowlist, but the page renders **inside your own layout** instead of a separate window — this is how you build in-app browser tabs, embedded dashboards, or doc panes. The easy path is `mount(element, {url})`, which glues a real web view to one of your DOM elements and keeps it there as the window scrolls/resizes:

```js
// app.json: { "capabilities": ["webview"], "webviewAllowlist": ["wikipedia.org"] }
const box = document.getElementById('viewport');          // any element you sized in your layout
const view = window.chatoss.webview.mount(box, { url: 'https://en.wikipedia.org' });
await view.ready;                                          // resolves to { id }
view.onEvent(({ url, loading }) => { /* update a URL bar / spinner / tab title */ });
await view.navigate('https://en.wikipedia.org/wiki/Cat'); // load another allowed URL
// view.close() removes it and stops tracking.
```

For finer control (e.g. many tabs sharing one area), use the primitives directly:

```js
const { id } = await window.chatoss.webview.embed({ url, rect: { x, y, width, height } }); // rect = your element's box (CSS px)
await window.chatoss.webview.setBounds({ id, rect });   // call on scroll/resize to keep it glued
await window.chatoss.webview.navigate({ id, url });
await window.chatoss.webview.goBack(id);   // also goForward(id), reload(id)
window.chatoss.webview.on(id, ({ url, loading }) => { /* … */ });
await window.chatoss.webview.close(id);
```

🔴 The embedded view is a **native layer that floats ABOVE your DOM** — it does not clip to rounded corners and nothing (menus, modals) can overlay it. Reserve a clear rectangle for it, and hide it (`setBounds` offscreen, or `close`) when you show UI on top. Same OS-enforced allowlist firewall as `open` — an app can never point an embedded view off its `webviewAllowlist`.

### Notifications (capability: "notifications"; prompts on first use)

Declare `"notifications"` and post an OS notification banner:

```js
// app.json: { "capabilities": ["notifications"] }
const shown = await window.chatoss.notifications.send({ title: 'Build finished', body: 'All 42 tests passed.' });
// shown === true if dispatched, false if the user denied.
```

The first send prompts the user once (Allow once / Allow always / Deny); an app the user has marked **Trusted** in the Apps manager sends without prompting. On macOS the app also needs the system notification permission, which ChatOSS requests the first time.

### Clipboard (capabilities: "clipboardRead" / "clipboardWrite"; no prompt)

Read and write are SEPARATE capabilities — declare only what you use. A "copy" button needs just `"clipboardWrite"`; `"clipboardRead"` is more sensitive (it sees whatever the user last copied, which could be a password), so request it only if you genuinely need to paste in.

```js
// app.json: { "capabilities": ["clipboardRead", "clipboardWrite"] }
const wrote = await window.chatoss.clipboard.writeText('Copied from my app!'); // resolves true
const text  = await window.chatoss.clipboard.readText();                       // resolves the clipboard text
```

Clipboard is a low-friction convenience, so it does NOT prompt (only terminal, files, and notifications warn at install / ask on first use). The user can still turn either capability off any time from the app's **Permissions** panel (the **⋯ menu → Settings** on the app's row in the Apps manager); a turned-off call rejects, so wrap clipboard calls in try/catch.

### Host HTTP — call any REST/GraphQL API (capability: "hostHttp"; no prompt for listed hosts)

Your sandboxed iframe is subject to CORS, so `fetch()` to most third-party APIs fails. Declare `"hostHttp"` + an `"httpAllowlist"` and make requests through the OS with NO CORS, restricted to the domains you list. A host NOT on your allowlist still works — the user is asked per request (scoped to that host; "Allow always" persists), so an app can reach any public API the user approves:

```js
// app.json: { "capabilities": ["hostHttp"], "httpAllowlist": ["api.github.com"] }
const res = await window.chatoss.http.request({
  url: 'https://api.github.com/repos/ollama/ollama',
  method: 'GET',                       // default GET; POST/PUT/PATCH/DELETE/HEAD too
  headers: { Accept: 'application/vnd.github+json' },
  // body: JSON.stringify({ … }),      // set your own Content-Type header
});
// res = { status, headers, body }; body is text — JSON.parse it yourself.
```

The allowlist is enforced **in Rust**: a request to a host you didn't list is refused, and so is any request that resolves to a **private / loopback / link-local / cloud-metadata** address (an SSRF guard — an app can never reach `localhost` or `169.254.169.254`, even through a listed domain that resolves there). **Redirects are not followed** (you get the 3xx + `Location` back). It's a real boundary your page JS can't widen — the allowlist comes from your manifest, not your code.

### Global shortcuts (capability: "globalShortcut"; prompts per accelerator)

Register a system-wide hotkey that fires even when your app isn't focused (a launcher, quick-capture tool, etc.). List the accelerators in `"shortcuts"`, then register one with a callback:

```js
// app.json: { "capabilities": ["globalShortcut"], "shortcuts": ["CmdOrCtrl+Shift+K"] }
const ok = await window.chatoss.shortcuts.register('CmdOrCtrl+Shift+K', () => {
  // fires on every press, even when another app is focused
});
// later: await window.chatoss.shortcuts.unregister('CmdOrCtrl+Shift+K');
```

You can only register accelerators you listed in `"shortcuts"`. The first registration of each prompts the user once (`ok` is `false` if they deny). Shortcuts are released automatically when your app closes.

### Open external links (capability: "openExternal")

Hand a URL to the user's default browser or mail client — a "read more on the web" link, an OAuth start page, a support email, etc. List the web hosts you'll open in `"openExternalAllowlist"` (`mailto:` always works):

```js
// app.json: { "capabilities": ["openExternal"], "openExternalAllowlist": ["example.com"] }
await window.chatoss.openExternal.open('https://example.com/docs');
await window.chatoss.openExternal.open('mailto:support@example.com?subject=Help');
```

Only `http`/`https` (to a listed host) and `mailto:` open — `file://`, other schemes, and off-list hosts are refused in Rust, so an app can't launch a local file/executable or reach an unlisted site.

### Background tasks (capability: "background"; prompts on first use)

Run work on a schedule **while your app's window is closed** — sync, poll, a daily digest. Declare the tasks in `"backgroundTasks"` (this list is the ceiling; app code can't invent a new schedule), then register ONE handler at load. ChatOSS fires a due task by mounting your app **headless** (offscreen, no UI), calling your handler with the task id, and disposing it when the handler resolves:

```js
// app.json: {
//   "capabilities": ["background", "hostHttp"],
//   "httpAllowlist": ["api.example.com"],
//   "backgroundTasks": [{ "id": "sync", "name": "Sync inbox", "trigger": { "type": "interval", "minutes": 30 } }]
// }
window.chatoss.background.onTask(async (taskId) => {
  if (taskId === 'sync') {
    const res = await window.chatoss.http.request({ url: 'https://api.example.com/inbox' });
    await window.chatoss.scopedData.set('inbox', JSON.parse(res.body));   // persists for the next window open
  }
});
```

- **Triggers:** `{ type: "interval", minutes }` (floored to 5), `{ type: "daily", hour, minute }`, `{ type: "weekly", weekday, hour, minute }` (0 = Sunday), or `{ type: "manual" }` (runs only when the user hits **Run now** in the app's Activity view). Max 8 tasks.
- **Keep runs SHORT and idempotent.** There's a per-run time budget (~30–60s) — over it, the run is force-disposed. One run at a time per task; a slow run doesn't stack.
- **Your WHOLE app boots for each headless run** — index.html runs top to bottom with no window. Gate load-time side effects (auto-running checks, sounds, notification sends) with `const headless = await window.chatoss.background.isHeadlessRun()`; a headless boot should register `onTask` and nothing else.
- **What works headless (the working set):** `scopedData`, `data` (incl. `publish`), `scopedTools`, `http`, `chat.runTurn`, `web`, `notifications`, `clipboard.writeText`, `db`, `drive` (list/stat/read/write/mkdir/move/copy/remove/usage), `boards`, `documents.generate`, `secrets`, `mcp`, `process`, `apps` (call + registerApi + listApis), `platform`, `approvals`, `manifest`, `proposeTask`, and **`terminal`** — including `exec`/`spawn`/`spawnCodingAgent` and every session method, but ONLY for command prefixes you declared in `terminalCommandPrefixes` (an undeclared prefix is auto-denied: there is no window to prompt in). **`files` read/write DOES work headless** — `readFile`, `writeFile`, `listDir`, `search`, `watch` all run, *provided a root was already picked in an earlier visible run* (picked roots are persisted); with no picked roots they reject.
- **What refuses / no-ops headless (no window to use):** every `webview` call, the `files` **dialogs** (`openDialog`, `saveDialog`, `pickFolder`) and `files.onDrop`, `documents.save` (it opens a save dialog), `drive.exportTo`/`drive.importFrom` (they touch the user's real disk), `shortcuts.register`, `clipboard.readText`, `openExternal.open`, `terminal.requestSession`, global `tools.register`/`requestRegister`, `appInstall.install`, and `preview.launch`. Store results in `scopedData`/`db`/`drive` and render them the next time the window opens.
- **Honest scheduling:** tasks fire only while **ChatOSS itself is running** (the window being closed is fine; a full quit — ⌘Q / Ctrl+Q — is not). A schedule missed while ChatOSS was quit fires on the next launch. This is a desktop app, not a server.
- **Consent:** `"background"` is disclosed on the install screen (with each task's schedule) and prompts once on first fire (Allow once / always / Deny; a **Trusted** app skips the prompt). The user can switch it off any time in **Permissions** — that stops all the app's tasks immediately.
- **Users can watch and trigger tasks too:** **Apps → Background activity** lists every declared task's schedule, live status, and run history, with a **Run now** button — design handlers to be safe to run twice, since a manual fire can land right next to (or instead of) a scheduled one.

```js
const TOOLS = [{
  type: 'function',
  function: {
    name: 'add_item',
    description: 'Add one item to the list.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  }
}];
const result = await window.chatoss.chat.runTurn({
  messages: [
    { role: 'system', content: 'Manage the list with tools. Current list:\n' + serialize() },
    { role: 'user', content: userAsk }
  ],
  tools: TOOLS,
  onToolCall: async (call) => {
    const args = call.function.arguments;      // ALREADY PARSED to an object
    if (call.function.name === 'add_item') { addItem(args.text); return 'Added ' + args.text; }
    return 'Error: unknown tool';
  }
});
```

Include the app's current state in the system message — the model can only act on what it sees.

### Files (capability: "fileAccess"; first use prompts the user once)

```js
const path = await window.chatoss.files.saveDialog({
  defaultPath: 'export.txt',
  filters: [{ name: 'Text', extensions: ['txt'] }]
});                                              // null = cancelled/denied — ALWAYS check
await window.chatoss.files.writeFile(path, contents);
// contents: string OR binary (ArrayBuffer / typed array / Blob — e.g. jspdf output)

const openPath = await window.chatoss.files.openDialog({ filters: [...], multiple: false });
const text = await window.chatoss.files.readFile(openPath);   // text
const bytesB64 = await window.chatoss.files.readFile(openPath, { binary: true }); // raw bytes as base64
const folder = await window.chatoss.files.pickFolder();       // null if cancelled
```

Drag-and-drop needs capability "fileDrop" (no prompt — dropping is the user's action):

```js
window.chatoss.files.onDrop(async (files) => {
  // each file: { name, type, size, text(): Promise<string>, arrayBuffer(): Promise<ArrayBuffer> }
  const content = await files[0].text();
});
```

After `pickFolder()` returns a path, you can list and watch that subtree:

```js
const folder = await window.chatoss.files.pickFolder();   // null if cancelled
if (folder) {
  // List one directory level (non-recursive). Entries: { name, isDir, size }.
  const entries = await window.chatoss.files.listDir(folder);
  for (const e of entries) console.log(e.name, e.isDir ? 'dir' : 'file', e.size);

  // Watch a path (recursive) for changes. Returns an unsubscribe function.
  // The callback fires with debounced batches (~300ms) of { type, path } where
  // type is 'create' | 'modify' | 'delete' — handy to refresh a tree when a
  // CLI agent edits files. Only paths inside a picked folder may be watched.
  const stop = window.chatoss.files.watch(folder, (events) => {
    for (const ev of events) console.log(ev.type, ev.path);
  });
  // later:
  stop();   // tears down the watcher (also auto-torn-down on app close)
}
```

`listDir`, `watch`, and `search` only accept a path from `pickFolder()` (or a path inside
one) — there is no path access outside user-picked folders.

**Search inside picked folders** (native grep — no shell, no approval prompt):

```js
const result = await window.chatoss.files.search('needle', {
  path: folder,            // optional: narrow to one subtree inside a picked folder
  contextLines: 2,         // surrounding lines per match (0–5)
  caseSensitive: false,    // default: case-insensitive substring
  maxResults: 100,        // cap (1–500); result.truncated reports the cap was hit
});
// → { matches: [{ path, lineNumber, line, contextBefore: [...], contextAfter: [...] }], truncated }
```

It skips dot-directories (.git, node_modules, …), symlinks, files over 1MB, and binary files — the same discipline a coding agent's grep uses.

### Documents (capability: "documents"; no prompt — declare only)

Generate **real** PDF, Word, Excel, PowerPoint, JPG, and PNG files through the OS — no vendored library, no build step, and no `window.print()` (which is BLOCKED in the sandboxed iframe, since the sandbox grants no `allow-modals`). The OS bundles the generators (jspdf, xlsx, docx, pptxgenjs) and builds the bytes in the host; you write them to disk with the File API — or use the one-call `save()` helper.

```js
// app.json: "capabilities": ["documents", "fileAccess"]

// The simplest PDF — give it text, get back bytes, save them:
const { bytesB64 } = await window.chatoss.documents.generate({
  type: 'pdf',
  content: { title: 'Report', paragraphs: ['First paragraph.', 'Second paragraph.'] }
});
const path = await window.chatoss.files.saveDialog({
  defaultPath: 'report.pdf',
  filters: [{ name: 'PDF', extensions: ['pdf'] }]
});
if (path) await window.chatoss.files.writeFile(path, window.chatoss.documents.base64ToBytes(bytesB64));

// Or the one-call helper (generate + save dialog + write → path | null):
const saved = await window.chatoss.documents.save({
  type: 'xlsx',
  content: { sheets: [{ name: 'Q1', rows: [['Item', 'Qty'], ['Widget', 42]] }] },
  defaultPath: 'q1.xlsx'
});
```

Supported `type` values and their `content` shapes:

| type | content | notes |
|------|---------|-------|
| `pdf` / `docx` | `{ title?, blocks?, paragraphs?, text? }` | see the two shapes below — `blocks` keeps formatting, `paragraphs`/`text` are plain |
| `xlsx` | `{ sheets?: { name?, rows: (string\|number\|boolean\|null)[][] }[] }` | one+ worksheets of rows |
| `pptx` | `{ title?, slides?: { title?, bullets?: string[] }[] }` | one slide per entry |
| `jpg` / `png` | `{ image: string }` | `image` = a data URL or http(s) URL, re-encoded |

- `generate()` returns `{ bytesB64, ext, mimeType }`. Decode with `documents.base64ToBytes(bytesB64)` and pass to `files.writeFile`.
- `save({ type, content, defaultPath? })` does generate + save dialog + write in one call and resolves the chosen path (null if cancelled/denied). It needs BOTH `documents` and `fileAccess`.
- This is the EASIEST way to create documents. For full layout control you may still vendor your own library (jspdf, SheetJS, docx, pptxgenjs) and generate bytes in the iframe — see the Docs app's "Generating documents" page.

#### PDF / DOCX content — two shapes (READ THIS before formatting documents)

The PDF and DOCX generators accept **two** content shapes. Use the one that matches how your content is structured, or the **exported file's formatting will not match what your app's editor/preview shows** — this is the most common document bug.

**Shape 1 — plain text (simplest, no formatting):** `{ paragraphs?: string[], text?: string }`. Every paragraph becomes one unstyled line of body text. There is NO bold, italic, headings, or list support in this shape — pass markdown or HTML here and it will be rendered as literal text, NOT formatted. Use this only when your content is genuinely plain text.

```js
content: { title: 'Notes', paragraphs: ['First paragraph.', 'Second paragraph.'] }
// or a single blob split on line breaks (a single "
" or a blank line each
// end a paragraph — so a <textarea>'s newline-separated lines stay separate):
content: { title: 'Notes', text: 'First paragraph.\n\nSecond paragraph.' }
content: { title: 'Notes', text: 'Line one\nLine two\nLine three' } // → 3 paragraphs
```

**Shape 2 — structured blocks (keeps formatting — use this for any rich content):** `{ blocks: DocumentBlock[] }`. This is how headings, inline bold/italic/underline, and bullet/numbered lists survive from your app's editor/preview into the exported file, so "what you see is what you get." `blocks` takes precedence over `paragraphs`/`text` when present.

A `DocumentBlock` is one of:
- `{ type: 'heading', level: 1|2|3, text: string }` — a section heading.
- `{ type: 'paragraph', runs: TextRun[] }` — a paragraph of styled inline runs.
- `{ type: 'list', list: { type: 'bullet'|'number', items: (string|TextRun[])[] } }` — a list; each item is a plain string or its own array of runs.

A `TextRun` is either a plain `string` (unstyled) or `{ text: string, bold?: true, italic?: true, underline?: true }`. Build paragraphs and list items from runs to carry inline formatting.

```js
content: {
  title: 'Project Brief',
  blocks: [
    { type: 'heading', level: 1, text: 'Overview' },
    { type: 'paragraph', runs: [
        { text: 'This is ' },
        { text: 'bold', bold: true },
        { text: ' and ' },
        { text: 'italic', italic: true },
        { text: ' and ' },
        { text: 'underlined', underline: true },
        { text: ' inline text.' }
    ]},
    { type: 'heading', level: 2, text: 'Tasks' },
    { type: 'list', list: { type: 'bullet', items: [
        'Design the UI',
        'Build the API',
        [{ text: 'Ship it: ', bold: true }, { text: 'by Friday' }]   // mixed-style item
    ]}},
    { type: 'list', list: { type: 'number', items: [
        'First step', 'Second step', 'Third step'
    ]}}
  ]
}
```

🔴 **Why the exported file's formatting won't match your preview (and how to fix it).** Your app's editor/preview renders HTML/CSS in the iframe. The documents API does **not** take HTML — it takes the `blocks`/runs structure above and rebuilds the layout in its own renderer. So the export only matches the preview when you convert your editor's content to `blocks` before calling `generate()`. The four mistakes that make exports look wrong:

1. **Passing rich content as plain text.** `paragraphs: ['**Hello** world']` or `text: '<b>Hello</b> world'` — the API does NOT parse markdown/HTML, so `**Hello**` / `<b>Hello</b>` appears literally. Fix: convert to `blocks` → `{ type: 'paragraph', runs: [{ text: 'Hello', bold: true }, { text: ' world' }] }`.
2. **Concatenating the whole document into one `text` blob.** Headings and lists in a `text` blob are lost (everything is one unstyled paragraph run). Fix: emit one `block` per heading/paragraph/list.
3. **Dropping the space between styled runs.** Two runs `[{ text: 'bold', bold: true }, { text: 'word' }]` render as "boldword" — there is no auto-space between runs. Put the space inside a run: `[{ text: 'bold ', bold: true }, { text: 'word' }]`.
4. **Expecting styles the API doesn't support.** Only bold, italic, underline (and headings/lists) carry over — no colors, fonts, alignment, or font sizes beyond the built-in heading/title sizes. For pixel-perfect layout, vendor your own library (jspdf/docx) and build the bytes yourself.

**Converting your editor's HTML to blocks (the word-document-creator pattern):** walk your editor's DOM and emit one `DocumentBlock` per element. A minimal converter:

```js
function editorToBlocks(rootEl) {
  const blocks = [];
  for (const el of rootEl.childNodes) {
    if (el.nodeType === 3) { // text node
      const t = el.textContent;
      if (t.trim()) blocks.push({ type: 'paragraph', runs: [{ text: t }] });
      continue;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      blocks.push({ type: 'heading', level: Number(tag[1]), text: el.textContent });
    } else if (tag === 'ul') {
      blocks.push({ type: 'list', list: { type: 'bullet', items: [...el.children].map(li => htmlToRuns(li)) } });
    } else if (tag === 'ol') {
      blocks.push({ type: 'list', list: { type: 'number', items: [...el.children].map(li => htmlToRuns(li)) } });
    } else if (tag === 'p') {
      blocks.push({ type: 'paragraph', runs: htmlToRuns(el) });
    } else if (el.textContent.trim()) {
      blocks.push({ type: 'paragraph', runs: [{ text: el.textContent }] });
    }
  }
  return blocks;
}
// Recursively turn an element into styled runs, mapping <b>/<strong>→bold,
// <i>/<em>→italic, <u>→underline.
function htmlToRuns(el) {
  const runs = [];
  for (const node of el.childNodes) {
    if (node.nodeType === 3) { runs.push({ text: node.textContent }); continue; }
    const child = htmlToRuns(node);
    const tag = node.tagName.toLowerCase();
    const style = tag === 'b' || tag === 'strong' ? { bold: true }
      : tag === 'i' || tag === 'em' ? { italic: true }
      : tag === 'u' ? { underline: true } : {};
    child.forEach(r => Object.assign(r, style));
    runs.push(...child);
  }
  return runs;
}
// Then: generate({ type: 'docx', content: { title, blocks: editorToBlocks(editor) } })
```

🔴 **Formatting rules (so the export matches your preview):**
- The documents API does **not** parse markdown or HTML. If your app's editor produces markdown or HTML, convert it to `blocks`/runs yourself before calling `generate()` (see the converter above) — a markdown `**bold**` or `<b>bold</b>` passed as a plain `paragraph` string will appear literally, not bold.
- Pass one block per logical heading/paragraph/list item. Do not concatenate a whole document into a single `text` blob if it has headings or lists — those will be lost.
- Put spaces inside runs; the API does not insert a space between adjacent runs.
- Supported inline styles are **bold, italic, underline** only (no colors, fonts, or sizes beyond the built-in heading/title sizes). For pixel-perfect layout, vendor your own library (Tier 1 below).
- A `heading` becomes a real Word heading style (DOCX) / a bold larger line (PDF); a `list` becomes real Word bullet/numbering (DOCX) / a bullet or "1." marker (PDF).

### Terminal (capability: "terminal"; EVERY command prompts until the user allows that program)

Two APIs. Use `exec` for one-shot commands (returns when done). Use `spawn` for live interactive CLIs that stay alive and stream output.

```js
// ONE-SHOT (returns when the command finishes):
const result = await window.chatoss.terminal.exec('git status', { cwd: null, timeoutMs: 30000 });
// null = user denied. Otherwise: { output, exitCode, timedOut, cancelled }

// LIVE INTERACTIVE SESSION (streams, stays alive until you kill it):
const session = await window.chatoss.terminal.spawn('ollama', { args: ['run', 'codex'], cwd: null, cols: 80, rows: 24 });
// null = user denied. Otherwise a handle with:
//   session.id                          — the session id (pass to mount)
//   await session.paste(text)           — 🔴 send TEXT to an interactive CLI (see below)
//   await session.key('enter')          — 🔴 send ONE keypress (see below)
//   await session.write(data)           — raw stdin bytes (no read-boundary handling)
//   await session.modes()               — { bracketedPaste } as the child has it set
//   await session.resize(cols, rows)    — resize the PTY
//   await session.kill()                — kill the session + clean up
//   const unsub = session.onData(cb)    — cb(chunk, seq) per output chunk (fires live; seq is a
//                                          monotonically increasing sequence number)
//   const unsub = session.onExit(cb)    — cb(code|null) once on exit
//   const text = await session.getOutput()          — ALL output so far (up to ~64KB)
//   const text = await session.getOutput({ since }) — only output after the seq onData gave you
//   const screen = await session.getScreen()        — { lines, cursor, cols, rows }: the current
//                                          VISIBLE screen, ANSI interpreted by a host-side headless
//                                          xterm — what a user would SEE, not raw escape sequences
//   const cursor = await session.getCursor()        — { x, y } (0-based)
//   const waiting = await session.isWaitingForInput() — true | false | 'unsupported' (see below)
//   const unsub = session.onStateChange(cb)        — cb({ busy, foregroundProcess }) on every
//                                          busy/waiting transition
//   const unsub = session.onDegenerateOutput(cb)   — cb({ pattern, count, kind }) when the output
//                                          collapses into a repeated-token / incoherent loop
//   const info = await session.getDegenerateInfo() — one-shot read of the last such episode (or null)
//   const answered = await session.answerPrompt(i) — detect a live multiple-choice prompt on screen
//                                          and pick option i (0-based); resolves the chosen text,
//                                          or null when no prompt was detected

// RENDER A REAL TERMINAL WIDGET (no vendored library — OS bundles xterm.js):
// mount() wires session output → terminal display + terminal input → session stdin.
const view = window.chatoss.terminal.mount(document.getElementById('term'), session.id, { fontSize: 14 });
// view.dispose() tears it down.
```

AI AGENT CONTROL — driving a coding CLI (claude, codex, aider) from your app:

🔴 **Use `paste()` for text and `key()` for keys. NEVER `write(text + '\r')`.** This is the single most common way an orchestrator app breaks. `write` is raw bytes, so the text and the `\r` reach the CLI in ONE read() — and an Ink-based TUI (Claude Code, Codex) treats a large single read as a PASTE, which makes that `\r` a literal newline in the input box instead of Enter. The task then sits in the input box, unsubmitted, forever. `paste()` + `key('enter')` is the fix and needs no delays, no retries, and no scraping the screen to check:

```js
// Submit a task to the CLI agent — the ONLY correct pattern:
await session.paste('Fix the login bug in src/auth.ts and run the tests');
await session.key('enter');

// paste() also keeps NEWLINES literal, so a multi-line prompt arrives as ONE
// message instead of submitting itself line by line. Don't flatten your prompts.
await session.paste('Do these in order:\n1. fix the bug\n2. run tests');
await session.key('enter');

// Keys: 'enter' 'up' 'down' 'left' 'right' 'escape' 'tab' 'shift+tab'
//       'backspace' 'delete' 'home' 'end' 'pageup' 'pagedown' 'space'
//       'ctrl+c' 'ctrl+d' 'ctrl+u'
await session.key('down');            // navigate a menu
await session.key('enter');           // choose the highlighted option
await session.key('escape');          // dismiss a dialog
await session.key('ctrl+c');          // interrupt the agent

// Read what the terminal currently shows (to decide the next step):
const screen = await session.getOutput();
// React to output in real time:
session.onData(chunk => { if (chunk.includes('Done')) { /* task finished */ } });
```

Why the OS does this and not your app: `key()` is delivered as its OWN read() (ChatOSS waits for the CLI to finish rendering first), and `paste()` wraps the text in bracketed-paste markers **only when the child actually enabled that mode** — a fact that lives in the CLI's output stream, which your app never sees. Bracketing a CLI that has the mode off would type literal `[200~` into its input box, so this decision cannot be made from app code. `await session.modes()` → `{ bracketedPaste }` if you want to see what `paste()` will do. Both calls resolve after the bytes are written; `paste()` resolves `true` when it bracketed.

🔴 **"Is the agent's turn done?" — `isWaitingForInput()` has THREE states, not two.** It resolves `true` (the foreground process is the shell at its prompt, or a REPL blocked on a tty read), `false` (something is running), or the literal string **`'unsupported'`**. `'unsupported'` means *the host could not observe the state at all* — it is not "false", and it is emphatically not "the turn is done". Treat it as **unknown** and fall back to your own evidence (`onData` quiet time, a sentinel the agent prints, `getScreen()`), because reading it as "done" makes an orchestrator declare victory on a still-running agent. You get `'unsupported'` for an unknown/dead session id, and:

**Platform caveat — terminal state observation is a STUB on Windows.** The signal is read from the PTY's foreground process group via `tcgetpgrp`, which only exists on Unix. On Windows there is no equivalent, so `isWaitingForInput()` always resolves `'unsupported'` and `onStateChange` reports the unsupported state. Everything else about the terminal — spawn, write/paste/key, onData, getOutput, getScreen, kill, persistence — works on all three platforms. If your app drives a CLI agent, design the turn-completion check so it still works with no state signal at all.

**Runaway-output detection.** `session.onDegenerateOutput(cb)` fires when the session's output collapses into a repeated-token or incoherent-gibberish loop (the same detector ChatOSS runs on its own chat streams, pointed at the PTY); `getDegenerateInfo()` reads the last episode on demand. Kill the session when it fires rather than letting a stuck agent burn the user's quota.

**Answering a menu prompt without screen-scraping.** `session.answerPrompt(optionIndex)` detects a multiple-choice prompt on the current screen and selects option `optionIndex` (0-based), resolving the option text it chose — or `null` if no prompt was on screen, which is your cue that the situation is something else and needs `getScreen()`.

Full machine access — request it only if the app genuinely needs to run programs. "Allow always" is scoped to the command's first word (e.g. approving `git` never covers `rm`). Use `spawn` + `mount` for live interactive CLIs (codex, claude, a dev server); use `exec` for one-shot commands where you just want the output. Use `getOutput()` to read the current terminal state at any time (for AI agents that need to see what's on screen).

**Declare your command prefixes to skip the prompts** — list the first tokens you'll run in `"terminalCommandPrefixes"` (e.g. `["git", "ls", "grep", "npm"]`). They are disclosed and approved at install, then run WITHOUT per-command prompts. Undeclared prefixes still prompt. **In headless/background runs, ONLY declared prefixes may run** (there's no window to prompt in — undeclared commands are auto-denied with a clear error). An unanswered permission prompt settles as denied after 5 minutes — a tool call never hangs forever.

**Late approvals — a spawn you already gave up on.** The prompt's 5-minute answer window is independent of your own await budget: if your `await terminal.spawn(...)/spawnCodingAgent(...)` times out while the prompt is still up, your `null` means YOU gave up, not that the spawn was denied — the prompt is not cancelled, and a later approval still creates the session. Subscribe BEFORE spawning and recover it:

```js
window.chatoss.data.onChanged('terminal.sessionCreated', (ev) => {
  // { approvalId, sessionId, appId, command, cwd, createdAt } — ephemeral,
  // this window only (same channel as engine.progress). approvalId matches
  // the id approvals.pending() exposed for the prompt you saw.
  if (ev && ev.approvalId === myApprovalId) {
    window.chatoss.terminal.reattachSession(ev.sessionId);
  }
});
```

Keep the `approvalId` from `approvals.pending()` while you wait. If you never subscribed, polling recovers it anyway: `listSessions()` / `attachSession()` / `reattachSession()` list the late-created session for your app from the moment it exists. A caller still awaiting its spawn promise gets the session id as before and can ignore the duplicate event; if the approval itself times out, nothing is created and nothing is published.

**Sessions survive quit for background apps** — if your app declares `"background"`, its spawned sessions are NOT killed when ChatOSS quits: they keep running and your app re-attaches on next launch via `listSessions()`/`reattachSession()`.

**Launching a coding-agent CLI — use `spawnCodingAgent`, not `spawn`.** A bare `spawn('claude')` starts the CLI in its default manual-permission mode, so it stalls on the first edit-approval prompt with nobody to answer it. `spawnCodingAgent` builds the right flags for you:

```js
const session = await window.chatoss.terminal.spawnCodingAgent('claude', {
  permissionMode: 'acceptEdits',   // or 'bypassPermissions'
  model: modelId,                  // optional
  cwd: folder, cols: 120, rows: 40,
  extraArgs: [],                   // optional extra CLI args
});
// → the SAME session handle shape as spawn() (paste/key/write/onData/getScreen/…), or null if denied.
```

Agents: `'claude'` and `'codex'`. It rides the same `terminal` capability and per-prefix approval as `spawn`.

**While a terminal call is waiting on its approval prompt** — `window.chatoss.approvals.pending()` lists THIS app's own unanswered permission prompts (see the Approvals section below), so you can show "waiting for your approval" instead of appearing to hang.

PERSISTENT SESSIONS — sessions survive window close AND a full app restart (metadata + output history are persisted by the OS):

```js
const sessions = await window.chatoss.terminal.listSessions();
// → [{ id, command, cwd, appId, createdAt, lastActiveAt, live }] newest first
//    live: true = the process is still running in this app run

const attached = await window.chatoss.terminal.attachSession(id);
// → { id, command, cwd, createdAt, lastActiveAt, live, output }
//    output = the full persisted output history (base64 — decode with atob())

const handle = await window.chatoss.terminal.reattachSession(id);
// → a LIVE session handle (same shape as spawn(): onData/onExit/write/paste/key/resize/kill)
//    only for sessions whose process is still alive (live: true)

await window.chatoss.terminal.killSession(id);
// → kills the live process (if any) + deletes the persisted metadata/output
```

Use `listSessions()` to show the user what ran before (even after a restart), `attachSession(id)` to read a session's full history, and `reattachSession(id)` to take control of a still-running session. `killSession(id)` is the explicit cleanup — the OS no longer kills sessions when the window closes.

### Approvals — show "waiting for your approval" instead of hanging (no capability, never prompts)

Some calls (`terminal.exec`/`spawn` on an undeclared prefix, `http.request` to an undeclared host, `notifications.send` the first time, …) park behind a permission modal the user has not answered yet. From inside the app that looks identical to a hang. `approvals` is a read-only window onto **your own** pending prompts — no capability, no prompt of its own, works headless:

```js
const waiting = await window.chatoss.approvals.pending();
// → [{ id, appId, appName, capability, scope?, what, why, since }]  (only THIS app's prompts)
const unsub = window.chatoss.approvals.onPending(() => refreshWaitingBanner());
```

An unanswered prompt settles as **denied** after 5 minutes, so a call never hangs forever — but 5 minutes of silent nothing is still a broken-looking app. Render a banner while `pending()` is non-empty.

🔴 **Your own timeout does not cancel a prompt.** If your await on a gated call (terminal.spawn is the sharp case) gives up while the prompt is still open, the user can still approve it — and for terminal spawns the session then runs WITHOUT your first await ever reporting it. The host publishes `{ approvalId, sessionId, appId, command, cwd, createdAt }` to the shared data key `terminal.sessionCreated` (approvalId = the `pending()` id) so you can reattach; see the Terminal section above.

### Kanban boards (capability: "boards"; no prompt — declare only)

Read and write the user's real Kanban boards — the SAME store the built-in Kanban section uses, so your changes show up live there and its changes show up in your app. Declare-only, works headless. **You have full parity with the built-in, including creating and deleting boards** — an app never needs to send the user off to the built-in Kanban to do something.

```js
// app.json: "capabilities": ["boards"]
const boards = await window.chatoss.boards.list();            // → [{ id, name }]
const board  = await window.chatoss.boards.get(boards[0].id);
// → { id, name, columns: [{ id, name }], cards: [{ id, title, description?, columnId, done?,
//      subtasks?, labels?, comments?, attachments? }], labels? }

const boardId = await window.chatoss.boards.createBoard('Launch plan');  // → new board id
await window.chatoss.boards.deleteBoard(boardId);                        // board + everything in it
```

The full method list:

- **Boards:** `list()` → `[{ id, name }]` · `get(boardId)` → the whole board · `createBoard(name?, folderId?)` → id · `deleteBoard(boardId)`.
- **Cards:** `createCard(boardId, { title, description?, columnId })` → id · `updateCard(boardId, cardId, { title?, description?, done? })` (`done` also moves it to the board's Done column) · `moveCard(boardId, cardId, toColumnId, toIndex?)` (appends unless `toIndex` is given) · `deleteCard(boardId, cardId)`.
- **Columns:** `createColumn(boardId, { name })` → id · `renameColumn(boardId, columnId, name)` · `deleteColumn(boardId, columnId)` (and every card in it) · `reorderColumns(boardId, orderedColumnIds)` (must list EVERY column id).
- **Subtasks:** `addSubtask(boardId, cardId, title)` → id · `updateSubtask(boardId, cardId, subtaskId, { title?, completed? })` · `deleteSubtask(boardId, cardId, subtaskId)`.
- **Labels:** `createLabel(boardId, name)` → id · `renameLabel(boardId, labelId, name)` · `deleteLabel(boardId, labelId)` · `addLabelOption(boardId, labelId, name, color?)` → id · `updateLabelOption(boardId, labelId, optionId, { name?, color? })` · `deleteLabelOption(boardId, labelId, optionId)` · `setCardLabel(boardId, cardId, labelId, optionId)` · `clearCardLabel(boardId, cardId, labelId)`.
- **Comments:** `addComment(boardId, cardId, text, author?)` → id (author defaults to `'agent'`) · `updateComment(boardId, cardId, commentId, text)` · `deleteComment(boardId, cardId, commentId)`.
- **Attachments:** `addAttachment(boardId, cardId, { name, dataUrl })` → id · `removeAttachment(boardId, cardId, attachmentId)`.

🔴 If your app has an AI agent, give it a tool for **every** one of these that its UI exposes — including `createBoard`/`deleteBoard`. A board app whose agent can move cards but not create a board is the exact defect this list exists to prevent.

### Drive — ChatOSS-managed storage (capability: "drive"; no prompt — declare only)

Your app's own real directory tree, owned by the OS: no picker, no prompt, and the user can browse it in the built-in **Files** app under your app's name. This is where app OUTPUT belongs (see the `files` vs `drive` note above). Declare-only, exactly like `sqlite` — writing into your own container is no more sensitive than writing to your own database — and reads/writes work headless, so a background task can generate a report into it.

```js
// app.json: "capabilities": ["drive"]
await window.chatoss.drive.mkdir('reports/2026');
const { path, size, sha256 } = await window.chatoss.drive.writeFile(
  'reports/2026/august.md', '# August\n\nAll good.', { mime: 'text/markdown' });
const text    = await window.chatoss.drive.readFile('reports/2026/august.md');
const b64     = await window.chatoss.drive.readFile('logo.png', { binary: true }); // base64
const entries = await window.chatoss.drive.list('reports');   // '' or omitted = container root
const entry   = await window.chatoss.drive.stat('reports/2026/august.md'); // null if absent
await window.chatoss.drive.move('reports/2026/august.md', 'archive/august.md');
await window.chatoss.drive.copy('archive/august.md', 'archive/august-copy.md');
await window.chatoss.drive.remove('archive/august-copy.md');            // soft → .trash/
await window.chatoss.drive.remove('scratch.tmp', { permanent: true });  // really gone
const { bytes, files, quotaBytes } = await window.chatoss.drive.usage();
const unsub = window.chatoss.drive.onChanged(() => refreshFileList());
```

- A **path is a KEY, not an OS path**: relative, forward-slash, no `..`, no absolute prefix, no empty segments. Write `'reports/2026/august.md'` on every platform — never `'reports\\2026'` and never a joined OS path.
- `writeFile(path, contents, opts?)` takes contents as a **plain string** (base64 when `{ binary: true }`) — unlike `files.writeFile`, it does NOT accept an ArrayBuffer/Uint8Array/Blob. It creates parent directories, and the `sha256` it returns is the change-detection key cloud backup will use.
- `list()`/`stat()` entries are `{ name, path, kind: 'file'|'dir', size, mime?, createdAt, updatedAt, backupState }` where `backupState` is `'local'|'queued'|'syncing'|'synced'|'failed'|'excluded'`.
- `remove()` is a **soft delete** by default (into `.trash/`, restorable from the Drive app); pass `{ permanent: true }` only when the user explicitly asked for that.
- **No size limits.** Drive is storage on the user's OWN DISK, so there is no per-file cap, no per-container
  quota and no per-directory cap. The only bounds are path safety (path ≤ 1024 chars, depth ≤ 32, no "..")
  and the disk itself; `usage()` returns `quotaBytes: null`.
- **Cloud backup is the USER's, not yours.** The user can point Drive at their own S3-compatible bucket
  (AWS S3, Cloudflare R2, Backblaze B2, Supabase Storage, Google Cloud Storage, DigitalOcean Spaces,
  Wasabi, MinIO) in Drive → Backup, and every file an app writes is uploaded there. An app does NOT
  configure or trigger backup and has no API for it — just write to Drive and it is covered. Each entry's
  `backupState` tells you where it stands (`local` → `queued` → `synced`, or `failed`/`excluded`).

**Crossing to the user's real disk** — `exportTo`/`importFrom` additionally require `fileAccess`, and are refused headless:

```js
// app.json: "capabilities": ["drive", "fileAccess"]
const dest = await window.chatoss.files.saveDialog({ defaultPath: 'august.md' });
if (dest) await window.chatoss.drive.exportTo('reports/2026/august.md', dest);   // save-as

const folder = await window.chatoss.files.pickFolder();
if (folder) await window.chatoss.drive.importFrom(folder + '/notes.txt', 'imported/notes.txt');
```

`importFrom`'s source must be inside a folder this app already picked — it is `files`' consent rule, not a second one.

**The shared space** — the same `drive.*` calls with a path under `_shared/` reach the one area other apps' containers can see. That is a different trust decision, so it needs the separate **`driveShared`** capability, which is **prompt-gated** (the only prompting drive path). `onChanged` watches your own container only, never `_shared`. Declare `driveShared` only when cross-app hand-off is genuinely the feature.

### App-private AI tools (no capability, never prompts)

`scopedTools` are tools only YOUR app's own `chat.runTurn` calls can see. They never enter the global registry other apps' agents read, so they need no approval and no `toolsStoreRequests` entry. Note them in the manifest's `scopedTools` array as documentation.

```js
window.chatoss.scopedTools.register(toolDef);          // synchronous, no prompt
const mine = window.chatoss.scopedTools.list();        // this app's scoped tools
```

Passing `tools:` directly to `chat.runTurn` is the simpler path and usually what you want; register a scoped tool when you need the same tool available to every turn without threading it through each call.

### Platform metadata + API discovery — platform.info / platform.apis (no capability, never prompts)

```js
const info = await window.chatoss.platform.info();
// → { name, version, os: 'macos'|'windows'|'linux', arch?, osVersion? }
const namespaces = await window.chatoss.platform.apis();
// → the whole window.chatoss surface as plain data: [{ id, title, purpose, capability,
//    methods: [{ name, signature, description, headless, prompts, mutating, capability? }] }]
```

🔴 `platform.info().os` is the **real host OS**, resolved host-side. Never sniff `navigator.userAgent` or `navigator.platform` from inside the app frame to decide how to quote a shell command or build a path — the sandboxed frame's UA does not reliably tell you the host, and getting it wrong is how a "works on my Mac" app breaks on Windows.

`platform.apis()` is the machine-readable API registry, kept in lockstep with the real bridge by a test. If you are an agent authoring an app and you are unsure whether a method exists, query this instead of trusting a doc that might be stale.

### Shared data across apps + the ephemeral channel (usually skip this)

```js
const v  = await window.chatoss.data.get('some.key');          // any app may read any key
const ok = await window.chatoss.data.set('myapp.public', v);   // needs dataStoreRequests entry + user approval
window.chatoss.data.onChanged('some.key', (v) => render(v));   // fires until the app closes
const ok2 = await window.chatoss.data.requestSet('other.key', v); // always routes through approval
```

`set()` is the **durable** path: it writes to SQLite and broadcasts to every ChatOSS window.

```js
await window.chatoss.data.publish('myapp.stream', { kind: 'token', text: chunk });
```

`publish(key, value)` is its **EPHEMERAL** sibling: it notifies subscribers **in this window** and updates the in-memory cache, but performs **no SQLite write and no cross-window broadcast**. Use it for high-frequency streams — agent tokens, progress ticks, cursor positions — where a `set()` per event would hammer the database with rows nobody will ever read again. Nothing published this way survives a store reload, and another window will not see it, so never publish state you need later: publish the stream, `set()` the result.

### Publishing a tool to ChatOSS's own agents (advanced, usually skip)

```js
await window.chatoss.tools.register(toolDef, async (args) => 'result');
// Needs a toolsStoreRequests entry + user approval. The handler only answers
// while YOUR app is open; agents calling it when the app is closed get an
// honest "app isn't open" error.
```

### THE APP-TO-APP API — export functions other apps call (the flagship)

Every app can EXPORT functions other apps call, and CALL other apps' APIs — with consent at install and **zero runtime prompts**. This is how apps compose like OS services (the Kanban app is the flagship example).

**Exporting** — declare the names in `"apiExports"`, register the implementations at load:

```json
// app.json
"apiExports": [
  { "name": "getNotes", "description": "List the user's notes (newest first).",
    "params": { "type": "object", "properties": {} }, "why": "Other apps read the user's notes." }
]
```

```js
window.chatoss.apps.registerApi('getNotes', async (args) => {
  // args = the caller's args object. Return any structured-clone-safe value
  // (data in, data out — no callbacks). Throw to reject the call.
  return [{ id: 'n1', text: 'hello' }];
});
```

**Calling** — declare the target in `"apiRequests"` (approved at install), then call:

```json
// app.json
"apiRequests": [
  { "appId": "com.example.notesapi", "methods": ["getNotes", "addNote"], "why": "Show the user's notes." }
]
```

```js
const notes = await window.chatoss.apps.call('com.example.notesapi', 'getNotes');
await window.chatoss.apps.call('com.example.notesapi', 'addNote', { text: 'hi' });
```

The target app answers **even when it's CLOSED** — the OS boots it headless (offscreen sandboxed frame), waits for its handlers, dispatches, and returns (30s call timeout; headless sessions idle-timeout after 5 minutes). Your exported APIs ALSO become global tools named `<yourAppId>.<name>` that any AI agent can call, headless too. The install screen discloses both lists. Without an `apiRequests` entry for an app id, `apps.call` to it is refused; without an `apiExports` entry, `registerApi` for a name is refused.

**Discovering what's out there** — `apps.listApis()` needs no capability and no declaration at all (it is read-only metadata):

```js
const listings = await window.chatoss.apps.listApis();
// → every app-to-app surface the OS currently has (built-in services + installed apps),
//   each with its exports, its requests, and whether it has a live session right now.
```

You still need an `apiRequests` entry to CALL anything you find — discovery and permission are separate. A developer tool that must call whatever it discovers is exactly what the `"appId": "*"` wildcard is for.

### The Agent Engine service (com.chatoss.engine) — the platform coding-agent engine

ChatOSS ships a **built-in service app** that hosts the ONE battle-tested coding-agent engine: the multi-round tool loop with its FIVE modes (`agent`, `auto`, `plan`, `ask`, `orchestrate`), the tsc verify gate, compaction, the read cache, and the edit-retry circuit breaker. (`auto` is Agent's full toolset run autonomously — shell commands are approved automatically and it never pauses to ask; `plan` and `ask` are read-only — both get the full investigation toolset (files, search, boards, web), and `ask` additionally runs READ-ONLY shell commands, with mutating commands blocked and a one-click switch to Agent offered; `orchestrate` delegates to sub-agents.) Code, Create, Term Coder, and any coding app plug into it through the SAME app-to-app API instead of each reimplementing ~5-8k lines of agent-loop code. The service is always available (no install) and answers headless.

**Calling the engine** — declare the request in `app.json` (like any app-to-app call):

```json
// app.json
"apiRequests": [
  { "appId": "com.chatoss.engine", "methods": ["runTurn", "status", "cancel", "answer", "buildSystemPrompt", "shouldCompact", "compact"], "why": "Run the platform coding-agent engine." }
]
```

```js
// Run one full agent turn. runTurn is LONG-RUNNING — pass a long timeoutMs
// (the default 30s call timeout would cut it off):
const result = await window.chatoss.apps.call('com.chatoss.engine', 'runTurn', {
  conversationId: 'my-conv-1',
  messages: [{ role: 'user', content: 'Add a dark mode toggle.' }],
  tools: myToolDefinitions,          // OpenAI-style function defs
  mode: 'agent',                     // one of FIVE: agent | auto | plan | ask | orchestrate
  model: modelId,                    // optional (OS default)
  projectRoot: '/path/to/project',   // optional
  projectRoots: ['/path/to/project'],
  verify: true,                      // tsc --noEmit after file changes
  executor: 'default',               // 'default' = the service executes tools;
                                     // 'caller' = YOUR app executes them (below)
}, { timeoutMs: 30 * 60_000 });
// → { messages, finalMessage, aborted, rounds }
```

**Streaming progress** — the app-to-app API is data-in/data-out (no callbacks), so the service publishes live progress events to the shared data key `engine.progress` while a run is in flight. Subscribe with `data.onChanged` and filter by `conversationId`:

```js
window.chatoss.data.onChanged('engine.progress', (ev) => {
  if (!ev || ev.conversationId !== 'my-conv-1') return;
  if (ev.kind === 'token') output.textContent += ev.text;        // streamed tokens
  if (ev.kind === 'thinking') thinkingEl.textContent += ev.text;
  if (ev.kind === 'toolCall') showToolBlock(ev.name, ev.args);
  if (ev.kind === 'toolResult') fillToolResult(ev.name, ev.result);
  if (ev.kind === 'plan') renderPlan(ev.steps);
  if (ev.kind === 'done') setStatus(ev.aborted ? 'Stopped.' : 'Done.');
});
```

Event kinds: `token`, `thinking`, `toolCall`, `toolResult`, `status`, `plan`, `queueTask`, `assistantMessage`, `ask`, `modeRequest`, `toolRequest`, `done`. 🔴 **Every** event carries `conversationId` — including the interactive ones (`ask` / `modeRequest` / `toolRequest`), which used to arrive without it, so an app running two conversations at once could answer the wrong one's question. Always filter on it, on every kind. The high-frequency kinds (`token`, `thinking`, `toolCall`, `toolResult`) ride `data.publish` — ephemeral, this-window-only, no SQLite row per token — so subscribe before you start the run and don't expect to replay them later.

**Interactive hooks** — when the engine needs the user (ask_question, request_agent_mode) or the caller (tool execution in caller mode, spawn_subagent delegation), it publishes an event with an `id` + `callId` + `conversationId` and waits; your app answers through the `answer` API:

```js
// ev.kind === 'ask' → show the question, then:
await window.chatoss.apps.call('com.chatoss.engine', 'answer', { callId: ev.callId, id: ev.id, value: 'Yes' });
// ev.kind === 'toolRequest' (executor: 'caller') → run it with YOUR executor:
const result = await myToolExecutor(ev.name, ev.args, ev.turnCtx);
await window.chatoss.apps.call('com.chatoss.engine', 'answer', { callId: ev.callId, id: ev.id, value: result });
```

**Executor modes** — `executor: 'default'` lets the SERVICE execute the tools on its own bridge (it is a built-in, so it carries the built-in trust level: terminal runs without per-command prompts, and its file access is seeded with YOUR app's picked roots — the folders your user already consented to). `executor: 'caller'` keeps the engine's hook design: the service publishes each tool call to the progress channel and YOUR app executes it with its own executor (e.g. to supervise its own live terminal pane) and answers via `answer`. The raw primitives (`chat.runTurn`, `terminal`, `files`) remain available as the escape hatch for custom orchestrators.

**status / cancel** — `status({ conversationId })` → `{ running, callId, startedAt, round } | null`; `cancel({ conversationId })` aborts the in-flight run (it resolves with `aborted: true`). `buildSystemPrompt({ mode, projectRoot, … })`, `shouldCompact({ messages, compaction })`, and `compact({ messages, compaction, model })` expose the engine's prompt/compaction logic so callers stay in lockstep with the engine.

**Pass `projectRoot` (and `hostOs`) — the engine builds a project-context block from them.** The system prompt the service builds includes the project block (Root, host OS, the folders it may touch) the same way the built-in Code agent's does. Without `projectRoot` the model is working blind: it does not know where it is, so it writes absolute paths, asks the user which directory to use, and picks the wrong shell quoting. A sub-agent the engine spawns inherits the same context, so get it right on the parent call.

### Subprocesses with pipes (capability: "terminal"; for MCP stdio servers and protocols)

`terminal.spawn` attaches a PTY — right for interactive CLIs, wrong for line-delimited protocols (a PTY's line discipline corrupts them). For MCP stdio servers and any pipe-based subprocess, use `process`:

```js
const session = await window.chatoss.process.spawn('npx', {
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/path'],
  cwd: null,
  env: { EXTRA: '1' },
}); // null = user denied. Same per-prefix approval as terminal.
// session.id, await session.write(data), await session.kill(),
// session.onData(cb), session.onStderr(cb), session.onExit(cb)
```

### Keychain secrets (capability: "secrets"; no prompt — declare only)

Store server keys and tokens in the OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service) — never in localStorage or SQLite, never readable by other apps:

```js
await window.chatoss.secrets.set('stripe', 'sk_live_…');
const key = await window.chatoss.secrets.get('stripe');   // rejects if unset
await window.chatoss.secrets.delete('stripe');
const names = await window.chatoss.secrets.list();        // names only, never values
```

### MCP client (capability: "mcp"; prompts per server host / command prefix)

Be a full MCP client on the OS substrate — the same transports the built-in Connect app uses:

```js
// Streamable HTTP server:
const resp = await window.chatoss.mcp.httpRequest({
  url: 'https://mcp.example.com/mcp',
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {...} }),
  headers: { 'Content-Type': 'application/json' },
  timeoutMs: 30000,
}); // → { status, contentType, body, sessionId } — the server host prompts per request

// stdio server (a local process):
const session = await window.chatoss.mcp.stdioStart({ command: 'npx', args: ['-y', '…'], env: {} });
const line = await window.chatoss.mcp.stdioRequest(session, JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), '2', 30000);
await window.chatoss.mcp.stdioNotify(session, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
await window.chatoss.mcp.stdioStop(session);
```

### Publishing apps from an app (capability: "appInstall"; prompts on first use)

The Create-app loop, available to any app: package a folder it picked into a .aip and install it into the OS (the installed app's own permission disclosure still shows):

```js
const { install, fileName } = await window.chatoss.appInstall.install(folderPath);
// folderPath = an absolute path inside a folder from files.pickFolder(); its
// CONTENTS become the app root. Prompt-gated escalation — never auto-allowed
// even for a Trusted app.
```

### Live app previews (capability: "preview"; prompts on first use)

Mount a sandboxed live preview of an app folder — with the REAL `window.chatoss` bridge injected — in a host-owned overlay over your app's section:

```js
const { id } = await window.chatoss.preview.launch(folderPath); // folderPath inside a picked folder
await window.chatoss.preview.reload(id);   // re-read the folder after edits
await window.chatoss.preview.close(id);
```

### Proposing follow-up tasks (capability: "proposeTask"; no prompt — declare only)

Suggest a follow-up task as a dismissible Start chip in the host UI (top-right corner). The chip is INERT until the user clicks Start (which spins off a fresh Code chat seeded with the description):

```js
const { id } = await window.chatoss.proposeTask.propose({
  title: 'Add dark mode',
  description: 'Add a dark theme to the settings page.',
  projectRoot: folder,   // optional: the project the task should run in
  boardId: '…',          // optional: a Kanban board to attach
  worktree: true,        // optional: run in its own git worktree (default true)
});
```

### Misc

```js
const manifest = await window.chatoss.manifest.get();   // your own app.json
```

`fetch()` to the internet works like on any web page (subject to the remote server's CORS).

## Permissions model (what the user experiences)

- chatApi, fileDrop, webSearch, documents, sqlite, secrets, proposeTask, boards, drive: declared in the manifest, never prompt.
- driveShared: prompt-gated — it is the one drive path other apps' containers can see. Plain `drive` (your own container) never prompts.
- No capability at all, so nothing to declare and nothing to prompt: `manifest.get`, `scopedData.*`, `scopedTools.*`, `data.get`/`onChanged`/`publish`, `approvals.*`, `platform.info`/`platform.apis`, `apps.listApis`, `background.isHeadlessRun`, `documents.base64ToBytes`.
- fileAccess: one prompt on first use (Allow once / always / Deny). Denied dialogs return null.
- terminal: prompts per command with the exact command shown; "always" is per program. Declared terminalCommandPrefixes are approved at install and skip the prompts; in headless/background runs only declared prefixes may run. A prompt survives your own spawn-await timing out: a later approval still runs the command and publishes terminal.sessionCreated for recovery (subscribe before spawning, or poll listSessions()).
- webview: no per-call prompt — the manifest's webviewAllowlist IS the boundary (shown to the user and OS-enforced), so windows can only reach the domains you declared.
- notifications: prompts once on first send (Allow once / always / Deny); send() returns false if denied.
- clipboardWrite / clipboardRead: NO prompt — a low-friction convenience. The user can still turn either off any time in the app's Permissions panel; a disabled call rejects.
- hostHttp: NO prompt for listed hosts — the httpAllowlist IS the boundary (enforced in Rust + an SSRF guard). An UNDECLARED host prompts per request (scoped to the host; "Allow always" persists). Private/loopback/metadata addresses are always refused.
- globalShortcut: prompts once per accelerator on first registration (a system-wide hotkey); register() returns false if denied.
- openExternal: NO prompt — restricted to the manifest's openExternalAllowlist (http/https) + mailto, enforced in Rust; file:// and off-list hosts are refused.
- background: disclosed on the install screen (with each task's schedule) and prompts once on first fire (Allow once / always / Deny; a Trusted app skips it). Bounded to the manifest's backgroundTasks; switching it off in Permissions stops every task immediately. Background-capable apps' terminal sessions also survive ChatOSS quitting.
- appInstall / preview / mcp: prompt-gated escalations — first use prompts (appInstall never auto-allows even for a Trusted app); mcp prompts per server host / command prefix.
- apps.call / apps.registerApi: NO runtime prompts — the manifest's apiRequests/apiExports are disclosed and approved at install; the OS enforces both directions.
- data.set / tools.register: prompt quoting your manifest's "what"/"why".
- Updates: a new .aip with the same id that adds ANY new capability shows the user the exact additions; write complete manifests from v1.
- ANY capability can be switched off by the user at any time from the app's Permissions panel (the ⋯ menu → Settings on its row in the Apps manager) — even ones that never prompt. Treat every window.chatoss call as fallible.
- An unanswered permission prompt settles as denied after 5 minutes — a tool call never hangs forever.

Handle null/false results and rejections from every gated call gracefully — denial (or a turned-off capability) must not break the app.

## Design guidance — use the ChatOSS app pattern

For most project- or collection-based apps, copy ChatOSS Kanban's three-column architecture:

1. **Left — project library:** create/select/rename/delete projects or durable workspaces.
2. **Middle — project AI chat:** show a model picker from `chat.listModels()`, keep chat history per project, include a fresh selected-project snapshot in the system message, and expose complete CRUD tools for everything the user can change.
3. **Right — app canvas:** the product-specific surface (sticky notes, board, editor, diagram, preview, etc.). Usually this is the only column that should fundamentally change between apps.

Small single-purpose utilities may omit the pattern, but it is the default. The canonical Docs example is Sticky Notes and should be used as the visual/architectural reference.

- **Style from the platform classes and tokens** (`.app-shell`, `.btn`, `.list-row`, `var(--surface-2)`, …) — see the Styling section near the top. Never redefine `:root` colour tokens and never use `@media (prefers-color-scheme: dark)`; the host stamps `data-theme` and both themes come for free.
- **Never use `confirm()`/`alert()`/`prompt()`** — the sandbox has no `allow-modals`, so `confirm()` silently returns `false` and every destructive action guarded by it becomes a no-op. Build the confirmation with `.overlay`/`.modal`.
- Stream AI output with onToken — never a spinner followed by a wall of text.
- Disable buttons while work is running; show a short status line.
- The app must work by hand too — treat AI as an alternative interface to the same data.
- Agent tools must be complete and orthogonal: create/read/update/delete plus any domain actions the UI supports. Return truthful result strings and never let the model claim an unconfirmed mutation.

## Checklist before delivering

1. app.json is valid JSON with id (lowercase reverse-DNS), name, version, description; capabilities has ONLY what the code uses.
2. Entry HTML references your files with plain relative paths.
3. Every window.chatoss call is awaited; every gated call handles null/denied.
4. State persists via scopedData and restores on launch.
5. If the app has chat, the user can choose a model from `chat.listModels()` and the choice persists per project/workspace.
6. Project/collection apps follow library → CRUD agent → product canvas, and the agent can perform every mutation available by hand.
7. The UI is built from the platform classes + tokens; no `:root` colour overrides, no `prefers-color-scheme` rule. Check it in BOTH ChatOSS Light and Dark.
8. No `confirm()`/`alert()`/`prompt()`/`window.print()` anywhere — they do not work in the sandbox. Destructive actions use an in-frame `.modal`.
9. An icon file exists and is named in "icon".
10. If the app exports documents (PDF/Word/Excel/PowerPoint/image): use the OS `documents` API (no vendored library, no `window.print()` — it's blocked in the sandbox). Declare "documents" (+ "fileAccess" if you use `documents.save()`). For PDF/DOCX with any formatting (bold, italic, headings, lists), pass the content as `content.blocks` (structured blocks + styled runs) — NOT plain `paragraphs`/`text`, which strips formatting. See the Documents section above.
11. If the app produces files of its own (reports, exports, transcripts), they go in `drive` — not buried in a database row and not begging the user for a folder. The user's own project files stay in `files`.
12. If you are NOT in ChatOSS Code: give zip instructions — files at zip root → rename to .aip → drop on the Apps app.
13. If you ARE in ChatOSS Code: ask the user whether they'd like to publish the app now, and call `publish_app` with the app folder path if they agree. (See the note at the top of this guide.)
