/*
 * Don't Be Dumb — lightweight syntax-highlighted code editor.
 * A transparent <textarea> over a highlighted <pre>, synced scroll, line numbers,
 * tab/auto-indent handling. No external libraries. Exposes window.DBD.createEditor.
 */
(function () {
  'use strict';

  const DBD = (window.DBD = window.DBD || {});

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
  }
  DBD.escapeHtml = escapeHtml;

  const JS_KEYWORDS = [
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'default', 'break', 'continue', 'new', 'class', 'extends', 'super',
    'typeof', 'instanceof', 'in', 'of', 'try', 'catch', 'finally', 'throw', 'async', 'await',
    'yield', 'delete', 'void', 'static', 'get', 'set', 'export', 'import', 'from', 'as',
    'type', 'interface', 'enum', 'implements', 'readonly', 'public', 'private', 'protected',
    'declare', 'namespace', 'abstract', 'keyof', 'infer', 'is', 'asserts', 'satisfies', 'override'
  ];
  const JS_LITERALS = ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'this', 'super'];
  const TS_TYPES = ['any', 'unknown', 'never', 'void', 'string', 'number', 'boolean', 'object', 'symbol', 'bigint'];

  const JS_KW_RE = JS_KEYWORDS.join('|');
  const JS_LIT_RE = JS_LITERALS.join('|');
  const TS_TYPE_RE = TS_TYPES.join('|');
  const JS_TOKENS = new RegExp(
    '(' + [
      '/\\*[\\s\\S]*?(?:\\*/|$)',              // block comment
      '//[^\\n]*'                              // line comment
    ].join('|') + ')' +
    '|(' + [
      '`(?:\\\\[\\s\\S]|[^\\\\`])*`',
      '"(?:\\\\.|[^\\\\"\\n])*"',
      "'(?:\\\\.|[^\\\\'\\n])*'"
    ].join('|') + ')' +
    '|\\b(' + [
      '0[xX][0-9a-fA-F_]+', '0[bB][01_]+', '0[oO][0-7_]+',
      '\\d[\\d_]*\\.?[\\d_]*(?:[eE][+-]?\\d+)?', '\\.\\d[\\d_]*'
    ].join('|') + ')\\b' +
    '|\\b(' + [JS_KW_RE, JS_LIT_RE, TS_TYPE_RE].join('|') + ')\\b' +
    '|([A-Za-z_$][\\w$]*)(?=\\s*\\()' +
    '|([{}()\\[\\];,.=+\\-*/%<>!&|?:^~]+)',
    'g'
  );
  const CSS_TOKENS = new RegExp(
    '(/\\*[\\s\\S]*?(?:\\*/|$))' +
    '|("(?:\\\\.|[^\\\\"])*"|\'(?:\\\\.|[^\\\\\'])*\')' +
    '|(#[0-9a-fA-F]{3,8}\\b)' +
    '|(-?\\d+(?:\\.\\d+)?(?:px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr|ch|pt|cm|mm|in|ex|q)?\\b)' +
    '|(@[A-Za-z-]+)' +
    '|([A-Za-z-]+)(?=\\s*:)' +
    '|([{}();:,>~+*\\[\\]=])',
    'g'
  );
  const HTML_TOKENS = new RegExp(
    '(<!--[\\s\\S]*?(?:-->|$))' +
    '|(<\\/?[A-Za-z][\\w-]*)' +
    '|(/?>)' +
    '|("[^"]*"|\'[^\']*\')' +
    '|([A-Za-z-]+)(?==)',
    'g'
  );

  function span(cls, text) { return '<span class="' + cls + '">' + escapeHtml(text) + '</span>'; }

  function highlightWith(re, classes, code) {
    let out = '';
    let last = 0;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      out += escapeHtml(code.slice(last, m.index));
      let cls = null;
      for (let g = 1; g < m.length; g++) { if (m[g] !== undefined) { cls = classes[g - 1]; break; } }
      out += cls ? span(cls, m[0]) : escapeHtml(m[0]);
      last = m.index + m[0].length;
    }
    out += escapeHtml(code.slice(last));
    return out;
  }

  function highlight(code, lang) {
    code = String(code == null ? '' : code);
    try {
      if (lang === 'css') return highlightWith(CSS_TOKENS, ['tk-c', 'tk-s', 'tk-n', 'tk-n', 'tk-k', 'tk-a', 'tk-p'], code);
      if (lang === 'html') return highlightWith(HTML_TOKENS, ['tk-c', 'tk-k', 'tk-p', 'tk-s', 'tk-a'], code);
      // js / ts
      const re = JS_TOKENS;
      let out = '';
      let last = 0;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        out += escapeHtml(code.slice(last, m.index));
        if (m[1] !== undefined) out += span('tk-c', m[0]);
        else if (m[2] !== undefined) out += span('tk-s', m[0]);
        else if (m[3] !== undefined) out += span('tk-n', m[0]);
        else if (m[4] !== undefined) {
          const w = m[4];
          const isLit = JS_LITERALS.indexOf(w) !== -1;
          out += span(isLit ? 'tk-b' : 'tk-k', w);
        } else if (m[5] !== undefined) out += span('tk-a', m[0]);
        else if (m[6] !== undefined) out += span('tk-p', m[0]);
        else out += escapeHtml(m[0]);
        last = m.index + m[0].length;
      }
      out += escapeHtml(code.slice(last));
      return out;
    } catch (e) {
      return escapeHtml(code);
    }
  }
  DBD.highlight = highlight;

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /*
   * createEditor(host, { language, value, onChange, minHeight })
   * → { getValue, setValue, focus, setLanguage, destroy }
   */
  DBD.createEditor = function createEditor(host, opts) {
    opts = opts || {};
    host.innerHTML = '';

    const root = el('div', 'dbd-editor');
    const gutter = el('div', 'dbd-editor-gutter');
    const scrollWrap = el('div', 'dbd-editor-scroll');
    const pre = el('pre', 'dbd-editor-pre');
    pre.setAttribute('aria-hidden', 'true');
    const codeEl = el('code');
    pre.appendChild(codeEl);
    const area = el('textarea', 'dbd-editor-area');
    area.spellcheck = false;
    area.setAttribute('autocapitalize', 'off');
    area.setAttribute('autocomplete', 'off');
    area.setAttribute('autocorrect', 'off');
    area.wrap = 'off';
    area.setAttribute('aria-label', 'Code editor');
    scrollWrap.appendChild(pre);
    scrollWrap.appendChild(area);
    root.appendChild(gutter);
    root.appendChild(scrollWrap);
    host.appendChild(root);

    const state = { lang: opts.language || 'js', onChange: opts.onChange || null };

    area.value = String(opts.value || '');

    function paint() {
      codeEl.innerHTML = highlight(area.value, state.lang) + '\n';
      const lines = area.value.split('\n').length;
      let nums = '';
      for (let i = 1; i <= lines; i++) nums += i + '\n';
      gutter.textContent = nums;
      pre.scrollTop = area.scrollTop;
      pre.scrollLeft = area.scrollLeft;
      gutter.scrollTop = area.scrollTop;
    }

    function fire() {
      if (state.onChange) {
        try { state.onChange(area.value); } catch (e) { /* ignore */ }
      }
    }

    function setRange(a, b, text) {
      if (area.setRangeText) {
        area.setRangeText(text, a, b, 'start');
      } else {
        const v = area.value;
        area.value = v.slice(0, a) + text + v.slice(b);
      }
      paint();
      fire();
    }

    function lineInfo(pos) {
      const v = area.value;
      const ls = v.lastIndexOf('\n', pos - 1) + 1;
      let le = v.indexOf('\n', pos);
      if (le === -1) le = v.length;
      return [ls, le];
    }

    function indentSelection(outdent) {
      const v = area.value;
      const s = area.selectionStart;
      const e = area.selectionEnd;
      const [ls, le] = lineInfo(Math.min(s, e));
      const block = v.slice(ls, le);
      const lines = block.split('\n');
      let removedFirst = 0;
      let removedTotal = 0;
      const mapped = lines.map((ln, i) => {
        if (outdent) {
          const m = ln.match(/^ {1,2}/);
          const rm = m ? m[0].length : 0;
          if (i === 0) removedFirst = rm;
          removedTotal += rm;
          return ln.slice(rm);
        }
        return '  ' + ln;
      });
      const out = mapped.join('\n');
      setRange(ls, le, out);
      if (outdent) {
        area.selectionStart = Math.max(ls, s - removedFirst);
        area.selectionEnd = Math.max(area.selectionStart, e - removedTotal);
      } else {
        area.selectionStart = s + 2;
        area.selectionEnd = e + 2 * lines.length;
      }
    }

    function insertNewline() {
      const v = area.value;
      const s = area.selectionStart;
      const e = area.selectionEnd;
      const [ls] = lineInfo(s);
      const before = v.slice(ls, s);
      const indent = (before.match(/^[ \t]*/) || [''])[0];
      const lastChar = v[s - 1];
      const nextChar = v[e];
      const opens = lastChar === '{' || lastChar === '(' || lastChar === '[';
      const closes = (lastChar === '{' && nextChar === '}') ||
                     (lastChar === '(' && nextChar === ')') ||
                     (lastChar === '[' && nextChar === ']');
      if (opens && closes && s === e) {
        const text = '\n' + indent + '  \n' + indent;
        setRange(s, e, text);
        area.selectionStart = area.selectionEnd = s + 1 + indent.length + 2;
      } else {
        setRange(s, e, '\n' + indent + (opens ? '  ' : ''));
        area.selectionStart = area.selectionEnd = s + 1 + indent.length + (opens ? 2 : 0);
      }
    }

    function toggleCommentText(block, lang) {
      if (lang === 'css' || lang === 'html') {
        const open = lang === 'css' ? '/*' : '<!--';
        const close = lang === 'css' ? '*/' : '-->';
        const t = block.trim();
        if (t.startsWith(open) && t.endsWith(close)) {
          const inner = t.slice(open.length, t.length - close.length).replace(/^\s+|\s+$/g, '');
          return { text: inner, selStart: 0, selEnd: inner.length };
        }
        const text = open + ' ' + block + ' ' + close;
        return { text, selStart: 0, selEnd: text.length };
      }
      // js / ts — per-line //
      const lines = block.split('\n');
      const nonEmpty = lines.filter((l) => l.trim().length > 0);
      const allCommented = nonEmpty.length > 0 && nonEmpty.every((l) => /^\s*\/\//.test(l));
      const outLines = lines.map((ln) => {
        if (!ln.trim().length) return ln;
        if (allCommented) return ln.replace(/^(\s*)\/\/ ?/, '$1');
        const m = ln.match(/^(\s*)/);
        return m[1] + '// ' + ln.slice(m[1].length);
      });
      const text = outLines.join('\n');
      return { text, selStart: 0, selEnd: text.length };
    }

    function toggleLineComment() {
      const v = area.value;
      const s = Math.min(area.selectionStart, area.selectionEnd);
      const e = Math.max(area.selectionStart, area.selectionEnd);
      const [ls] = lineInfo(s);
      const endPos = (e > s && v[e - 1] === '\n') ? e - 1 : e;
      const [, le] = lineInfo(endPos);
      const block = v.slice(ls, le);
      const out = toggleCommentText(block, state.lang);
      if (out.text === block) return;
      setRange(ls, le, out.text);
      area.selectionStart = ls + out.selStart;
      area.selectionEnd = ls + out.selEnd;
    }

    area.addEventListener('keydown', (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && (ev.key === '/' || ev.code === 'Slash')) {
        ev.preventDefault();
        toggleLineComment();
      } else if (ev.key === 'Tab') {
        ev.preventDefault();
        indentSelection(ev.shiftKey);
      } else if (ev.key === 'Enter' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        ev.preventDefault();
        insertNewline();
      }
    });

    area.addEventListener('input', () => { paint(); fire(); });
    area.addEventListener('scroll', () => {
      pre.scrollTop = area.scrollTop;
      pre.scrollLeft = area.scrollLeft;
      gutter.scrollTop = area.scrollTop;
    });
    area.addEventListener('focus', () => root.classList.add('is-focus'));
    area.addEventListener('blur', () => root.classList.remove('is-focus'));

    paint();

    return {
      element: root,
      getValue() { return area.value; },
      setValue(v) {
        area.value = String(v == null ? '' : v);
        paint();
      },
      getLanguage() { return state.lang; },
      setLanguage(l) { state.lang = l; paint(); },
      setOnChange(fn) { state.onChange = fn; },
      focus() { area.focus(); },
      destroy() { host.innerHTML = ''; }
    };
  };
})();
