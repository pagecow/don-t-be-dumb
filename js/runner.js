/*
 * Don't Be Dumb — sandboxed code runners.
 *
 * Runs the user's code against JSON test cases with a hard timeout, and runs
 * HTML/CSS assertion checks against a rendered document. Three engines, chosen
 * by feature detection at runtime (all local — no shell, no network):
 *
 *   1. "worker"   — the code runs in a Web Worker created from a Blob URL.
 *                   Best: hung code is TERMINATED for real (hard timeout).
 *   2. "iframe"   — a hidden sandboxed srcdoc iframe posts results back.
 *   3. "function" — last resort: a Function wrapper in this frame (no hard kill).
 *
 * The same user-facing harness is used everywhere. Exposes window.DBD.runner.
 */
(function () {
  'use strict';

  const DBD = (window.DBD = window.DBD || {});

  /* ------------------------------------------------------------------ *
   *  Harness source (shared by every engine — concatenated around the   *
   *  user's code so `const`/`let`/function declarations are visible).   *
   * ------------------------------------------------------------------ */

  const HELPERS = `
var __dbd_logs = [];
(function () {
  function fmt1(v) {
    try {
      if (typeof v === 'string') return v;
      if (typeof v === 'undefined') return 'undefined';
      if (typeof v === 'function') return '[function ' + (v.name || 'anonymous') + ']';
      if (typeof v === 'bigint') return String(v) + 'n';
      if (v === null) return 'null';
      if (typeof v === 'object') {
        var seen = new WeakSet();
        var s = JSON.stringify(v, function (k, val) {
          if (typeof val === 'object' && val !== null) {
            if (seen.has(val)) return '[circular]';
            seen.add(val);
          }
          if (typeof val === 'function') return '[function]';
          return val;
        });
        return s === undefined ? String(v) : s;
      }
      return String(v);
    } catch (e) { try { return String(v); } catch (e2) { return '[unprintable]'; } }
  }
  function logTo() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(fmt1(arguments[i]));
    __dbd_logs.push(parts.join(' '));
    if (__dbd_logs.length > 400) __dbd_logs.shift();
  }
  try {
    console.log = logTo; console.warn = logTo; console.error = logTo;
    console.info = logTo; console.debug = logTo;
  } catch (e) {}
})();

function __dbd_eq(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number' && a !== a && b !== b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  var aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  var ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (var i = 0; i < ak.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(b, ak[i])) return false;
    if (!__dbd_eq(a[ak[i]], b[ak[i]])) return false;
  }
  return true;
}

function __dbd_fmt(v) {
  try {
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'function') return '[function ' + (v.name || 'anonymous') + ']';
    if (typeof v === 'undefined') return 'undefined';
    if (typeof v === 'bigint') return String(v) + 'n';
    var seen = new WeakSet();
    var s = JSON.stringify(v, function (k, val) {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[circular]';
        seen.add(val);
      }
      if (typeof val === 'function') return '[function]';
      return val;
    });
    return s === undefined ? String(v) : s;
  } catch (e) { return String(v); }
}

function __dbd_safe(v, depth) {
  depth = depth || 0;
  try {
    if (v === null) return null;
    var t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return v;
    if (t === 'undefined') return undefined;
    if (t === 'bigint') return String(v) + 'n';
    if (t === 'symbol') return String(v);
    if (t === 'function') return '[function ' + (v.name || 'anonymous') + ']';
    if (depth > 6) return '[deep]';
    if (Array.isArray(v)) {
      var out = [];
      for (var i = 0; i < Math.min(v.length, 200); i++) out.push(__dbd_safe(v[i], depth + 1));
      return out;
    }
    var o = {};
    var ks = Object.keys(v).slice(0, 100);
    for (var j = 0; j < ks.length; j++) o[ks[j]] = __dbd_safe(v[ks[j]], depth + 1);
    return o;
  } catch (e) { return '[unserializable]'; }
}
`;

  function runnerBody(testsJson, fnName, perTestMs) {
    return `
var __dbd_tests = ${testsJson};
var __dbd_fnName = ${JSON.stringify(fnName)};
var __dbd_per = ${perTestMs};

function __dbd_sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

function __dbd_runOne(test) {
  var t0 = Date.now();
  var fn = null;
  try {
    if (typeof ${fnName} === 'function') fn = ${fnName};
  } catch (e) { fn = null; }
  if (typeof fn !== 'function') {
    return Promise.resolve({
      name: test.name, passed: false,
      error: 'No function named "${fnName}" is defined. Keep the exact name from the task.',
      expected: __dbd_safe(test.expected)
    });
  }
  return Promise.resolve()
    .then(function () { return fn.apply(null, test.args || []); })
    .then(function (actual) {
      var ok = __dbd_eq(actual, test.expected);
      return {
        name: test.name, passed: ok,
        expected: __dbd_safe(test.expected),
        actual: ok ? undefined : __dbd_safe(actual),
        ms: Date.now() - t0
      };
    })
    .catch(function (err) {
      var msg = (err && err.message) ? String(err.message) : String(err);
      return { name: test.name, passed: false, error: msg, expected: __dbd_safe(test.expected), ms: Date.now() - t0 };
    });
}

function __dbd_runAll() {
  var results = [];
  var i = 0;
  function next() {
    if (i >= __dbd_tests.length) return Promise.resolve(results);
    var t = __dbd_tests[i++];
    var p;
    if (!__dbd_per) {
      p = __dbd_runOne(t);
    } else {
      p = Promise.race([
        __dbd_runOne(t),
        __dbd_sleep(__dbd_per).then(function () {
          return { name: t.name, passed: false, timeout: true, error: 'timed out after ' + __dbd_per + ' ms — is it waiting on something that never resolves?', expected: __dbd_safe(t.expected) };
        })
      ]);
    }
    return p.then(function (r) { results.push(r); return next(); });
  }
  return next();
}
`;
  }

  function splitGuard(src) {
    // keep "</script" from terminating an enclosing srcdoc <script> block
    return String(src).split('</script').join('<\\/script');
  }

  /* ------------------------------------------------------------------ *
   *  Engines                                                            *
   * ------------------------------------------------------------------ */

  function buildWorkerSource(code, fnName, tests, perTestMs) {
    const prelude = HELPERS + '\n;\n' +
      "var __dbd_fatal = null;\n" +
      "self.onerror = function (msg, src, line, col, err) {\n" +
      "  var text = (err && err.stack) ? String(err.stack).split('\\n')[0] : String(msg);\n" +
      "  try { self.postMessage({ dbd: 'result', fatal: 'Uncaught ' + text + (line ? ' (line ' + line + ')' : ''), results: [], logs: __dbd_logs }); } catch (e) {}\n" +
      "  return true;\n" +
      "};\n;\n";
    const body = runnerBody(JSON.stringify(tests), fnName, perTestMs);
    const tail = "\n;\n" +
      "__dbd_runAll().then(function (results) {\n" +
      "  try { self.postMessage({ dbd: 'result', results: results, logs: __dbd_logs }); } catch (e) {}\n" +
      "}).catch(function (e) {\n" +
      "  try { self.postMessage({ dbd: 'result', fatal: String((e && e.stack) || e), results: [], logs: __dbd_logs }); } catch (e2) {}\n" +
      "});\n";
    const src = prelude + String(code) + tail.replace('__dbd_runAll()', () => body + '\n__dbd_runAll()');
    const linesBefore = (prelude.match(/\n/g) || []).length;
    return { src: splitGuard(src), linesBefore };
  }

  function buildIframeDoc(code, fnName, tests, perTestMs, runId) {
    const prelude = HELPERS + '\n;\n' +
      "window.onerror = function (msg, src, line, col, err) {\n" +
      "  var text = (err && err.stack) ? String(err.stack).split('\\n')[0] : String(msg);\n" +
      "  try { parent.postMessage({ dbd: 'dbd-result', runId: '" + runId + "', fatal: 'Uncaught ' + text + (line ? ' (line ' + line + ')' : ''), results: [], logs: __dbd_logs }, '*'); } catch (e) {}\n" +
      "  return true;\n" +
      "};\n;\n";
    const body = runnerBody(JSON.stringify(tests), fnName, perTestMs);
    const tail =
      "\n;\n" + body + "\n" +
      "__dbd_runAll().then(function (results) {\n" +
      "  try { parent.postMessage({ dbd: 'dbd-result', runId: '" + runId + "', results: results, logs: __dbd_logs }, '*'); } catch (e) {}\n" +
      "}).catch(function (e) {\n" +
      "  try { parent.postMessage({ dbd: 'dbd-result', runId: '" + runId + "', fatal: String((e && e.stack) || e), results: [], logs: __dbd_logs }, '*'); } catch (e2) {}\n" +
      "});\n";
    const linesBefore = (prelude.match(/\n/g) || []).length + 3; // + doctype/head/script lines
    const doc =
      '<!doctype html><html><head><meta charset="utf-8"></head><body><script>\n' +
      splitGuard(prelude) + splitGuard(String(code)) + splitGuard(tail) +
      '\n</scr' + 'ipt></body></html>';
    return { doc, linesBefore };
  }

  function runInWorker(code, fnName, tests, perTestMs, hardMs) {
    return new Promise((resolve) => {
      let url = null;
      let worker = null;
      let built;
      try {
        built = buildWorkerSource(code, fnName, tests, perTestMs);
        url = URL.createObjectURL(new Blob([built.src], { type: 'application/javascript' }));
        worker = new Worker(url);
      } catch (err) {
        resolve({ ok: false, engine: 'worker', error: String(err), results: [], logs: [] });
        return;
      }
      let done = false;
      const finish = (payload) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch (e) {}
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 200);
        resolve(Object.assign({ ok: true, engine: 'worker' }, payload));
      };
      const timer = setTimeout(() => {
        finish({ timedOut: true, fatal: 'Execution did not finish in ' + hardMs + ' ms — likely an infinite loop (the worker was terminated).', results: [], logs: [] });
      }, hardMs);
      worker.onmessage = (ev) => {
        const d = ev.data || {};
        if (d.dbd === 'result') finish({ timedOut: false, fatal: d.fatal || null, results: d.results || [], logs: d.logs || [] });
      };
      worker.onerror = (ev) => {
        const line = ev.lineno ? Math.max(1, ev.lineno - built.linesBefore) : null;
        finish({ timedOut: false, fatal: 'Uncaught ' + (ev.message || 'script error') + (line ? ' (line ' + line + ')' : ''), results: [], logs: [] });
        if (ev.preventDefault) ev.preventDefault();
      };
    });
  }

  function runInIframe(code, fnName, tests, perTestMs, hardMs) {
    return new Promise((resolve) => {
      const runId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.style.cssText = 'position:fixed;left:-20000px;top:0;width:900px;height:600px;border:0;';
      let done = false;
      const finish = (payload) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        setTimeout(() => { try { iframe.remove(); } catch (e) {} }, 150);
        resolve(Object.assign({ ok: true, engine: 'iframe' }, payload));
      };
      const onMsg = (ev) => {
        const d = ev.data;
        if (d && d.dbd === 'dbd-result' && d.runId === runId) {
          finish({ timedOut: false, fatal: d.fatal || null, results: d.results || [], logs: d.logs || [] });
        }
      };
      const timer = setTimeout(() => {
        finish({ timedOut: true, fatal: 'Execution did not finish in ' + hardMs + ' ms — likely an infinite loop.', results: [], logs: [] });
      }, hardMs);
      window.addEventListener('message', onMsg);
      const built = buildIframeDoc(code, fnName, tests, perTestMs, runId);
      iframe.srcdoc = built.doc;
      document.body.appendChild(iframe);
    });
  }

  async function runDirect(code, fnName, tests, perTestMs) {
    try {
      const src = HELPERS + '\n;\n' + String(code) + '\n;\n' +
        runnerBody(JSON.stringify(tests), fnName, 0) + '\nreturn __dbd_runAll();';
      const factory = new Function('return (async function () {\n' + src + '\n})()');
      const results = await factory();
      return { ok: true, engine: 'function', timedOut: false, fatal: null, results: results, logs: [] };
    } catch (err) {
      return { ok: false, engine: 'function', fatal: String((err && err.message) || err), results: [], logs: [] };
    }
  }

  /* ------------------------------------------------------------------ *
   *  Engine detection                                                   *
   * ------------------------------------------------------------------ */

  const info = { code: null, dom: null, ts: null }; // filled in by probes
  let codeEnginePromise = null;
  let domProbePromise = null;

  function probeWorker() {
    return new Promise((resolve) => {
      let worker = null;
      let url = null;
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        try { worker && worker.terminate(); } catch (e) {}
        try { url && URL.revokeObjectURL(url); } catch (e) {}
        resolve(ok);
      };
      try {
        const src = "self.onmessage = function (ev) { self.postMessage('pong'); };";
        url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
        worker = new Worker(url);
      } catch (e) { done(false); return; }
      const t = setTimeout(() => done(false), 1500);
      worker.onmessage = () => { clearTimeout(t); done(true); };
      worker.onerror = () => { clearTimeout(t); done(false); };
      try { worker.postMessage('ping'); } catch (e) { clearTimeout(t); done(false); }
    });
  }

  function probeIframe() {
    return new Promise((resolve) => {
      const runId = 'p' + Date.now().toString(36);
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.style.cssText = 'position:fixed;left:-20000px;top:0;width:10px;height:10px;border:0;';
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        window.removeEventListener('message', onMsg);
        try { iframe.remove(); } catch (e) {}
        resolve(ok);
      };
      const onMsg = (ev) => {
        const d = ev.data;
        if (d && d.dbd === 'dbd-probe' && d.runId === runId) done(true);
      };
      const t = setTimeout(() => done(false), 1500);
      window.addEventListener('message', onMsg);
      iframe.srcdoc = '<!doctype html><html><body><script>try{parent.postMessage({dbd:"dbd-probe",runId:"' + runId + '"},\'*\')}catch(e){}</scr' + 'ipt></body></html>';
      document.body.appendChild(iframe);
    });
  }

  function probeFunction() {
    try { return new Function('return 1')() === 1; } catch (e) { return false; }
  }

  function detectCodeEngine() {
    if (!codeEnginePromise) {
      codeEnginePromise = (async () => {
        if (await probeWorker()) { info.code = 'worker'; return 'worker'; }
        if (await probeIframe()) { info.code = 'iframe'; return 'iframe'; }
        if (probeFunction()) { info.code = 'function'; return 'function'; }
        info.code = 'none';
        return 'none';
      })();
    }
    return codeEnginePromise;
  }

  function detectDomEngine() {
    if (!domProbePromise) {
      domProbePromise = probeIframe().then((ok) => {
        info.dom = ok ? 'iframe' : 'none';
        return info.dom;
      });
    }
    return domProbePromise;
  }

  /* ------------------------------------------------------------------ *
   *  Public API                                                         *
   * ------------------------------------------------------------------ */

  async function runCodeTests(opts) {
    const code = opts.code || '';
    const fnName = opts.fnName || '';
    const tests = opts.tests || [];
    const perTestMs = typeof opts.perTestMs === 'number' ? opts.perTestMs : 4000;
    const hardMs = typeof opts.hardMs === 'number' ? opts.hardMs : 9000;
    if (!tests.length) {
      return { ok: false, engine: null, error: 'This task has no test cases attached.', results: [], logs: [] };
    }
    let engine = await detectCodeEngine();
    if (engine === 'worker') {
      const r = await runInWorker(code, fnName, tests, perTestMs, hardMs);
      if (!r.ok) engine = (await detectDomEngine()) === 'iframe' ? 'iframe' : (probeFunction() ? 'function' : 'none');
      else return r;
    }
    if (engine === 'iframe') {
      const r = await runInIframe(code, fnName, tests, perTestMs, hardMs);
      if (r.ok) return r;
      engine = probeFunction() ? 'function' : 'none';
    }
    if (engine === 'function') {
      const r = await runDirect(code, fnName, tests, perTestMs);
      if (r.ok) return r;
    }
    return {
      ok: false, engine: 'none',
      fatal: 'This environment blocks every code-execution path (worker, sandboxed iframe, and eval). The drills cannot be auto-tested here.',
      results: [], logs: []
    };
  }

  function buildDomDoc(html, css, assertions, runId) {
    const script =
      "window.onerror = function (msg) { try { parent.postMessage({ dbd: 'dbd-dom', runId: '" + runId + "', fatal: String(msg) }, '*'); } catch (e) {} return true; };\n" +
      "var __assertions = " + JSON.stringify(assertions || []) + ";\n" +
      "function fmt(v) { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { return String(v); } }\n" +
      "function kebab(s) { return String(s).replace(/([A-Z])/g, function (m) { return '-' + m.toLowerCase(); }); }\n" +
      "var results = [];\n" +
      "function evaluate(a) {\n" +
      "  var r = { kind: a.type, selector: a.selector, property: a.property, attr: a.attr, expected: a.expected, passed: false, actual: null, error: null };\n" +
      "  try {\n" +
      "    var els, eln;\n" +
      "    if (a.type === 'exists') {\n" +
      "      els = document.querySelectorAll(a.selector);\n" +
      "      r.actual = els.length > 0 ? ('found ' + els.length) : 'not found';\n" +
      "      r.passed = !!a.expected === (els.length > 0);\n" +
      "    } else if (a.type === 'count') {\n" +
      "      els = document.querySelectorAll(a.selector);\n" +
      "      r.actual = els.length;\n" +
      "      r.passed = els.length === a.expected;\n" +
      "    } else if (a.type === 'computedStyle') {\n" +
      "      eln = document.querySelector(a.selector);\n" +
      "      if (!eln) { r.error = 'No element matches ' + a.selector; } else {\n" +
      "        r.actual = getComputedStyle(eln).getPropertyValue(kebab(a.property)).trim();\n" +
      "        r.passed = String(r.actual) === String(a.expected).trim();\n" +
      "      }\n" +
      "    } else if (a.type === 'text') {\n" +
      "      eln = document.querySelector(a.selector);\n" +
      "      if (!eln) { r.error = 'No element matches ' + a.selector; } else {\n" +
      "        r.actual = (eln.textContent || '').trim();\n" +
      "        r.passed = r.actual === String(a.expected).trim();\n" +
      "      }\n" +
      "    } else if (a.type === 'attr') {\n" +
      "      eln = document.querySelector(a.selector);\n" +
      "      if (!eln) { r.error = 'No element matches ' + a.selector; } else {\n" +
      "        r.actual = eln.getAttribute(a.attr);\n" +
      "        r.passed = r.actual === a.expected;\n" +
      "      }\n" +
      "    } else {\n" +
      "      r.error = 'Unknown assertion type: ' + a.type;\n" +
      "    }\n" +
      "  } catch (err) { r.error = String((err && err.message) || err); }\n" +
      "  return r;\n" +
      "}\n" +
      "setTimeout(function () {\n" +
      "  for (var i = 0; i < __assertions.length; i++) results.push(evaluate(__assertions[i]));\n" +
      "  try { parent.postMessage({ dbd: 'dbd-dom', runId: '" + runId + "', results: results }, '*'); } catch (e) {}\n" +
      "}, 30);\n";
    return '<!doctype html><html><head><meta charset="utf-8">\n<style>\n' + splitGuard(String(css || '')) + '\n</style></head><body>\n' +
      splitGuard(String(html || '')) + '\n<script>\n' + script + '\n</scr' + 'ipt></body></html>';
  }

  async function runDomChecks(opts) {
    const engine = await detectDomEngine();
    if (engine !== 'iframe') {
      return { ok: false, engine: 'none', fatal: 'The sandboxed HTML/CSS checker is unavailable in this environment.', results: [] };
    }
    const runId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const hardMs = typeof opts.hardMs === 'number' ? opts.hardMs : 6000;
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.style.cssText = 'position:fixed;left:-20000px;top:0;width:1024px;height:800px;border:0;';
      let done = false;
      const finish = (payload) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        setTimeout(() => { try { iframe.remove(); } catch (e) {} }, 150);
        resolve(Object.assign({ ok: true, engine: 'iframe' }, payload));
      };
      const onMsg = (ev) => {
        const d = ev.data;
        if (d && d.dbd === 'dbd-dom' && d.runId === runId) {
          finish({ timedOut: false, fatal: d.fatal || null, results: d.results || [] });
        }
      };
      const timer = setTimeout(() => {
        finish({ timedOut: true, fatal: 'The style checks did not finish in ' + hardMs + ' ms.', results: [] });
      }, hardMs);
      window.addEventListener('message', onMsg);
      iframe.srcdoc = buildDomDoc(opts.html, opts.css, opts.assertions, runId);
      document.body.appendChild(iframe);
    });
  }

  DBD.runner = {
    info,
    detectCodeEngine,
    detectDomEngine,
    runCodeTests,
    runDomChecks
  };
})();
