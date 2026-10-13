/*
 * Don't Be Dumb — AI layer.
 * Builds the drill-author prompt (with the full "do not repeat" history), parses
 * and validates the strict-JSON reply, and streams reviews. Uses window.chatoss.chat.
 */
(function () {
  'use strict';

  const DBD = (window.DBD = window.DBD || {});
  const chat = () => window.chatoss.chat;

  /* ------------------------------------------------------------------ *
   *  The drill author system prompt                                     *
   * ------------------------------------------------------------------ */

  const GENERATOR_SYSTEM = [
    'You are DRILLSMITH, the exercise author for "Don\'t Be Dumb" — a skill-maintenance trainer for a senior full-stack engineer (web background: JavaScript, TypeScript, React, Node) who is brushing up across many languages and refuses to forget what they know.',
    '',
    'You write ONE training drill per request, calibrated to an interview-style difficulty: self-contained, deterministic, and runnable entirely inside a browser sandbox with no npm packages, no network, and no shell.',
    '',
    'OUTPUT FORMAT — read carefully:',
    '- Respond with a SINGLE JSON object and nothing else. No markdown fences, no commentary before or after.',
    '- Every string must be valid JSON (escape newlines as \\n, quotes as \\").',
    '',
    'All drills share these fields:',
    '{',
    '  "kind": "code" | "bug" | "dom" | "quiz",',
    '  "title": "3-8 word concrete title, e.g. \'Flatten a nested array of numbers\'",',
    '  "skill": "the exact skill name from the request",',
    '  "tags": ["1-4 lowercase concept tags, e.g. \'closures\', \'async\', \'flexbox\'"],',
    '  "difficulty": "easy" | "medium" | "hard",',
    '  "prompt": "the complete task statement the developer reads. Plain text with light markdown: short intro, bullet constraints, 1-3 examples of input → output. Be thorough: state exact behavior for edge cases the tests check.",',
    '  "explanation": "2-5 sentences: why the reference solution works and what the key insight is."',
    '}',
    '',
    'kind "code" — the interview classic (write a function, tests run):',
    '  + "language": "js" | "ts"   (use "ts" when the skill is TypeScript; otherwise "js")',
    '  + "functionName": "the exact function name the tests will call",',
    '  + "starterCode": "the function signature with a TODO body (plus a typed signature if ts). No worked hints.",',
    '  + "tests": [ { "name": "short human description", "args": [ ...JSON args... ], "expected": ...JSON value... } ]',
    '      · 5-7 test cases, ordered from basic to tricky, including edge cases (empty input, duplicates, negatives, large-ish input).',
    '      · args and expected must be JSON-serializable (numbers, strings, booleans, null, arrays, plain objects). No functions, no undefined, no class instances, no Date.',
    '      · deterministic only — no Date.now(), Math.random(), or timeouts inside expected logic.',
    '  + "solution": "the full reference solution code (just the function, matching functionName, no tests)."',
    '',
    'kind "bug" — find and fix the bug (tests fail on the starter code, pass on the fix):',
    '  + same fields as "code", but "starterCode" is a plausible-looking implementation containing ONE clear, findable bug (off-by-one, wrong comparison, mutation, closure capture, async misuse, etc.),',
    '  + the prompt describes the INTENDED behavior only — never says where the bug is,',
    '  + "tests" that pass once the bug is fixed (the starter must fail at least one),',
    '  + "solution": the corrected full function.',
    '',
    'kind "dom" — build a small layout with HTML + CSS (assertions run on the rendered result):',
    '  + "dom": {',
    '      "html": "the starter HTML the developer edits (semantic structure, some text, TODO comments where classes/content are expected)",',
    '      "css": "the starter CSS (may be empty or minimal)",',
    '      "assertions": [ ...4-8 checks... ]',
    '    }',
    '    Assertion forms (ONLY these):',
    '      { "type": "exists", "selector": ".card", "expected": true }',
    '      { "type": "count", "selector": "li", "expected": 3 }',
    '      { "type": "computedStyle", "selector": ".row", "property": "display", "expected": "flex" }',
    '      { "type": "text", "selector": "h1", "expected": "Dashboard" }',
    '      { "type": "attr", "selector": "a", "attr": "href", "expected": "#login" }',
    '    · computedStyle checks are the meat — verify layout/visual properties (display, flex-direction, justify-content, align-items, gap, grid-template-columns, max-width, text-align, padding-left...). Property names in kebab-case. Expected values are exact strings, e.g. "flex", "center", "6px".',
    '    · The task prompt must tell the developer which properties are checked so the drill is fair.',
    '  + "language" is null for dom drills; no tests/solution code — "solution" is the finished HTML+CSS as one string, clearly split with a /* CSS */ marker or comments.',
    '',
    'kind "quiz" — one focused multiple-choice question (also the required format for every non-runnable language):',
    '  + "quiz": { "question": "...", "options": ["4 plausible options"], "correctIndex": 0-3, "explanation": "one rich paragraph: why the right answer is right and the wrong ones wrong" }',
    '  + For code-reading quizzes the question embeds ONE fenced, fully self-contained snippet (```python, ```java, ```go, ```sql, ```bash, ...) and asks what it prints, what it returns, which line contains the subtle bug, or which rewrite is correct.',
    '  + Test real understanding of the skill (semantics, behavior, gotchas, performance) — never trivia like version numbers.',
    '',
    'EXECUTABLE VS WRITTEN LANGUAGES — read this before choosing "kind":',
    '- The in-app runner executes ONLY JavaScript and TypeScript ("code"/"bug"), and can render HTML+CSS ("dom"). Nothing else can run here: no Python, Java, C#, C, C++, Go, Rust, SQL, PHP, Ruby, Swift, Kotlin or Bash — and no framework that needs a server or a package install (React, Node.js, React Native are practised through quizzes too).',
    '- When the target skill is one of those, ALWAYS author kind "quiz": a code-reading exercise with a short self-contained snippet (6-15 lines, standard library only, no network, no filesystem) inside quiz.question.',
    '- If the request explicitly asks for "code", "bug" or "dom" but the target language cannot execute here, silently use "quiz" instead — never fabricate runnable tests for an unrunnable language.',
    '- The snippet must be deterministic and answerable by reading alone (no "what does this print" questions whose answer is implementation-defined).',
    '',
    'CRAFT RULES:',
    '- NEVER repeat or lightly reword a previous drill\'s scenario, function name, or test shape. Invent something genuinely new every time.',
    '- Prefer practical scenarios an engineer would actually see (data shaping, API responses, UI layout, event handling) over puzzles.',
    '- Easy = one concept, obvious approach, warm-up. Medium = 2-3 concepts or a subtle edge case. Hard = tricky tradeoffs, careful edge cases, or optimization.',
    '- The prompt field is the ONLY thing the developer sees before solving — make it complete and unambiguous, in a calm, friendly tone.',
    '- Code comments in starter/solution should be sparse and professional.',
    '- For quiz drills in a non-JS language: the skill field must match the requested skill exactly (e.g. "Python"), and the language of the snippet must match it.',
    '- Keep the whole JSON object compact — concise strings, no boilerplate — so the reply comfortably fits and can never be cut off mid-object.'
  ].join('\n');

  const REVIEW_SYSTEM = [
    'You are the code-review voice of "Don\'t Be Dumb". The developer just finished a drill (or gave up) and a reference solution exists.',
    'Write a BLUNT, SPECIFIC review of THEIR code against the task:',
    '- Start with one line: did they solve it, and how is it for an interview?',
    '- Then 3-6 short bullets: correctness beyond the tests, edge cases missed, idiom/style (JS/TS), complexity/perf, type hygiene.',
    '- Point at the actual lines/constructs in their code. No generic advice, no praise padding.',
    '- Do NOT paste a full rewrite; a 1-2 line snippet to illustrate a point is fine.',
    '- Max ~150 words total. Plain text with a few "•" bullets.'
  ].join('\n');

  /* ------------------------------------------------------------------ *
   *  Prompt building                                                    *
   * ------------------------------------------------------------------ */

  function daysSince(iso) {
    if (!iso) return null;
    const then = new Date(iso).getTime();
    if (isNaN(then)) return null;
    return Math.floor((Date.now() - then) / 86400000);
  }

  function buildGenUser(opts) {
    const skills = opts.skills || [];
    const skillLines = skills.map((s) => {
      const d = daysSince(s.last_practiced_at);
      const when = d == null ? 'never practiced' : d === 0 ? 'practiced today' : d + ' days since last practice';
      return `- ${s.name} — level: ${s.level}; ${when}${s.notes ? '; notes: ' + s.notes : ''}`;
    }).join('\n') || '(no skills configured)';

    const prev = opts.previous || [];
    const prevLines = prev.length
      ? prev.map((p, i) => `${i + 1}. "${p.title}" — ${p.skill}${p.tags && p.tags.length ? ' [' + p.tags.join(', ') + ']' : ''} (${p.kind})`).join('\n')
      : '(none yet — this is the first drill ever)';

    const kind = opts.kind && opts.kind !== 'auto' ? opts.kind : 'AUTO (you choose the kind best suited to the skill)';
    const req = opts.request || {};

    return [
      'DEVELOPER PROFILE (their skill list, for calibration):',
      skillLines,
      '',
      'DRILL REQUEST:',
      `- Target skill: ${req.skill || 'you choose the most neglected one'}`,
      `- Difficulty: ${req.difficulty || 'medium'}`,
      `- Kind: ${kind}`,
      req.note ? `- Extra instructions from the developer: "${req.note}"` : '- No extra instructions.',
      '',
      'PREVIOUSLY ASKED DRILLS — these are stored permanently. Do NOT repeat or lightly reword any of them:',
      prevLines,
      '',
      'Write ONE brand-new drill now. Respond with the single JSON object only.'
    ].join('\n');
  }

  function buildReviewUser(task, code, resultsSummary) {
    return [
      `TASK (${task.kind}, ${task.skill}, ${task.difficulty}): ${task.title}`,
      '',
      task.prompt,
      '',
      'REFERENCE SOLUTION:',
      task.solution || '(none stored)',
      '',
      'THEIR CODE:',
      code || '(empty)',
      '',
      `TEST RESULTS: ${resultsSummary || 'not run'}`,
      '',
      'Review their solution now.'
    ].join('\n');
  }

  /* ------------------------------------------------------------------ *
   *  Streaming chat calls                                               *
   * ------------------------------------------------------------------ */

  function pickText(r) {
    if (!r) return '';
    if (typeof r === 'string') return r;
    if (typeof r.text === 'string' && r.text) return r.text;
    if (typeof r.content === 'string') return r.content;
    if (r.message && typeof r.message.content === 'string') return r.message.content;
    if (r.message && typeof r.message.text === 'string' && r.message.text) return r.message.text;
    if (Array.isArray(r.content)) {
      // join with '' — content parts can be fragments of one reply, and an injected
      // newline inside a JSON string would corrupt it (the join must not add characters)
      return r.content.map((c) => (typeof c === 'string' ? c : (c && typeof c.text === 'string' ? c.text : ''))).join('');
    }
    if (Array.isArray(r.messages)) {
      for (let i = r.messages.length - 1; i >= 0; i--) {
        const m = r.messages[i];
        if (m && m.role === 'assistant') {
          if (typeof m.content === 'string') return m.content;
          if (Array.isArray(m.content)) {
            return m.content.map((c) => (typeof c === 'string' ? c : (c && typeof c.text === 'string' ? c.text : ''))).join('');
          }
        }
      }
    }
    if (r.finalMessage && typeof r.finalMessage.content === 'string') return r.finalMessage.content;
    if (r.finalMessage && typeof r.finalMessage.text === 'string') return r.finalMessage.text;
    return '';
  }

  async function runStreamed(model, messages, onStream) {
    let streamed = '';
    const result = await chat().runTurn({
      model,
      messages,
      onToken: (tok) => {
        const piece = typeof tok === 'string' ? tok : (tok && (tok.token || tok.text)) || '';
        if (piece) {
          streamed += piece;
          if (onStream) onStream(streamed);
        }
      }
    });
    const full = pickText(result) || streamed;
    return { text: full, streamed, result };
  }

  /* ------------------------------------------------------------------ *
   *  JSON extraction + validation                                       *
   * ------------------------------------------------------------------ */

  function extractJson(text) {
    if (!text) return null;
    let s = String(text).trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();

    let start = s.indexOf('{');
    while (start !== -1) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            const candidate = s.slice(start, i + 1);
            try { return JSON.parse(candidate); } catch (e) { break; /* try next '{' */ }
          }
        }
      }
      start = s.indexOf('{', start + 1);
    }
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  const KINDS = ['code', 'bug', 'dom', 'quiz'];

  function validateTask(obj) {
    if (!obj || typeof obj !== 'object') return 'reply was not a JSON object';
    if (KINDS.indexOf(obj.kind) === -1) return 'missing/invalid "kind"';
    if (typeof obj.title !== 'string' || !obj.title.trim()) return 'missing "title"';
    if (typeof obj.prompt !== 'string' || !obj.prompt.trim()) return 'missing "prompt"';
    if (typeof obj.skill !== 'string' || !obj.skill.trim()) return 'missing "skill"';
    if (['easy', 'medium', 'hard'].indexOf(obj.difficulty) === -1) obj.difficulty = 'medium';
    if (!Array.isArray(obj.tags)) obj.tags = [];
    obj.tags = obj.tags.filter((t) => typeof t === 'string').slice(0, 6);
    if (typeof obj.explanation !== 'string') obj.explanation = '';

    if (obj.kind === 'code' || obj.kind === 'bug') {
      if (typeof obj.functionName !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(obj.functionName)) return 'missing/invalid "functionName"';
      if (typeof obj.starterCode !== 'string') return 'missing "starterCode"';
      if (obj.language !== 'ts') obj.language = 'js';
      if (!Array.isArray(obj.tests) || obj.tests.length < 2) return '"tests" missing or too few';
      for (const t of obj.tests) {
        if (!t || typeof t.name !== 'string' || !Array.isArray(t.args)) return 'malformed test case';
        if (!Object.prototype.hasOwnProperty.call(t, 'expected')) return 'test case missing "expected"';
      }
      if (typeof obj.solution !== 'string' || !obj.solution.trim()) return 'missing "solution"';
      obj.dom = null; obj.quiz = null;
    } else if (obj.kind === 'dom') {
      const d = obj.dom;
      if (!d || typeof d.html !== 'string' || typeof d.css !== 'string') return 'missing dom.html / dom.css';
      if (!Array.isArray(d.assertions) || d.assertions.length < 2) return 'dom.assertions missing or too few';
      for (const a of d.assertions) {
        if (!a || typeof a.type !== 'string' || typeof a.selector !== 'string') return 'malformed dom assertion';
        if (['exists', 'count', 'computedStyle', 'text', 'attr'].indexOf(a.type) === -1) return 'unknown dom assertion type: ' + a.type;
      }
      if (typeof obj.solution !== 'string') obj.solution = '';
      obj.language = null; obj.tests = null; obj.quiz = null;
    } else if (obj.kind === 'quiz') {
      const q = obj.quiz;
      if (!q || typeof q.question !== 'string' || !Array.isArray(q.options) || q.options.length < 3) return 'missing quiz.question/options';
      q.options = q.options.filter((o) => typeof o === 'string');
      if (q.options.length < 3) return 'quiz has too few string options';
      if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex >= q.options.length) return 'invalid quiz.correctIndex';
      if (typeof q.explanation !== 'string') q.explanation = '';
      if (typeof obj.solution !== 'string') obj.solution = q.options[q.correctIndex] || '';
      obj.language = null; obj.tests = null; obj.dom = null;
    }
    return null;
  }

  function fingerprintOf(obj) {
    const norm = (obj.title || '') + '|' + (obj.functionName || '') + '|' + (obj.kind || '');
    return norm.toLowerCase().replace(/[^a-z0-9|]/g, '').slice(0, 120);
  }

  /* ------------------------------------------------------------------ *
   *  Public API                                                         *
   * ------------------------------------------------------------------ */

  async function generateTask(opts) {
    // opts: { model, skills, previous, request: {skill, difficulty, kind, note}, onStream, onStatus }
    // Generation must never dead-end: up to 3 rounds — straight call, a repair round that
    // shows the model exactly what was wrong, then a strict fresh call. Either of the two
    // captured buffers (final text or streamed tokens) may be used, whichever parses.
    const base = [
      { role: 'system', content: GENERATOR_SYSTEM },
      { role: 'user', content: buildGenUser(opts) }
    ];
    // opts.__run is an internal test seam (used by the boot self-test); production always
    // uses the real streaming chat call.
    const runIt = (typeof opts.__run === 'function') ? opts.__run : runStreamed;

    let lastRaw = '';
    let lastProblem = 'the model returned an empty reply';

    for (let round = 1; round <= 3; round++) {
      if (opts.onStatus) {
        try { opts.onStatus(round, lastProblem); } catch (e) { /* ignore */ }
      }
      let messages = base;
      if (round === 2) {
        const truncated = lastProblem === 'reply was not a JSON object' && lastRaw.length > 6500;
        messages = base.concat([
          { role: 'assistant', content: String(lastRaw).slice(0, 6000) },
          {
            role: 'user',
            content: 'That reply was rejected: ' + lastProblem
              + (truncated ? ' (it looks like it was cut off or wrapped in extra text)' : '')
              + '. Respond again with ONLY a single valid JSON object that fixes this. No markdown fences, no commentary before or after, and keep every field compact so the reply cannot be cut off.'
          }
        ]);
      } else if (round === 3) {
        messages = [
          {
            role: 'system',
            content: GENERATOR_SYSTEM + '\n\nFINAL ATTEMPT — STRICT OUTPUT: reply with nothing but the raw JSON object. No markdown fences, no commentary, no leading or trailing text. Keep the entire object compact (target well under 1200 tokens).'
          },
          { role: 'user', content: buildGenUser(opts) }
        ];
      }

      let r;
      try {
        r = await runIt(opts.model, messages, opts.onStream);
      } catch (e) {
        lastRaw = '';
        lastProblem = 'the model call failed (' + ((e && e.message) || e) + ')';
        continue;
      }
      lastRaw = r.text || r.streamed || '';
      const got = acceptReply(r);
      if (got.task) return { task: got.task, raw: lastRaw, rounds: round };
      lastProblem = got.problem || 'the reply could not be parsed';
    }

    const err = new Error('The AI reply could not be used after 3 attempts: ' + lastProblem);
    err.raw = String(lastRaw).slice(0, 2000);
    throw err;
  }

  // Try to turn one model reply into a validated task. Both the assembled text and the
  // streamed token buffer are candidates (they can differ — one may be truncated).
  function acceptReply(r) {
    const cands = [];
    if (r.text) cands.push(r.text);
    if (r.streamed && r.streamed !== r.text) cands.push(r.streamed);
    if (!cands.length) return { task: null, problem: 'the model returned an empty reply' };
    let problem = 'reply was not a JSON object';
    for (const c of cands) {
      const obj = extractJson(c);
      const p = validateTask(obj);
      if (!p) return { task: obj, problem: null };
      if (p !== 'reply was not a JSON object') problem = p; // keep the most informative problem
    }
    return { task: null, problem };
  }

  async function reviewAttempt(opts) {
    // opts: { model, task, code, resultsSummary, onStream }
    const messages = [
      { role: 'system', content: REVIEW_SYSTEM },
      { role: 'user', content: buildReviewUser(opts.task, opts.code, opts.resultsSummary) }
    ];
    const r = await runStreamed(opts.model, messages, opts.onStream);
    return r.text;
  }

  DBD.ai = {
    GENERATOR_SYSTEM,
    REVIEW_SYSTEM,
    buildGenUser,
    buildReviewUser,
    generateTask,
    reviewAttempt,
    extractJson,
    validateTask,
    fingerprintOf,
    daysSince,
    pickText,
    acceptReply
  };
})();
