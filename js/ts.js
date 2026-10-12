/*
 * Don't Be Dumb — TypeScript support (static bundles).
 *
 * The sandbox blocks on-demand script loading and fetch() to app files, so the
 * official TypeScript compiler (libs/typescript.js) and its stdlib .d.ts files
 * (libs/tslibs.js → window.__DBD_TS_LIBS__) load as deferred static scripts in
 * index.html. They parse once at launch and sit idle until a TS drill runs.
 *
 * - transpile(source) → runnable JS (types stripped, enums inlined)
 * - typeCheck(source) → real semantic diagnostics (strict) via ts.createProgram
 *   with a virtual compiler host serving the bundled lib files.
 */
(function () {
  'use strict';

  const DBD = (window.DBD = window.DBD || {});
  const T = { status: 'idle', error: null };
  let tsPromise = null;

  function waitFor(check, timeoutMs) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function poll() {
        let v = null;
        try { v = check(); } catch (e) { v = null; }
        if (v) { resolve(v); return; }
        if (Date.now() - t0 > timeoutMs) {
          reject(new Error('timed out waiting for the bundled TypeScript files to initialise'));
          return;
        }
        setTimeout(poll, 120);
      })();
    });
  }

  function ensureLoaded() {
    if (!tsPromise) {
      T.status = 'loading';
      T.error = null;
      tsPromise = waitFor(() => (window.ts && window.ts.transpileModule) ? window.ts : null, 20000)
        .then((ts) => { T.status = 'ready'; return ts; })
        .catch((e) => {
          T.status = 'failed';
          T.error = String((e && e.message) || e);
          tsPromise = null;
          throw e;
        });
    }
    return tsPromise;
  }

  function libsMap() {
    const m = window.__DBD_TS_LIBS__;
    return (m && typeof m === 'object') ? m : null;
  }

  function libRefs(text) {
    const out = [];
    const re = /\/\/\/\s*<reference\s+lib=["']([^"']+)["']\s*\/>/g;
    let m;
    while ((m = re.exec(text))) out.push('lib.' + m[1] + '.d.ts');
    return out;
  }

  async function buildProgram(source) {
    const ts = await ensureLoaded();
    const libs = await waitFor(libsMap, 20000);
    const root = 'challenge.ts';

    const candidates = ['lib.es2020.full.d.ts', 'lib.esnext.full.d.ts', 'lib.es2015.full.d.ts', 'lib.es5.d.ts'];
    let rootFile = null;
    const needed = new Set();
    for (const cand of candidates) {
      if (libs[cand] === undefined) continue;
      const seen = new Set();
      const queue = [cand];
      let ok = true;
      while (queue.length) {
        const f = queue.shift();
        if (seen.has(f)) continue;
        const text = libs[f];
        if (text === undefined) { ok = false; break; }
        seen.add(f);
        for (const dep of libRefs(text)) queue.push(dep);
      }
      if (ok) {
        rootFile = cand;
        for (const f of seen) needed.add(f);
        break;
      }
    }
    if (!rootFile) throw new Error('The bundled TypeScript stdlib is missing or incomplete.');

    const short = (name) => String(name).split('/').pop();
    const getText = (name) => {
      if (libs[name] !== undefined) return libs[name];
      return libs[short(name)];
    };

    const host = {
      getSourceFile(name) {
        if (name === root) return ts.createSourceFile(name, source, ts.ScriptTarget.ES2020, true);
        const cached = getText(name);
        if (cached !== undefined) return ts.createSourceFile(name, cached, ts.ScriptTarget.ES2020, true);
        return undefined;
      },
      getDefaultLibFileName() { return rootFile; },
      getDefaultLibLocation() { return ''; },
      writeFile() {},
      getCurrentDirectory() { return ''; },
      getCanonicalFileName(f) { return f; },
      useCaseSensitiveFileNames() { return true; },
      getNewLine() { return '\n'; },
      fileExists(name) { return name === root || getText(name) !== undefined; },
      readFile(name) { return name === root ? source : getText(name); },
      directoryExists() { return true; },
      getDirectories() { return []; }
    };

    const options = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      types: []
    };
    const program = ts.createProgram([root], options, host);
    return { ts, program, root };
  }

  async function typeCheck(source) {
    const { ts, program, root } = await buildProgram(source);
    const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file && d.file.fileName === root);
    return diags.map((d) => {
      let line = 1, col = 1;
      try {
        const pos = d.file.getLineAndCharacterOfPosition(d.start || 0);
        line = pos.line + 1;
        col = pos.character + 1;
      } catch (e) { /* keep defaults */ }
      return {
        line, column: col,
        message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
        code: d.code
      };
    });
  }

  async function transpile(source) {
    const ts = await ensureLoaded();
    const out = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        esModuleInterop: true,
        removeComments: false
      },
      reportDiagnostics: true
    });
    const diags = (out.diagnostics || []).map((d) => ({
      message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
      code: d.code
    }));
    return { js: out.outputText, diagnostics: diags };
  }

  DBD.ts = { ensureLoaded, transpile, typeCheck, status: T };
})();
