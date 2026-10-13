/*
 * Don't Be Dumb — application logic.
 *
 * The loop: pick a skill + difficulty → the AI writes a fresh, never-repeated
 * drill (history stored in SQLite is fed back into the prompt) → you solve it in
 * a strict "no help until you pass or give up" environment → real tests run in a
 * sandboxed local runner → results, reference solution and an AI review.
 */
(function () {
  'use strict';

  const DBD = window.DBD;
  const chatoss = window.chatoss;

  /* ------------------------------------------------------------------ *
   *  helpers                                                            *
   * ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  const esc = DBD.escapeHtml;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function localDateKey(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fmtVal(v) {
    try { const s = JSON.stringify(v); return s === undefined ? String(v) : s; } catch (e) { return String(v); }
  }
  const KIND_LABEL = { code: 'write a function', bug: 'find the bug', dom: 'html/css build', quiz: 'quiz' };

  /* ------------------------------------------------------------------ *
   *  state                                                              *
   * ------------------------------------------------------------------ */

  const S = {
    headless: false,
    skills: [],
    models: [],
    model: null,
    settings: { nudgeEnabled: true, model: null },
    current: null,        // { task, attempt, active }
    view: 'dashboard',
    unlocked: false,
    editor: null,
    cssEditor: null,
    domHosts: null,
    domTab: 'html',
    timerId: null,
    elapsed: 0,
    baseSeconds: 0,
    resumedAt: 0,
    lastResults: null,
    aiBusy: false,
    running: false,
    runOnceBusy: false,
    paused: false,
    onboard: null,
    booted: false,
    saveTimer: null,
    previewTimer: null
  };

  /* ------------------------------------------------------------------ *
   *  modals (no confirm()/alert() — they are no-ops in the sandbox)     *
   * ------------------------------------------------------------------ */

  function confirmModal(o) {
    return new Promise((resolve) => {
      $('confirm-title').textContent = o.title || 'Are you sure?';
      $('confirm-body').textContent = o.body || '';
      const ok = $('confirm-ok');
      ok.textContent = o.confirmLabel || 'Confirm';
      ok.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary');
      $('modal-confirm').hidden = false;
      const close = (v) => {
        $('modal-confirm').hidden = true;
        ok.onclick = null;
        $('confirm-cancel').onclick = null;
        $('confirm-x').onclick = null;
        resolve(v);
      };
      ok.onclick = () => close(true);
      $('confirm-cancel').onclick = () => close(false);
      $('confirm-x').onclick = () => close(false);
    });
  }

  /* ------------------------------------------------------------------ *
   *  AI panel                                                           *
   * ------------------------------------------------------------------ */

  function aiLog(role, text) {
    const log = $('ai-log');
    const msg = el('div', 'dbd-ai-msg' + (role === 'error' ? ' is-error' : '') + (role === 'locked' ? ' is-locked' : ''));
    const roleEl = el('div', 'dbd-ai-role', role);
    const body = el('div', 'dbd-ai-body', text || '');
    msg.appendChild(roleEl);
    msg.appendChild(body);
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
    msg._body = body;
    msg._role = roleEl;
    return msg;
  }

  function updateAiPanelForTask() {
    const badge = $('ai-mode-badge');
    const foot = $('ai-foot');
    foot.innerHTML = '';
    badge.className = 'badge';
    const c = S.current;
    if (!c) {
      badge.textContent = 'idle';
      badge.classList.add('badge-info');
      foot.appendChild(el('div', 'hint', 'Request a drill from the dashboard. This panel shows exactly what the AI is doing — drafts, reviews, and errors.'));
      return;
    }
    if (c.active) {
      badge.textContent = 'focused';
      badge.classList.add('badge-warn');
      foot.appendChild(el('div', 'hint', '🔒 Focused mode: no AI help until you pass or give up. The drill is brand new, so the first idea is yours.'));
    } else {
      badge.textContent = 'unlocked';
      badge.classList.add('badge-success');
      foot.appendChild(el('div', 'hint', 'Unlocked — reveal the reference solution, read why it works, or ask for a review of your code.'));
    }
  }

  /* ------------------------------------------------------------------ *
   *  sidebar / dashboard rendering                                      *
   * ------------------------------------------------------------------ */

  function rotInfo(skill) {
    const d = DBD.ai.daysSince(skill.last_practiced_at);
    if (d == null) return { cls: 'is-danger', label: 'never drilled', days: null, score: 1e6 };
    if (d <= 7) return { cls: '', label: d === 0 ? 'practiced today' : d + 'd ago', days: d, score: d };
    if (d <= 21) return { cls: 'is-amber', label: 'rotting · ' + d + 'd', days: d, score: d };
    return { cls: 'is-danger', label: 'rotting · ' + d + 'd', days: d, score: d };
  }

  function renderSkills() {
    const host = $('skill-list');
    host.innerHTML = '';
    if (!S.skills.length) {
      host.appendChild(el('div', 'hint', 'No skills yet — add one.'));
      return;
    }
    for (const s of S.skills) {
      const rot = rotInfo(s);
      const row = el('button', 'dbd-skill-row ' + rot.cls);
      row.type = 'button';
      row.title = s.name + ' — ' + s.level + (s.notes ? '\n' + s.notes : '') + '\nclick to edit';
      row.appendChild(el('span', 'dbd-skill-dot'));
      row.appendChild(el('span', 'dbd-skill-name', s.name));
      row.appendChild(el('span', 'dbd-skill-days', rot.days == null ? 'never' : (rot.days === 0 ? 'today' : rot.days + 'd')));
      row.addEventListener('click', () => openSkillModal(s));
      host.appendChild(row);
    }
  }

  function renderRequestSkills() {
    const sel = $('req-skill');
    const keep = sel.value;
    sel.innerHTML = '';
    const auto = el('option');
    auto.value = '__auto__';
    auto.textContent = 'auto — most neglected';
    sel.appendChild(auto);
    for (const s of S.skills) {
      const o = el('option');
      o.value = s.name;
      o.textContent = s.name;
      sel.appendChild(o);
    }
    if (keep && Array.from(sel.options).some((o) => o.value === keep)) sel.value = keep;
  }

  async function renderRotRadar() {
    const host = $('rot-grid');
    host.innerHTML = '';
    if (!S.skills.length) {
      host.appendChild(el('div', 'hint', 'Add a skill to see its rot radar.'));
      return;
    }
    let statMap = new Map();
    try {
      const stats = await DBD.db.perSkillStats();
      statMap = new Map(stats.map((r) => [r.skill, r]));
    } catch (e) { /* stats are optional */ }

    const sorted = S.skills.slice().sort((a, b) => rotInfo(b).score - rotInfo(a).score);
    for (const s of sorted) {
      const rot = rotInfo(s);
      const st = statMap.get(s.name) || { attempts: 0, passed: 0 };
      const card = el('button', 'dbd-rot-card ' + rot.cls);
      card.type = 'button';
      card.title = 'Click to request a drill for ' + s.name;

      const top = el('div', 'dbd-rot-top');
      top.appendChild(el('span', 'dbd-rot-name', s.name));
      const lvl = el('span', 'badge', s.level);
      lvl.classList.add(rot.cls === 'is-danger' ? 'badge-danger' : rot.cls === 'is-amber' ? 'badge-warn' : 'badge-success');
      top.appendChild(lvl);
      card.appendChild(top);

      const meta = el('div', 'dbd-rot-meta');
      meta.appendChild(el('span', null, rot.label));
      meta.appendChild(el('span', 'faint', '·'));
      meta.appendChild(el('span', null, st.attempts ? st.attempts + ' drills · ' + Math.round((st.passed / st.attempts) * 100) + '% pass' : 'no data yet'));
      card.appendChild(meta);

      const bar = el('div', 'dbd-rot-bar');
      const pct = rot.days == null ? 100 : Math.min(100, Math.round((rot.days / 30) * 100));
      const fill = el('span');
      fill.style.width = Math.max(4, pct) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);

      card.addEventListener('click', () => {
        $('req-skill').value = s.name;
        $('req-note').focus();
        document.querySelector('.dbd-request-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      host.appendChild(card);
    }
  }

  function computeStreak(isoList) {
    const keys = new Set(isoList.map(localDateKey).filter(Boolean));
    let streak = 0;
    const cur = new Date();
    let key = localDateKey(cur.toISOString());
    if (!keys.has(key)) {
      cur.setDate(cur.getDate() - 1);
      key = localDateKey(cur.toISOString());
      if (!keys.has(key)) return 0;
    }
    while (keys.has(key)) {
      streak++;
      cur.setDate(cur.getDate() - 1);
      key = localDateKey(cur.toISOString());
    }
    return streak;
  }

  async function renderStats() {
    let streak = 0;
    let o = { tasks: 0, done: 0, passed: 0 };
    try {
      o = await DBD.db.overallStats();
      const dates = await DBD.db.completedAttemptDates(500);
      streak = computeStreak(dates.map((r) => r.updated_at));
    } catch (e) { /* ignore */ }
    $('streak-count').textContent = String(streak);

    const row = $('stat-row');
    row.innerHTML = '';
    const stat = (num, label) => {
      const d = el('div', 'dbd-stat');
      d.appendChild(el('div', 'dbd-stat-num', String(num)));
      d.appendChild(el('div', 'dbd-stat-label', label));
      row.appendChild(d);
    };
    stat(o.done, 'drills completed');
    stat(o.done ? Math.round((o.passed / o.done) * 100) + '%' : '—', 'pass rate');
    stat(o.tasks, 'drills generated');
    stat(streak + (streak === 1 ? ' day' : ' days'), 'current streak');
  }

  async function renderHistory() {
    const host = $('history-list');
    host.innerHTML = '';
    let rows = [];
    try { rows = await DBD.db.recentAttempts(50); } catch (e) { /* ignore */ }
    $('history-count').textContent = rows.length ? String(rows.length) : '';
    if (!rows.length) {
      host.appendChild(el('div', 'hint', 'No drills yet — generate your first one.'));
      return;
    }
    for (const r of rows) {
      const row = el('button', 'dbd-hist-row');
      row.type = 'button';
      row.title = r.title + '\n' + r.skill + ' · ' + KIND_LABEL[r.kind] + ' · ' + r.difficulty;
      const badge = el('span', 'dbd-hist-badge badge');
      if (r.outcome === 'passed') { badge.textContent = '✓'; badge.classList.add('badge-success'); }
      else if (r.outcome === 'given_up') { badge.textContent = '✗'; badge.classList.add('badge-danger'); }
      else { badge.textContent = '…'; badge.classList.add('badge-info'); }
      row.appendChild(badge);
      row.appendChild(el('span', 'dbd-hist-title', r.title));
      row.addEventListener('click', () => openTaskFromHistory(r.task_id));
      host.appendChild(row);
    }
  }

  async function refreshAll() {
    try { S.skills = await DBD.db.listSkills(); } catch (e) { S.skills = []; }
    renderSkills();
    renderRequestSkills();
    await renderRotRadar();
    await renderStats();
    await renderHistory();
  }

  /* ------------------------------------------------------------------ *
   *  view switching + timer                                             *
   * ------------------------------------------------------------------ */

  function showView(name) {
    S.view = name;
    document.documentElement.dataset.view = name;
    const home = name === 'dashboard';
    $('sidebar').hidden = !home;
    $('main-home').hidden = !home;
    $('ai-panel').hidden = !home;
    $('task-screen').hidden = name !== 'task';
    $('topbar-title').textContent = name === 'dashboard' ? 'Drill dashboard' : 'Drill workspace';
    if (!home) applyConsoleWidth();
  }

  function renderTimer() {
    const c = S.current;
    if (!c) return;
    let elapsed;
    if (c.active && !S.paused) {
      elapsed = (S.baseSeconds || 0) + Math.floor((Date.now() - (S.resumedAt || Date.now())) / 1000);
    } else if (S.paused) {
      elapsed = S.baseSeconds || 0;
    } else {
      elapsed = (c.attempt && c.attempt.seconds) || S.baseSeconds || 0;
    }
    S.elapsed = elapsed;
    const chip = $('task-timer');
    chip.textContent = fmtElapsed(elapsed);
    chip.classList.toggle('is-paused', !!S.paused);
  }

  function fmtElapsed(total) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }

  function updatePauseButton() {
    const b = $('btn-pause');
    if (!b) return;
    b.textContent = S.paused ? '▶' : '⏸';
    b.title = S.paused ? 'Resume the timer' : 'Pause the timer (take a break)';
  }

  async function togglePause() {
    const c = S.current;
    if (!c || !c.active) return;
    if (!S.paused) {
      renderTimer();
      S.baseSeconds = S.elapsed;
      S.paused = true;
      stopTimer();
      updatePauseButton();
      try { if (c.attempt) c.attempt = await DBD.db.updateAttempt(c.attempt.id, { seconds: S.baseSeconds }); } catch (e) { /* ignore */ }
      renderTimer();
    } else {
      S.paused = false;
      S.resumedAt = Date.now();
      updatePauseButton();
      startTimer();
    }
  }
  function startTimer() {
    stopTimer();
    S.timerId = setInterval(renderTimer, 1000);
    renderTimer();
  }
  function stopTimer() {
    if (S.timerId) { clearInterval(S.timerId); S.timerId = null; }
  }

  /* ------------------------------------------------------------------ *
   *  markdown-lite (for task prompts)                                   *
   * ------------------------------------------------------------------ */

  function inlineMd(s) {
    return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function renderMarkdownLite(host, text) {
    const parts = String(text || '').split(/```/);
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        out += '<pre class="code-block">' + esc(parts[i].replace(/^[a-zA-Z]*\n/, '')) + '</pre>';
        continue;
      }
      const lines = esc(parts[i]).split('\n');
      let inList = false;
      for (const ln of lines) {
        const t = ln.trim();
        if (/^#{1,4}\s+/.test(t)) {
          if (inList) { out += '</ul>'; inList = false; }
          out += '<h4>' + inlineMd(t.replace(/^#{1,4}\s+/, '')) + '</h4>';
          continue;
        }
        if (/^[-*•]\s+/.test(t)) {
          if (!inList) { out += '<ul>'; inList = true; }
          out += '<li>' + inlineMd(t.replace(/^[-*•]\s+/, '')) + '</li>';
          continue;
        }
        if (inList) { out += '</ul>'; inList = false; }
        if (!t) continue;
        out += '<p>' + inlineMd(ln) + '</p>';
      }
      if (inList) out += '</ul>';
    }
    host.innerHTML = out;
  }

  /* ------------------------------------------------------------------ *
   *  task workspace                                                     *
   * ------------------------------------------------------------------ */

  function renderTaskHeader() {
    const c = S.current;
    if (!c) return;
    const { task, active } = c;
    $('task-title').textContent = task.title;
    $('task-skill').textContent = task.skill;
    $('task-difficulty').textContent = task.difficulty;
    $('task-kind').textContent = KIND_LABEL[task.kind] || task.kind;

    const tags = $('task-tags');
    if (tags) {
      const list = task.tags || [];
      tags.innerHTML = '';
      tags.hidden = list.length === 0;
      for (const t of list.slice(0, 8)) tags.appendChild(el('span', 'chip', t));
    }

    const st = $('task-status');
    st.className = 'badge badge-success';
    if (!active) {
      const a = c.attempt;
      if (a && a.outcome === 'passed') { st.textContent = 'passed'; st.hidden = false; }
      else if (a && a.outcome === 'given_up') { st.textContent = 'gave up'; st.className = 'badge badge-danger'; st.hidden = false; }
      else st.hidden = true;
    } else {
      st.hidden = true;
    }

    const isCode = task.kind === 'code' || task.kind === 'bug';
    const isQuiz = task.kind === 'quiz';
    $('btn-run').hidden = isQuiz;
    $('btn-run-once').hidden = !isCode;
    $('btn-run').disabled = false;
    $('btn-giveup').hidden = !active;
    $('btn-pause').hidden = !active;
    updatePauseButton();
    renderTimer();
  }

  function onEditorChange() {
    scheduleSave();
    if (S.current && S.current.task.kind === 'dom') scheduleDomPreview();
  }

  function scheduleSave() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(saveAttemptCode, 700);
  }

  async function saveAttemptCode() {
    const c = S.current;
    if (!c || !c.attempt) return; // also persists edits made after the drill unlocks (improvement loop)
    const patch = { seconds: S.elapsed || c.attempt.seconds || 0 };
    if (c.task.kind === 'dom') {
      patch.code = S.editor ? S.editor.getValue() : '';
      patch.code_extra = S.cssEditor ? S.cssEditor.getValue() : '';
    } else if (S.editor) {
      patch.code = S.editor.getValue();
    }
    try { c.attempt = await DBD.db.updateAttempt(c.attempt.id, patch); } catch (e) { /* ignore */ }
  }

  function scheduleDomPreview() {
    clearTimeout(S.previewTimer);
    S.previewTimer = setTimeout(renderDomPreview, 350);
  }

  function renderDomPreview() {
    const f = $('preview-frame');
    const html = S.editor ? S.editor.getValue() : '';
    const css = S.cssEditor ? S.cssEditor.getValue() : '';
    f.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><style>' +
      css.split('</style').join('<\\/style') +
      '</style></head><body>' + html + '</body></html>';
  }

  function buildEditors() {
    const c = S.current;
    const tabs = $('editor-tabs');
    const host = $('editor-host');
    const quiz = $('quiz-host');
    const preview = $('preview-pane');
    S.editor = null; S.cssEditor = null; S.domHosts = null; S.domTab = 'html';
    host.innerHTML = '';
    host.hidden = false;
    quiz.innerHTML = '';
    quiz.hidden = true;
    preview.hidden = true;
    tabs.hidden = true;
    tabs.innerHTML = '';
    $('run-bar').hidden = true;
    $('run-host').hidden = true;
    $('run-host').innerHTML = '';

    const { task, attempt } = c;

    if (task.kind === 'code' || task.kind === 'bug') {
      const lang = task.language === 'ts' ? 'ts' : 'js';
      const code = attempt && attempt.code ? attempt.code : (task.starter_code || '');
      S.editor = DBD.createEditor(host, { language: lang, value: code, onChange: onEditorChange });
      tabs.hidden = false;
      tabs.appendChild(el('span', 'dbd-editor-tab', lang.toUpperCase()));
      if (lang === 'ts') {
        const tc = el('button', 'dbd-editor-tab', 'type-check my TS');
        tc.type = 'button';
        tc.addEventListener('click', runTypeCheck);
        tabs.appendChild(tc);
      }
      const spacer = el('div', 'spacer');
      tabs.appendChild(spacer);
      setupRunBar(task);
      return;
    }

    if (task.kind === 'dom') {
      tabs.hidden = false;
      const htmlTab = el('button', 'dbd-editor-tab is-active', 'index.html');
      const cssTab = el('button', 'dbd-editor-tab', 'styles.css');
      htmlTab.type = 'button'; cssTab.type = 'button';
      tabs.appendChild(htmlTab);
      tabs.appendChild(cssTab);

      const htmlHost = el('div');
      const cssHost = el('div');
      cssHost.hidden = true;
      htmlHost.style.flex = '1';
      cssHost.style.flex = '1';
      host.appendChild(htmlHost);
      host.appendChild(cssHost);

      const htmlVal = attempt && attempt.code ? attempt.code : (task.dom ? task.dom.html : '');
      const cssVal = attempt && attempt.code_extra ? attempt.code_extra : (task.dom ? task.dom.css : '');
      S.editor = DBD.createEditor(htmlHost, { language: 'html', value: htmlVal, onChange: onEditorChange });
      S.cssEditor = DBD.createEditor(cssHost, { language: 'css', value: cssVal, onChange: onEditorChange });
      S.domHosts = { html: htmlHost, css: cssHost };

      const switchTab = (which) => {
        S.domTab = which;
        htmlTab.classList.toggle('is-active', which === 'html');
        cssTab.classList.toggle('is-active', which === 'css');
        htmlHost.hidden = which !== 'html';
        cssHost.hidden = which !== 'css';
      };
      htmlTab.addEventListener('click', () => switchTab('html'));
      cssTab.addEventListener('click', () => switchTab('css'));

      preview.hidden = false;
      renderDomPreview();
      return;
    }

    if (task.kind === 'quiz') {
      host.hidden = true;
      quiz.hidden = false;
      renderQuiz();
    }
  }

  /* ---------------- console run (single call, with logs) ---------------- */

  function setupRunBar(task) {
    const bar = $('run-bar');
    bar.hidden = false;
    const sel = $('run-case');
    sel.innerHTML = '';
    const tests = task.tests || [];
    tests.forEach((t, i) => {
      const o = el('option');
      o.value = String(i);
      o.textContent = (i + 1) + '. ' + (t.name || ('case ' + (i + 1)));
      sel.appendChild(o);
    });
    if (tests.length) {
      sel.value = '0';
      fillRunArgs(0);
    } else {
      sel.innerHTML = '<option value="">(no cases)</option>';
      $('run-args').value = '[]';
    }
  }

  function fillRunArgs(i) {
    const c = S.current;
    if (!c || !c.task.tests || !c.task.tests[i]) return;
    $('run-args').value = JSON.stringify(c.task.tests[i].args || []);
  }

  function fmtRunValue(v) {
    if (v === undefined) return 'undefined';
    try {
      const pretty = (typeof v === 'object' && v !== null) ? 2 : 0;
      const s = JSON.stringify(v, null, pretty);
      return s === undefined ? String(v) : s;
    } catch (e) { return String(v); }
  }

  function renderRunPanel(data) {
    const host = $('run-host');
    host.hidden = false;
    host.innerHTML = '';
    if (data.running) {
      const head = el('div', 'dbd-run-head');
      head.appendChild(el('div', 'spinner'));
      head.appendChild(el('span', 'dbd-results-summary', 'Running with ' + JSON.stringify(data.args || []) + ' …'));
      host.appendChild(head);
      return;
    }
    if (data.badArgs) {
      const head = el('div', 'dbd-run-head');
      head.appendChild(el('span', 'badge badge-danger', 'args'));
      head.appendChild(el('span', 'dbd-results-summary', data.badArgs));
      host.appendChild(head);
      return;
    }
    const r = data;
    const head = el('div', 'dbd-run-head');
    if (r.fatal || r.timedOut) {
      head.appendChild(el('span', 'badge badge-danger', r.timedOut ? 'timed out' : 'runner error'));
      head.appendChild(el('span', 'dbd-results-summary', 'the code did not finish'));
    } else if (r.error) {
      head.appendChild(el('span', 'badge badge-danger', 'threw'));
      head.appendChild(el('span', 'dbd-results-summary', 'your function threw an error'));
    } else {
      head.appendChild(el('span', 'badge badge-success', 'ran'));
      head.appendChild(el('span', 'dbd-results-summary', 'returned in ' + (r.ms != null ? r.ms + ' ms' : '?') + ' — logs below'));
    }
    if (r.engine) head.appendChild(el('span', 'hint', 'runner: ' + r.engine));
    host.appendChild(head);

    if (r.fatal) host.appendChild(el('div', 'dbd-console', String(r.fatal)));
    if (r.timedOut && !r.fatal) {
      host.appendChild(el('div', 'dbd-console', 'Execution did not finish in time — likely an infinite loop (the runner was terminated).'));
    }

    if (!r.fatal && !r.timedOut) {
      const val = el('div', 'dbd-run-value' + (r.error ? ' is-error' : ''));
      val.textContent = r.error ? '✗ ' + r.error : '→ ' + fmtRunValue(r.value);
      host.appendChild(val);
    }

    const logs = r.logs || [];
    if (logs.length) {
      host.appendChild(el('div', 'dbd-pane-label', 'console'));
      const pre = el('div', 'dbd-console');
      pre.textContent = logs.join('\n');
      host.appendChild(pre);
    } else {
      host.appendChild(el('div', 'dbd-run-note', 'no console output — console.log() anything in your code and it shows up here'));
    }
    if (r.note) host.appendChild(el('div', 'dbd-run-note', r.note));
  }

  async function runOnceUI() {
    const c = S.current;
    if (!c || (c.task.kind !== 'code' && c.task.kind !== 'bug') || S.runOnceBusy) return;
    let args;
    try {
      args = JSON.parse($('run-args').value || '[]');
      if (!Array.isArray(args)) throw new Error('not an array');
    } catch (e) {
      renderRunPanel({ badArgs: 'arguments must be a JSON array — e.g. [1, "a", [2, 3]]' });
      return;
    }
    S.runOnceBusy = true;
    const btn = $('btn-run-once');
    btn.disabled = true;
    renderRunPanel({ running: true, args });
    try {
      await saveAttemptCode();
      let code = S.editor ? S.editor.getValue() : '';
      let note = '';
      if (c.task.language === 'ts') {
        const t = await DBD.ts.transpile(code);
        if (t.diagnostics && t.diagnostics.length) {
          note = 'TypeScript syntax notes: ' + t.diagnostics.slice(0, 2).map((d) => d.message).join(' · ');
        }
        code = t.js;
      }
      const res = await DBD.runner.runOnce({ code, fnName: c.task.function_name, args });
      res.note = note;
      renderRunPanel(res);
    } catch (e) {
      renderRunPanel({ fatal: String((e && e.message) || e), logs: [] });
    } finally {
      S.runOnceBusy = false;
      btn.disabled = false;
    }
  }

  function renderQuiz() {
    const c = S.current;
    const q = c.task.quiz;
    const host = $('quiz-host');
    host.innerHTML = '';
    host.appendChild(el('div', 'dbd-quiz-q', q.question));
    const opts = el('div', 'dbd-quiz-opts');
    q.options.forEach((text, i) => {
      const b = el('button', 'dbd-quiz-opt');
      b.type = 'button';
      b.textContent = String.fromCharCode(65 + i) + '. ' + text;
      if (!c.active) {
        b.disabled = true;
        if (i === q.correctIndex) b.classList.add('is-correct');
      }
      b.addEventListener('click', () => answerQuiz(i));
      opts.appendChild(b);
    });
    host.appendChild(opts);
    if (!c.active) appendQuizExplanation();
  }

  function appendQuizExplanation() {
    const q = S.current.task.quiz;
    const ex = el('div', 'dbd-quiz-explain');
    ex.textContent = q.explanation || '';
    $('quiz-host').appendChild(ex);
  }

  async function answerQuiz(index) {
    const c = S.current;
    if (!c || !c.active || !c.attempt) return;
    const q = c.task.quiz;
    const correct = index === q.correctIndex;
    $('quiz-host').querySelectorAll('.dbd-quiz-opt').forEach((b, i) => {
      b.disabled = true;
      if (i === q.correctIndex) b.classList.add('is-correct');
      if (i === index && !correct) b.classList.add('is-wrong');
    });
    appendQuizExplanation();
    c.attempt = await DBD.db.updateAttempt(c.attempt.id, {
      outcome: correct ? 'passed' : 'given_up',
      passed: correct ? 1 : 0,
      total: 1,
      runs: (c.attempt.runs || 0) + 1,
      seconds: S.elapsed || 0
    });
    c.active = false;
    S.unlocked = true;
    try { await DBD.db.notePractice(c.task.skill, correct); } catch (e) { /* ignore */ }
    stopTimer();
    renderTaskHeader();
    renderUnlock();
    updateAiPanelForTask();
    await refreshAll();
    aiLog(correct ? 'system' : 'error', correct ? 'Correct — quiz done. Streak counts.' : 'Not quite — the right answer is highlighted, with the why.');
  }

  async function runTypeCheck() {
    const c = S.current;
    if (!c || !S.editor) return;
    const src = S.editor.getValue();
    const host = $('results-host');
    host.innerHTML = '';
    const head = el('div', 'dbd-results-head');
    head.appendChild(el('div', 'spinner'));
    head.appendChild(el('span', 'dbd-results-summary', 'Loading the TypeScript compiler and checking…'));
    host.appendChild(head);
    try {
      const diags = await DBD.ts.typeCheck(src);
      host.innerHTML = '';
      const head2 = el('div', 'dbd-results-head');
      head2.appendChild(el('span', 'dbd-results-summary', 'TypeScript: ' + (diags.length ? diags.length + ' issue' + (diags.length === 1 ? '' : 's') : 'no type errors')));
      head2.appendChild(el('span', 'badge ' + (diags.length ? 'badge-warn' : 'badge-success'), diags.length ? 'strict mode' : 'clean'));
      host.appendChild(head2);
      diags.slice(0, 20).forEach((d) => {
        const row = el('div', 'dbd-test-row is-fail');
        row.appendChild(el('div', 'dbd-test-icon', '!'));
        const body = el('div', 'dbd-test-body');
        body.appendChild(el('div', 'dbd-test-name', 'line ' + d.line + ':' + d.column));
        body.appendChild(el('div', 'dbd-test-detail', d.message + ' (TS' + d.code + ')'));
        row.appendChild(body);
        host.appendChild(row);
      });
      updateStatusline();
    } catch (e) {
      host.innerHTML = '';
      const head2 = el('div', 'dbd-results-head');
      head2.appendChild(el('span', 'dbd-results-summary', 'Type-check unavailable'));
      host.appendChild(head2);
      host.appendChild(el('div', 'dbd-console', String((e && e.message) || e)));
      aiLog('error', 'TypeScript compiler could not load: ' + ((e && e.message) || e));
    }
  }

  /* ------------------------------------------------------------------ *
   *  running tests                                                      *
   * ------------------------------------------------------------------ */

  function renderRunning(on) {
    if (!on) return;
    const host = $('results-host');
    host.innerHTML = '';
    const head = el('div', 'dbd-results-head');
    head.appendChild(el('div', 'spinner'));
    head.appendChild(el('span', 'dbd-results-summary', 'Running your code…'));
    host.appendChild(head);
  }

  function describeAssertion(r) {
    if (r.kind === 'exists') return (r.expected ? 'exists: ' : 'absent: ') + r.selector;
    if (r.kind === 'count') return r.selector + ' → count ' + r.expected;
    if (r.kind === 'computedStyle') return r.selector + ' { ' + r.property + ': ' + r.expected + ' }';
    if (r.kind === 'text') return r.selector + ' text = "' + r.expected + '"';
    if (r.kind === 'attr') return r.selector + '[' + r.attr + '] = "' + r.expected + '"';
    return 'check';
  }

  function renderResults(res, extra) {
    extra = extra || {};
    const host = $('results-host');
    host.innerHTML = '';
    if (!res) {
      const empty = el('div', 'empty');
      empty.appendChild(el('div', 'empty-title', 'No test run yet'));
      const t = el('div', 'empty-text');
      const isQuiz = !!(S.current && S.current.task && S.current.task.kind === 'quiz');
      t.innerHTML = isQuiz
        ? 'This drill is a quiz — no tests to run. Answer the question on the left.'
        : 'Write your solution, then hit <strong>Run all tests</strong> (⌘/Ctrl + Enter).';
      empty.appendChild(t);
      host.appendChild(empty);
      return;
    }

    const list = res.results || [];
    const passed = list.filter((r) => r.passed).length;
    const total = list.length;
    const fatal = res.fatal || res.timedOut;
    const head = el('div', 'dbd-results-head');
    head.appendChild(el('span', 'dbd-results-summary', total ? 'Run: ' + passed + '/' + total + ' passed' : 'Run failed'));
    const badgeTxt = fatal ? 'runner problem' : (total && passed === total ? 'all green' : 'keep going');
    head.appendChild(el('span', 'badge ' + (fatal ? 'badge-danger' : (total && passed === total ? 'badge-success' : 'badge-warn')), badgeTxt));
    if (res.engine) head.appendChild(el('span', 'hint', 'runner: ' + res.engine));
    host.appendChild(head);

    if (res.fatal) {
      host.appendChild(el('div', 'dbd-console', String(res.fatal)));
    }
    if (res.timedOut) {
      host.appendChild(el('div', 'dbd-run-note', 'The run was cut off after the time limit — likely an infinite loop. Fix the loop and run again.'));
    }

    for (const r of list) {
      const cls = r.passed ? 'is-pass' : (r.timeout ? 'is-timeout' : 'is-fail');
      const row = el('div', 'dbd-test-row ' + cls);
      row.appendChild(el('div', 'dbd-test-icon', r.passed ? '✓' : (r.timeout ? '⏱' : '✗')));
      const body = el('div', 'dbd-test-body');
      body.appendChild(el('div', 'dbd-test-name', r.name || describeAssertion(r)));
      if (!r.passed) {
        const detail = el('div', 'dbd-test-detail');
        if (r.error) {
          detail.textContent = 'error: ' + r.error;
        } else if (r.kind) {
          detail.textContent = 'expected ' + fmtVal(r.expected) + ' · got ' + fmtVal(r.actual) + (r.selector ? ' (' + r.selector + ')' : '');
        } else {
          detail.textContent = 'expected ' + fmtVal(r.expected) + ' · got ' + fmtVal(r.actual);
        }
        body.appendChild(detail);
      }
      row.appendChild(body);
      host.appendChild(row);
    }

    if (res.logs && res.logs.length) {
      const det = el('details');
      det.appendChild(el('summary', null, 'console output (' + res.logs.length + ')'));
      const pre = el('div', 'dbd-console', res.logs.join('\n'));
      det.appendChild(pre);
      host.appendChild(det);
    }
    if (extra.note) host.appendChild(el('div', 'dbd-run-note', extra.note));
  }

  async function runCurrent() {
    const c = S.current;
    if (!c || S.running) return; // re-runs are allowed after unlock (improve → re-test loop)
    S.running = true;
    $('btn-run').disabled = true;
    try {
      if (c.task.kind === 'dom') await runDom();
      else await runCode();
    } catch (e) {
      renderResults({ fatal: String((e && e.message) || e), results: [] });
    } finally {
      S.running = false;
      $('btn-run').disabled = !S.current;
    }
  }

  async function runCode() {
    const c = S.current;
    let code = S.editor ? S.editor.getValue() : '';
    const rawCode = code;
    let note = '';
    if (c.task.language === 'ts') {
      const t = await DBD.ts.transpile(code);
      if (t.diagnostics && t.diagnostics.length) {
        note = 'TypeScript syntax notes: ' + t.diagnostics.slice(0, 2).map((d) => d.message).join(' · ');
      }
      code = t.js;
    }
    renderRunning(true);
    const res = await DBD.runner.runCodeTests({ code, fnName: c.task.function_name, tests: c.task.tests || [] });
    S.lastResults = res;
    renderResults(res, { note });
    const list = res.results || [];
    const passed = list.filter((r) => r.passed).length;
    const total = list.length;
    c.attempt = await DBD.db.updateAttempt(c.attempt.id, {
      runs: (c.attempt.runs || 0) + 1,
      passed, total,
      seconds: S.elapsed || 0,
      code: rawCode
    });
    const allPassed = total > 0 && passed === total && !res.fatal && !res.timedOut;
    if (allPassed) await completeAttempt(true);
  }

  async function runDom() {
    const c = S.current;
    const html = S.editor ? S.editor.getValue() : '';
    const css = S.cssEditor ? S.cssEditor.getValue() : '';
    renderRunning(true);
    const res = await DBD.runner.runDomChecks({ html, css, assertions: c.task.dom.assertions || [] });
    S.lastResults = res;
    renderResults(res);
    const list = res.results || [];
    const passed = list.filter((r) => r.passed).length;
    const total = list.length;
    c.attempt = await DBD.db.updateAttempt(c.attempt.id, {
      runs: (c.attempt.runs || 0) + 1,
      passed, total,
      seconds: S.elapsed || 0,
      code: html, code_extra: css
    });
    const allPassed = total > 0 && passed === total && !res.fatal && !res.timedOut;
    if (allPassed) await completeAttempt(true);
  }

  async function completeAttempt(passed) {
    const c = S.current;
    if (!c || !c.attempt) return;
    c.attempt = await DBD.db.updateAttempt(c.attempt.id, {
      outcome: passed ? 'passed' : 'given_up',
      seconds: S.elapsed || 0
    });
    c.active = false;
    S.unlocked = true;
    try { await DBD.db.notePractice(c.task.skill, passed); } catch (e) { /* ignore */ }
    stopTimer();
    renderTaskHeader();
    renderUnlock();
    updateAiPanelForTask();
    await refreshAll();
    aiLog(passed ? 'system' : 'error', passed
      ? 'All checks passed — nice. The reference solution and an AI review are unlocked. Keep editing if you want to polish it — Run all tests and the review still work.'
      : 'Attempt closed. The reference solution and review are unlocked whenever you want them — you can still fix the code and run the tests again.');
  }

  async function giveUp() {
    const c = S.current;
    if (!c || !c.active) return;
    const ok = await confirmModal({
      title: 'Give up on this drill?',
      body: 'It is recorded as a struggle for ' + c.task.skill + ' — which is useful data. The reference solution and AI review unlock, and you can retry from history any time.',
      confirmLabel: 'Give up',
      danger: true
    });
    if (!ok) return;
    await completeAttempt(false);
  }

  /* ------------------------------------------------------------------ *
   *  unlock panel                                                       *
   * ------------------------------------------------------------------ */

  function renderUnlock() {
    const host = $('unlock-panel');
    const c = S.current;
    host.hidden = !S.unlocked || !c;
    if (!c || !S.unlocked) {
      const ro = $('review-out');
      if (ro) { ro.hidden = true; ro.innerHTML = ''; }
      return;
    }
    const isQuiz = c.task.kind === 'quiz';
    $('btn-reveal-solution').hidden = isQuiz;
    $('btn-show-explanation').hidden = isQuiz || !c.task.explanation;
    $('btn-ai-review').hidden = isQuiz;
    const title = $('unlock-title');
    const sub = $('unlock-sub');
    const a = c.attempt;
    if (a && a.outcome === 'passed') {
      title.textContent = 'Passed — nice work';
      sub.textContent = 'Reference solution and AI review are unlocked.';
    } else {
      title.textContent = 'Unlocked';
      sub.textContent = 'This round is recorded — the solution is worth a read.';
    }
    $('solution-wrap').hidden = true;
    $('solution-wrap').innerHTML = '';
    const oldRetry = $('btn-retry');
    if (oldRetry) oldRetry.remove();
  }

  function revealSolution() {
    const c = S.current;
    if (!c) return;
    const wrap = $('solution-wrap');
    wrap.hidden = false;
    wrap.innerHTML = '';
    if (c.task.kind === 'dom') {
      wrap.appendChild(el('div', 'dbd-pane-label', 'Reference solution — HTML + CSS'));
      const pre = el('pre', 'code-block');
      pre.innerHTML = DBD.highlight(c.task.solution || '(no solution stored)', 'html');
      wrap.appendChild(pre);
    } else {
      wrap.appendChild(el('div', 'dbd-pane-label', 'Reference solution'));
      const pre = el('pre', 'code-block');
      const lang = c.task.language === 'ts' ? 'ts' : 'js';
      pre.innerHTML = DBD.highlight(c.task.solution || '(no solution stored)', lang);
      wrap.appendChild(pre);
    }
  }

  function toggleExplanation() {
    const c = S.current;
    if (!c) return;
    const wrap = $('solution-wrap');
    wrap.hidden = false;
    const existing = wrap.querySelector('.dbd-explain-block');
    if (existing) { existing.remove(); return; }
    wrap.appendChild(el('div', 'dbd-run-note dbd-explain-block', c.task.explanation || ''));
  }

  async function requestReview() {
    const c = S.current;
    if (!c || !S.unlocked || S.aiBusy) return;
    if (!S.model) { aiLog('error', 'No AI model is available — check ChatOSS Models first.'); return; }
    S.aiBusy = true;

    const code = c.task.kind === 'dom'
      ? (S.editor ? S.editor.getValue() : '') + '\n\n/* ---------- styles.css ---------- */\n\n' + (S.cssEditor ? S.cssEditor.getValue() : '')
      : (S.editor ? S.editor.getValue() : ((c.attempt && c.attempt.code) || ''));
    const summary = S.lastResults
      ? ((S.lastResults.results || []).filter((r) => r.passed).length + '/' + (S.lastResults.results || []).length + ' passed')
      : (c.attempt ? c.attempt.passed + '/' + c.attempt.total + ' passed (last run)' : 'not run');

    // In the task screen the AI panel is hidden, so reviews stream into the console
    // column's review block; on the home screen they go to the AI log as usual.
    let headNode;
    let bodyNode;
    const out = $('review-out');
    if (S.view === 'task' && out) {
      // keep previous reviews — each new one appends below (improvement loop)
      if (out.childNodes.length) out.appendChild(el('hr'));
      out.hidden = false;
      headNode = el('div', 'dbd-pane-label', 'AI review · reviewing…');
      bodyNode = el('div', 'dbd-review-body', '…');
      out.appendChild(headNode);
      out.appendChild(bodyNode);
      out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      const msg = aiLog('assistant', 'Reviewing your code…');
      headNode = msg._role;
      bodyNode = msg._body;
    }
    try {
      await DBD.ai.reviewAttempt({
        model: S.model,
        task: c.task,
        code,
        resultsSummary: summary,
        onStream: (txt) => { bodyNode.textContent = txt; }
      });
      headNode.textContent = 'AI review';
    } catch (e) {
      headNode.textContent = 'AI review — failed';
      headNode.classList.add('is-error');
      bodyNode.textContent = 'Review failed: ' + ((e && e.message) || e);
    } finally {
      S.aiBusy = false;
    }
  }

  /* ------------------------------------------------------------------ *
   *  task opening / generation                                          *
   * ------------------------------------------------------------------ */

  async function openTask(task, attempt) {
    const active = !!(attempt && attempt.outcome === 'in_progress');
    S.current = { task, attempt, active };
    S.unlocked = !active;
    S.baseSeconds = (attempt && attempt.seconds) || 0;
    S.resumedAt = Date.now();
    S.lastResults = null;
    S.elapsed = S.baseSeconds;
    S.paused = false;

    renderTaskHeader();
    renderMarkdownLite($('task-prompt'), task.prompt);
    buildEditors();
    renderResults(null);
    renderUnlock();
    updateAiPanelForTask();
    showView('task');
    if (active) startTimer(); else { stopTimer(); renderTimer(); }
  }

  async function openTaskFromHistory(taskId) {
    await saveAttemptCode();
    const task = await DBD.db.getTask(taskId);
    if (!task) return;
    const open = await DBD.db.latestOpenAttemptForTask(taskId);
    const latest = open || await DBD.db.latestAttemptForTask(taskId);
    if (!open && latest) {
      // finished drill: show it unlocked, with a retry path
      await openTask(task, latest);
      $('unlock-sub').textContent = 'This drill is finished — retry it to start a fresh attempt with your old code pre-filled.';
      const btn = el('button', 'btn btn-primary', 'Retry this drill');
      btn.id = 'btn-retry';
      btn.addEventListener('click', async () => {
        const att = await DBD.db.createAttempt(task.id);
        await openTask(task, att);
        if (S.editor && latest.code) S.editor.setValue(latest.code);
        if (S.cssEditor && latest.code_extra) S.cssEditor.setValue(latest.code_extra);
        if (task.kind === 'dom') renderDomPreview();
      });
      const actions = $('unlock-panel').querySelector('.dbd-unlock-actions');
      const spacerEl = actions ? actions.querySelector('.spacer') : null;
      if (actions && spacerEl) actions.insertBefore(btn, spacerEl);
      else $('unlock-panel').appendChild(btn);
      return;
    }
    await openTask(task, latest);
  }

  function pickMostRotten() {
    if (!S.skills.length) return null;
    let best = null;
    for (const s of S.skills) {
      const score = rotInfo(s).score;
      if (!best || score > best.score) best = { skill: s, score };
    }
    return best ? best.skill : null;
  }

  const NON_RUNNABLE = ['React', 'Next.js', 'Node.js', 'Tailwind CSS', 'React Native (Expo)'];

  function autoKindFor(skillName, previous) {
    if (skillName === 'HTML' || skillName === 'CSS') return 'dom';
    if (NON_RUNNABLE.indexOf(skillName) !== -1) return 'quiz';
    const recent = (previous || []).filter((p) => p.skill === skillName).slice(0, 2);
    if (recent.length === 2 && recent.every((p) => p.kind === 'code')) return 'bug';
    return 'code';
  }

  function setGenStatus(text, isErr) {
    const n = $('generate-status');
    n.textContent = text || '';
    n.style.color = isErr ? 'var(--danger)' : '';
  }

  async function generateDrill() {
    if (S.aiBusy) return;
    if (!window.chatoss || !window.chatoss.chat) { setGenStatus('Chat API unavailable.', true); return; }
    if (!S.model) { setGenStatus('No AI model available — check ChatOSS Models.', true); return; }

    const skillName = $('req-skill').value;
    const difficulty = $('req-difficulty').value;
    const kindChoice = $('req-kind').value;
    const note = $('req-note').value.trim();

    S.aiBusy = true;
    $('btn-generate').disabled = true;
    $('generate-spinner').hidden = false;
    setGenStatus('drafting…');

    try {
      const skill = skillName === '__auto__' ? pickMostRotten() : (S.skills.find((s) => s.name === skillName) || pickMostRotten());
      const previous = (await DBD.db.listPreviousBriefs(30)).map((p) => {
        let tags = [];
        try { tags = JSON.parse(p.tags || '[]'); } catch (e) { /* ignore */ }
        return { title: p.title, skill: p.skill, kind: p.kind, tags };
      });
      const kind = kindChoice === 'auto' ? autoKindFor(skill ? skill.name : '', previous) : kindChoice;

      const msg = aiLog('assistant', 'Drafting your next drill…');
      const draft = el('div', 'dbd-draft is-live');
      msg.appendChild(draft);
      let seen = 0;

      const gen = async (extraNote) => {
        const { task } = await DBD.ai.generateTask({
          model: S.model,
          skills: S.skills,
          previous,
          request: {
            skill: skill ? skill.name : '',
            difficulty,
            kind,
            note: extraNote ? (note ? note + '. ' + extraNote : extraNote) : note
          },
          onStream: (txt) => {
            seen = txt.length;
            draft.textContent = txt.slice(-1600);
          }
        });
        return task;
      };

      let task = await gen('');
      draft.classList.remove('is-live');
      draft.textContent = '✓ draft accepted (' + seen + ' chars)';

      let fp = DBD.ai.fingerprintOf(task);
      const clash = await DBD.db.findByFingerprint(fp);
      if (clash) {
        aiLog('system', 'Title collided with an existing drill — asking for a fresh scenario…');
        task = await gen('The title "' + task.title + '" is already used by a stored drill. Invent a completely different scenario and title.');
        fp = DBD.ai.fingerprintOf(task);
      }

      const taskId = await DBD.db.insertTask(Object.assign({}, task, {
        fingerprint: fp,
        model: S.model,
        request: note
      }));
      const attempt = await DBD.db.createAttempt(taskId);
      const fullTask = await DBD.db.getTask(taskId);
      msg._role.textContent = 'drill';
      msg._body.textContent = 'New drill ready: “' + fullTask.title + '” — ' + fullTask.skill + ', ' + fullTask.difficulty + ', ' + KIND_LABEL[fullTask.kind] + '. Good luck — no help until you pass or give up.';

      $('req-note').value = '';
      setGenStatus('');
      await refreshAll();
      await openTask(fullTask, attempt);
    } catch (e) {
      const em = aiLog('error', 'Generation failed: ' + ((e && e.message) || e));
      if (e && e.raw) {
        const pre = el('div', 'dbd-draft');
        pre.textContent = String(e.raw).slice(0, 1200);
        em.appendChild(pre);
      }
      setGenStatus('generation failed — see the AI panel', true);
    } finally {
      S.aiBusy = false;
      $('btn-generate').disabled = false;
      $('generate-spinner').hidden = true;
    }
  }

  async function leaveTask() {
    await saveAttemptCode();
    showView('dashboard');
    S.current = null;
    stopTimer();
    updateAiPanelForTask();
    await refreshAll();
  }

  /* ------------------------------------------------------------------ *
   *  skills modal                                                       *
   * ------------------------------------------------------------------ */

  let skillEditing = null;

  function openSkillModal(skill) {
    skillEditing = skill || null;
    $('skill-modal-title').textContent = skill ? 'Edit skill' : 'Add skill';
    $('skill-name').value = skill ? skill.name : '';
    $('skill-level').value = skill ? skill.level : 'rusty';
    $('skill-notes').value = skill ? (skill.notes || '') : '';
    $('skill-delete').hidden = !skill;
    $('modal-skill').hidden = false;
    $('skill-name').focus();
  }

  async function saveSkill() {
    const name = $('skill-name').value.trim();
    if (!name) return;
    const level = $('skill-level').value;
    const notes = $('skill-notes').value.trim();
    try {
      if (skillEditing) await DBD.db.updateSkill(skillEditing.id, name, level, notes);
      else await DBD.db.addSkill(name, level, notes);
      $('modal-skill').hidden = true;
      await refreshAll();
    } catch (e) {
      aiLog('error', 'Could not save the skill: ' + ((e && e.message) || e));
    }
  }

  async function deleteSkillNow() {
    if (!skillEditing) return;
    const ok = await confirmModal({
      title: 'Delete “' + skillEditing.name + '”?',
      body: 'Past drills stay in history, but the skill leaves the radar and future prompts.',
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    try {
      await DBD.db.deleteSkill(skillEditing.id);
      $('modal-skill').hidden = true;
      await refreshAll();
    } catch (e) {
      aiLog('error', 'Could not delete: ' + ((e && e.message) || e));
    }
  }

  /* ------------------------------------------------------------------ *
   *  settings                                                           *
   * ------------------------------------------------------------------ */

  async function loadSettings() {
    try {
      const s = await chatoss.scopedData.get('dbd.settings');
      if (s && typeof s === 'object') S.settings = Object.assign({ nudgeEnabled: true, model: null }, s);
    } catch (e) { /* defaults */ }
  }

  async function saveSettings(patch) {
    S.settings = Object.assign({}, S.settings, patch);
    try { await chatoss.scopedData.set('dbd.settings', S.settings); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ *
   *  layout — console width (corner drag grips) + layout reset          *
   * ------------------------------------------------------------------ */

  function layout() {
    if (!S.settings.layout || typeof S.settings.layout !== 'object') S.settings.layout = {};
    return S.settings.layout;
  }

  function sanitizeLayout() {
    const L = (S.settings.layout && typeof S.settings.layout === 'object') ? S.settings.layout : {};
    const w = Number(L.consoleWidth);
    const out = {};
    if (Number.isFinite(w) && w >= 240 && w <= 1100) out.consoleWidth = Math.round(w);
    S.settings.layout = out;
  }

  function saveLayout() {
    saveSettings({ layout: layout() });
  }

  function applyConsoleWidth() {
    const col = $('console-col');
    if (!col) return;
    const saved = Number(layout().consoleWidth) || 400;
    const w = Math.max(300, Math.min(saved, Math.max(340, window.innerWidth - 620)));
    col.style.width = w + 'px';
  }

  function wipeLayout() {
    confirmModal({
      title: 'Reset the saved layout?',
      body: 'This clears the saved console width for this app (one number). Data and skills are untouched.',
      confirmLabel: 'Reset layout',
      danger: false
    }).then(async (ok) => {
      if (!ok) return;
      S.settings.layout = {};
      await saveSettings({ layout: {} });
      applyConsoleWidth();
      aiLog('system', 'Layout state reset.');
      if ($('modal-settings')) $('modal-settings').hidden = true;
    });
  }

  function wireGrip(el) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      const col = $('console-col');
      if (!col || S.view !== 'task') return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = col.getBoundingClientRect().width;
      document.body.classList.add('dbd-resizing');
      const onMove = (me) => {
        // the divider follows the pointer: drag left grows the console
        let w = startW - (me.clientX - startX);
        w = Math.max(300, Math.min(w, Math.max(340, window.innerWidth - 620)));
        col.style.width = Math.round(w) + 'px';
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.classList.remove('dbd-resizing');
        const w = Math.round(col.getBoundingClientRect().width);
        if (w > 0) {
          layout().consoleWidth = w;
          saveLayout();
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  /* ------------------------------------------------------------------ *
   *  first-run onboarding — pick the skills for the dashboard           *
   * ------------------------------------------------------------------ */

  function onboardToggleEl(name) {
    const b = el('button', 'dbd-onboard-toggle', '');
    b.type = 'button';
    b.dataset.name = name;
    b.appendChild(el('span', 'dbd-ob-check', '✓'));
    b.appendChild(el('span', 'dbd-ob-name', name));
    return b;
  }

  function renderOnboardSelection() {
    const sel = (S.onboard && S.onboard.sel) || new Set();
    document.querySelectorAll('.dbd-onboard-toggle').forEach((b) => {
      b.classList.toggle('is-on', sel.has(b.dataset.name));
    });
    $('onboard-count').textContent = sel.size + ' selected';
    $('onboard-start').disabled = sel.size === 0;
  }

  async function showOnboard() {
    const current = await DBD.db.listSkills();
    // Existing installs see their own dashboard pre-checked; a fresh install starts
    // with nothing selected so the choice is deliberate.
    S.onboard = { sel: new Set(current.map((s) => s.name)) };
    const gridL = $('onboard-langs');
    const gridW = $('onboard-web');
    gridL.innerHTML = '';
    gridW.innerHTML = '';
    for (const s of DBD.db.seedSkills()) {
      (s.group === 'lang' ? gridL : gridW).appendChild(onboardToggleEl(s.name));
    }
    renderOnboardSelection();
    $('onboard').hidden = false;
  }

  function onOnboardToggle(e) {
    const b = e.target && e.target.closest ? e.target.closest('.dbd-onboard-toggle') : null;
    if (!b || !S.onboard) return;
    const n = b.dataset.name;
    if (S.onboard.sel.has(n)) S.onboard.sel.delete(n);
    else S.onboard.sel.add(n);
    renderOnboardSelection();
  }

  async function finishOnboarding() {
    if (!S.onboard || S.onboard.sel.size === 0) return;
    const btn = $('onboard-start');
    btn.disabled = true;
    try {
      await DBD.db.applyOnboarding(Array.from(S.onboard.sel));
    } catch (e) {
      aiLog('error', 'Could not save your skill selection: ' + ((e && e.message) || e));
      btn.disabled = false;
      return;
    }
    const n = S.onboard.sel.size;
    S.onboard = null;
    $('onboard').hidden = true;
    await refreshAll();
    showView('dashboard');
    aiLog('system', 'Your practice dashboard is ready — ' + n + ' skill' + (n === 1 ? '' : 's') + '. Add or remove skills any time: ＋ add in the sidebar, or click a skill to edit it.');
  }

  function openSettingsModal() {
    $('set-nudge').checked = S.settings.nudgeEnabled !== false;
    $('modal-settings').hidden = false;
  }

  async function runEnvCheck() {
    const log = $('envcheck-log');
    log.textContent = 'checking…';
    const lines = [];
    try {
      const codeEngine = await DBD.runner.detectCodeEngine();
      lines.push('code runner engine: ' + codeEngine);
      if (codeEngine !== 'none') {
        const r = await DBD.runner.runCodeTests({
          code: 'function add(a, b) { return a + b; }',
          fnName: 'add',
          tests: [{ name: '2 + 3 = 5', args: [2, 3], expected: 5 }],
          perTestMs: 3000,
          hardMs: 6000
        });
        const ok = r.results && r.results[0] && r.results[0].passed;
        lines.push('  sample test run: ' + (ok ? 'PASS' : 'FAIL' + (r.fatal ? ' — ' + r.fatal : '')));
      }
      const domEngine = await DBD.runner.detectDomEngine();
      lines.push('html/css checker: ' + domEngine);
      if (domEngine === 'iframe') {
        const r = await DBD.runner.runDomChecks({
          html: '<div class="a"></div>',
          css: '.a { display: flex; }',
          assertions: [
            { type: 'exists', selector: '.a', expected: true },
            { type: 'computedStyle', selector: '.a', property: 'display', expected: 'flex' }
          ]
        });
        const ok = (r.results || []).length === 2 && (r.results || []).every((x) => x.passed);
        lines.push('  sample style checks: ' + (ok ? 'PASS' : 'FAIL'));
      }
      try {
        const ts = await DBD.ts.ensureLoaded();
        lines.push('typescript compiler: loaded (v' + (ts.version || '?') + ')');
        const tc = await DBD.ts.typeCheck('const x: number = "nope";\nexport {};');
        lines.push('  sample type check: ' + (tc.length ? 'PASS — caught: ' + tc[0].message : 'FAIL — no diagnostics returned'));
      } catch (e) {
        lines.push('typescript compiler: FAILED — ' + ((e && e.message) || e));
      }
    } catch (e) {
      lines.push('environment check error: ' + ((e && e.message) || e));
    }
    log.textContent = lines.join('\n');
    updateStatusline();
  }

  async function resetAllData() {
    const ok = await confirmModal({
      title: 'Erase ALL data?',
      body: 'Every drill, attempt and skill in the local database is deleted, and the skill picker opens so you can choose a fresh set. This cannot be undone.',
      confirmLabel: 'Erase everything',
      danger: true
    });
    if (!ok) return;
    try {
      await DBD.db.eraseAll();
      await refreshAll();
      $('modal-settings').hidden = true;
      await showOnboard();
      aiLog('system', 'All data erased — pick the skills for your fresh start.');
    } catch (e) {
      aiLog('error', 'Could not erase data: ' + ((e && e.message) || e));
    }
  }

  /* ------------------------------------------------------------------ *
   *  statusline                                                         *
   * ------------------------------------------------------------------ */

  function updateStatusline() {
    const ri = DBD.runner.info;
    const tsStateCheck = () => {
      if (window.ts && window.ts.transpileModule) return 'bundled';
      if (DBD.ts.status.status === 'failed') return 'failed';
      return DBD.ts.status.status === 'ready' ? 'bundled' : 'loading…';
    };
    const parts = [
      DBD.db.isReady() ? 'sqlite ✓' : 'sqlite …',
      'runner: ' + (ri.code || '…'),
      'dom: ' + (ri.dom || '…'),
      'ts: ' + tsStateCheck()
    ];
    $('statusline').textContent = parts.join(' · ');
  }

  /* ------------------------------------------------------------------ *
   *  background task (daily nudge)                                      *
   * ------------------------------------------------------------------ */

  async function onBackgroundTask(taskId) {
    if (taskId !== 'daily-nudge') return;
    try {
      if (!DBD.db.isReady()) await DBD.db.init();
      const settings = (await window.chatoss.scopedData.get('dbd.settings')) || {};
      if (settings.nudgeEnabled === false) return;

      const dates = await DBD.db.completedAttemptDates(120);
      const todayKey = localDateKey(new Date().toISOString());
      if (dates.some((r) => localDateKey(r.updated_at) === todayKey)) return; // already practiced today

      const skills = await DBD.db.listSkills();
      if (!skills.length) return;
      let pick = null;
      for (const s of skills) {
        const d = DBD.ai.daysSince(s.last_practiced_at);
        const score = d == null ? 1e6 : d;
        if (!pick || score > pick.score) pick = { skill: s, score, d };
      }
      if (!pick) return;
      if (pick.d != null && pick.d < 2) return; // practiced recently enough — don't nag

      const body = pick.d == null
        ? "You've never drilled " + pick.skill.name + " here. Five minutes?"
        : "It's been " + pick.d + " days since you practiced " + pick.skill.name + ". Five minutes?";
      await window.chatoss.notifications.send({ title: "Don't Be Dumb — skill rot check", body });
    } catch (e) { /* a failed nudge is not worth a crash */ }
  }

  /* ------------------------------------------------------------------ *
   *  wiring                                                             *
   * ------------------------------------------------------------------ */

  function wireEvents() {
    $('btn-generate').onclick = generateDrill;
    $('btn-run').onclick = runCurrent;
    $('btn-giveup').onclick = giveUp;
    $('btn-back').onclick = leaveTask;
    $('btn-next').onclick = leaveTask;
    $('btn-add-skill').onclick = () => openSkillModal(null);
    $('btn-settings').onclick = openSettingsModal;
    $('btn-reveal-solution').onclick = revealSolution;
    $('btn-show-explanation').onclick = toggleExplanation;
    $('btn-ai-review').onclick = requestReview;

    $('btn-run-once').onclick = runOnceUI;
    $('run-case').onchange = () => fillRunArgs(parseInt($('run-case').value, 10) || 0);
    $('run-args').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runOnceUI();
      }
    });

    $('btn-pause').onclick = togglePause;
    $('btn-wipe-layout').onclick = wipeLayout;
    $('onboard-langs').addEventListener('click', onOnboardToggle);
    $('onboard-web').addEventListener('click', onOnboardToggle);
    $('onboard-clear').onclick = () => { if (S.onboard) { S.onboard.sel.clear(); renderOnboardSelection(); } };
    $('onboard-start').onclick = finishOnboarding;
    wireGrip($('grip-code'));
    wireGrip($('grip-console'));
    window.addEventListener('resize', applyConsoleWidth);

    $('model-select').onchange = () => {
      S.model = $('model-select').value || null;
      saveSettings({ model: S.model });
      updateStatusline();
    };

    $('skill-save').onclick = saveSkill;
    $('skill-cancel').onclick = () => { $('modal-skill').hidden = true; };
    $('skill-x').onclick = () => { $('modal-skill').hidden = true; };
    $('skill-delete').onclick = deleteSkillNow;

    $('settings-close').onclick = () => { $('modal-settings').hidden = true; };
    $('settings-x').onclick = () => { $('modal-settings').hidden = true; };
    $('set-nudge').onchange = () => saveSettings({ nudgeEnabled: $('set-nudge').checked });
    $('btn-envcheck').onclick = runEnvCheck;
    $('btn-reset').onclick = resetAllData;

    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (S.view === 'task' && S.current && S.current.active) {
          e.preventDefault();
          runCurrent();
        }
      }
    });

    // after the deferred TS bundles have executed, refresh the statusline
    window.addEventListener('load', updateStatusline);
  }

  /* ------------------------------------------------------------------ *
   *  boot                                                               *
   * ------------------------------------------------------------------ */

  function showFatal(msg) {
    document.body.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.padding = '40px';
    const h = document.createElement('h2');
    h.textContent = "Don't Be Dumb";
    const p = document.createElement('p');
    p.textContent = msg;
    wrap.appendChild(h);
    wrap.appendChild(p);
    document.body.appendChild(wrap);
  }

  async function boot() {
    const hasBridge = !!(window.chatoss && window.chatoss.chat && window.chatoss.db);

    // Register the background handler on EVERY boot (headless runs included).
    if (window.chatoss && window.chatoss.background) {
      try { window.chatoss.background.onTask(onBackgroundTask); } catch (e) { /* ignore */ }
      try { S.headless = await window.chatoss.background.isHeadlessRun(); } catch (e) { S.headless = false; }
    }
    if (S.headless) return; // headless boot: handler registered, nothing else to do

    if (!hasBridge) {
      showFatal('The ChatOSS bridge is unavailable, so drills cannot run here. Open this app inside ChatOSS.');
      return;
    }

    $('statusline').textContent = 'booting…';





    try {
      await DBD.db.init();
    } catch (e) {
      showFatal('Database error: ' + ((e && e.message) || e));
      return;
    }

    await loadSettings();
    sanitizeLayout();
    wireEvents();
    applyConsoleWidth();
    updateStatusline();
    aiLog('system', "Ready. Drills are written by the AI model up top, stored in your local SQLite database, and every past title is fed back to the generator so nothing repeats.");

    try {
      await refreshAll();
    } catch (e) { /* non-fatal */ }

    await loadModels();
    showView('dashboard');
    try {
      if (!(await DBD.db.getMeta('onboarded'))) await showOnboard();
    } catch (e) { /* non-fatal — the dashboard still works */ }
    updateAiPanelForTask();

    // async probes (statusline only)
    DBD.runner.detectCodeEngine().then(updateStatusline).catch(updateStatusline);
    DBD.runner.detectDomEngine().then(updateStatusline).catch(updateStatusline);

    S.booted = true;
  }

  async function loadModels() {
    const sel = $('model-select');
    try {
      S.models = await window.chatoss.chat.listModels();
      let def = null;
      try { def = await window.chatoss.chat.getDefaultModel(); } catch (e) { def = null; }
      sel.innerHTML = '';
      for (const m of (S.models || [])) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name + (m.available === false ? ' (unavailable)' : '');
        opt.disabled = m.available === false;
        sel.appendChild(opt);
      }
      const want = S.settings.model || def;
      if (want) sel.value = want;
      if (!sel.value && sel.options.length) {
        const firstOk = Array.from(sel.options).find((o) => !o.disabled);
        if (firstOk) sel.value = firstOk.value;
      }
      S.model = sel.value || null;
    } catch (e) {
      sel.innerHTML = '<option value="">no models available</option>';
      S.model = null;
    }
  }

  // Called directly: this script is the last element in <body>, so every element
  // above it is parsed. (The deferred TypeScript bundles execute after parsing —
  // the TS helpers wait for them, the app never blocks on them.)
  boot();
})();
