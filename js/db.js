/*
 * Don't Be Dumb — data layer.
 * Private, persistent SQLite via window.chatoss.db (capability "sqlite").
 * Everything the AI has ever asked is stored in `tasks` and fed back into every
 * generation prompt so drills never repeat.
 */
(function () {
  'use strict';

  const DBD = (window.DBD = window.DBD || {});
  const NAME = 'dont_be_dumb';

  let ready = false;

  const SEED_VERSION = 2;

  // Default skills. Only JavaScript/TypeScript can be EXECUTED by the in-app runner and
  // HTML/CSS can be rendered — every other language is practised through code-reading
  // quizzes (the drill generator is told to do this in js/ai.js).
  const SEED_SKILLS = [
    ['JavaScript', 'rusty', 'Core language: closures, prototypes, async/await, iterators.'],
    ['TypeScript', 'rusty', 'Types, generics, narrowing, utility types.'],
    ['React', 'rusty', 'Hooks, state design, rendering behavior.'],
    ['Node.js', 'rusty', 'Streams, the event loop, modules, async patterns.'],
    ['HTML', 'rusty', 'Semantics, forms, accessibility basics.'],
    ['CSS', 'rusty', 'Flexbox, grid, specificity, responsive design.'],
    ['React Native (Expo)', 'rusty', 'Core components, styling, navigation, Expo APIs.'],
    ['Python', 'rusty', 'Strings, dicts, comprehensions, generators, decorators, classes.'],
    ['Java', 'rusty', 'Collections, generics, streams, exceptions, OOP design.'],
    ['C#', 'rusty', 'LINQ, generics, async/await, records, OOP.'],
    ['C', 'rusty', 'Pointers, memory, strings, structs, the preprocessor.'],
    ['C++', 'rusty', 'RAII, templates, STL, move semantics.'],
    ['Go', 'rusty', 'Goroutines, channels, interfaces, error handling.'],
    ['Rust', 'rusty', 'Ownership, borrowing, enums, traits, error handling.'],
    ['SQL', 'rusty', 'Joins, aggregation, window functions, indexes, transactions.'],
    ['PHP', 'rusty', 'Arrays, strings, classes, PDO, modern PHP patterns.'],
    ['Ruby', 'rusty', 'Blocks, enumerables, modules, metaprogramming basics.'],
    ['Swift', 'rusty', 'Optionals, closures, protocols, value semantics.'],
    ['Kotlin', 'rusty', 'Null safety, data classes, coroutines, extension functions.'],
    ['Bash', 'rusty', 'Pipes, redirection, conditionals, parameter expansion.']
  ];

  const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      level TEXT NOT NULL DEFAULT 'rusty',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_practiced_at TEXT,
      practice_count INTEGER NOT NULL DEFAULT 0,
      pass_count INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      skill TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      difficulty TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      language TEXT,
      function_name TEXT,
      starter_code TEXT,
      tests TEXT,
      dom TEXT,
      quiz TEXT,
      solution TEXT,
      explanation TEXT,
      fingerprint TEXT,
      model TEXT,
      request TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      runs INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT 'in_progress',
      code TEXT NOT NULL DEFAULT '',
      code_extra TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_attempts_task ON attempts(task_id)`,
    `CREATE INDEX IF NOT EXISTS idx_attempts_updated ON attempts(updated_at)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_skill ON tasks(skill)`,
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
  ];

  function nowIso() { return new Date().toISOString(); }
  function safeParse(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }

  async function exec(sql, params) { return window.chatoss.db.exec(NAME, sql, params); }
  async function query(sql, params) { return window.chatoss.db.query(NAME, sql, params); }

  async function init() {
    const opened = await window.chatoss.db.open(NAME);
    if (!opened) throw new Error('Could not open the app database.');
    for (const sql of SCHEMA) await exec(sql);

    const rows = await query('SELECT COUNT(*) AS n FROM skills');
    const n = rows && rows[0] ? rows[0].n : 0;
    const v = Number(await getMeta('skills_seed')) || 0;
    if (!n) {
      await insertSeedSkills();
      await setMeta('skills_seed', SEED_VERSION);
    } else if (v < SEED_VERSION) {
      // v1 → v2: Next.js and Tailwind CSS were retired as defaults and many more
      // languages were added. Remove the two only if they are untouched seeds.
      await exec(
        `DELETE FROM skills WHERE name IN ('Next.js', 'Tailwind CSS')
          AND practice_count = 0 AND last_practiced_at IS NULL
          AND notes IN ('App router, server/client components, data fetching.',
                        'Utility patterns, responsive variants, config.')`);
      await insertSeedSkills();
      await setMeta('skills_seed', SEED_VERSION);
    }
    ready = true;
  }

  async function getMeta(key) {
    const r = await query('SELECT value FROM meta WHERE key = ?', [key]);
    return r[0] ? r[0].value : null;
  }

  async function setMeta(key, value) {
    await exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, String(value)]);
  }

  // Insert every seed skill that is missing by name — a fresh install gets all of them,
  // and older databases pick up skills that were added since they were seeded.
  async function insertSeedSkills() {
    const t = nowIso();
    for (const s of SEED_SKILLS) {
      await exec(
        'INSERT INTO skills (name, level, notes, created_at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM skills WHERE name = ?)',
        [s[0], s[1], s[2], t, s[0]]);
    }
  }

  /* ---------------- skills ---------------- */

  async function listSkills() {
    return query(`SELECT * FROM skills
      ORDER BY CASE WHEN last_practiced_at IS NULL THEN 0 ELSE 1 END ASC,
               last_practiced_at ASC,
               name ASC`);
  }

  async function getSkill(name) {
    const r = await query('SELECT * FROM skills WHERE name = ?', [name]);
    return r[0] || null;
  }

  async function addSkill(name, level, notes) {
    await exec('INSERT INTO skills (name, level, notes, created_at) VALUES (?, ?, ?, ?)',
      [String(name).trim(), level || 'rusty', notes || '', nowIso()]);
  }

  async function updateSkill(id, name, level, notes) {
    const old = await query('SELECT name FROM skills WHERE id = ?', [id]);
    const oldName = old[0] ? old[0].name : null;
    await exec('UPDATE skills SET name = ?, level = ?, notes = ? WHERE id = ?',
      [String(name).trim(), level || 'rusty', notes || '', id]);
    if (oldName && oldName !== String(name).trim()) {
      await exec('UPDATE tasks SET skill = ? WHERE skill = ?', [String(name).trim(), oldName]);
    }
  }

  async function deleteSkill(id) {
    await exec('DELETE FROM skills WHERE id = ?', [id]);
  }

  async function notePractice(skillName, passed) {
    await exec(
      'UPDATE skills SET last_practiced_at = ?, practice_count = practice_count + 1, pass_count = pass_count + ? WHERE name = ?',
      [nowIso(), passed ? 1 : 0, skillName]);
  }

  /* ---------------- tasks ---------------- */

  async function insertTask(t) {
    await exec(
      `INSERT INTO tasks (created_at, kind, skill, tags, difficulty, title, prompt, language, function_name,
        starter_code, tests, dom, quiz, solution, explanation, fingerprint, model, request)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nowIso(), t.kind, t.skill, JSON.stringify(t.tags || []), t.difficulty, t.title, t.prompt,
        t.language || null, t.functionName || null, t.starterCode || null,
        t.tests ? JSON.stringify(t.tests) : null,
        t.dom ? JSON.stringify(t.dom) : null,
        t.quiz ? JSON.stringify(t.quiz) : null,
        t.solution || null, t.explanation || null, t.fingerprint || null, t.model || null, t.request || null
      ]);
    const r = await query('SELECT last_insert_rowid() AS id');
    return r[0].id;
  }

  function hydrateTask(t) {
    return Object.assign({}, t, {
      tags: safeParse(t.tags, []),
      tests: safeParse(t.tests, null),
      dom: safeParse(t.dom, null),
      quiz: safeParse(t.quiz, null)
    });
  }

  async function getTask(id) {
    const r = await query('SELECT * FROM tasks WHERE id = ?', [id]);
    return r[0] ? hydrateTask(r[0]) : null;
  }

  async function listRecentTasks(limit) {
    const r = await query('SELECT * FROM tasks ORDER BY id DESC LIMIT ?', [limit || 40]);
    return r.map(hydrateTask);
  }

  async function listPreviousBriefs(limit) {
    return query('SELECT title, skill, tags, kind FROM tasks ORDER BY id DESC LIMIT ?', [limit || 30]);
  }

  async function countTasks() {
    const r = await query('SELECT COUNT(*) AS n FROM tasks');
    return r[0] ? r[0].n : 0;
  }

  async function findByFingerprint(fp) {
    const r = await query('SELECT id, title FROM tasks WHERE fingerprint = ? LIMIT 1', [fp]);
    return r[0] || null;
  }

  /* ---------------- attempts ---------------- */

  async function createAttempt(taskId) {
    await exec('INSERT INTO attempts (task_id, created_at, updated_at) VALUES (?, ?, ?)',
      [taskId, nowIso(), nowIso()]);
    const r = await query('SELECT last_insert_rowid() AS id');
    return getAttempt(r[0].id);
  }

  async function getAttempt(id) {
    const r = await query('SELECT * FROM attempts WHERE id = ?', [id]);
    return r[0] || null;
  }

  async function latestAttemptForTask(taskId) {
    const r = await query('SELECT * FROM attempts WHERE task_id = ? ORDER BY id DESC LIMIT 1', [taskId]);
    return r[0] || null;
  }

  async function latestOpenAttemptForTask(taskId) {
    const r = await query("SELECT * FROM attempts WHERE task_id = ? AND outcome = 'in_progress' ORDER BY id DESC LIMIT 1", [taskId]);
    return r[0] || null;
  }

  async function updateAttempt(id, patch) {
    const fields = ['seconds', 'runs', 'passed', 'total', 'outcome', 'code', 'code_extra'];
    const sets = ['updated_at = ?'];
    const args = [nowIso()];
    for (const f of fields) {
      if (patch[f] !== undefined) { sets.push(f + ' = ?'); args.push(patch[f]); }
    }
    args.push(id);
    await exec('UPDATE attempts SET ' + sets.join(', ') + ' WHERE id = ?', args);
    return getAttempt(id);
  }

  async function recentAttempts(limit) {
    return query(
      `SELECT a.*, t.title, t.skill, t.kind, t.difficulty
       FROM attempts a JOIN tasks t ON t.id = a.task_id
       ORDER BY a.id DESC LIMIT ?`, [limit || 60]);
  }

  async function overallStats() {
    const r = await query(`SELECT
      (SELECT COUNT(*) FROM tasks) AS tasks,
      (SELECT COUNT(*) FROM attempts WHERE outcome != 'in_progress') AS done,
      (SELECT COUNT(*) FROM attempts WHERE outcome = 'passed') AS passed`);
    return r[0] || { tasks: 0, done: 0, passed: 0 };
  }

  async function perSkillStats() {
    return query(`SELECT t.skill AS skill,
        SUM(CASE WHEN a.outcome != 'in_progress' THEN 1 ELSE 0 END) AS attempts,
        SUM(CASE WHEN a.outcome = 'passed' THEN 1 ELSE 0 END) AS passed
      FROM attempts a JOIN tasks t ON t.id = a.task_id
      GROUP BY t.skill`);
  }

  // updated_at of every COMPLETED attempt (ISO strings) — JS computes local-day stats from these.
  async function completedAttemptDates(limit) {
    return query(`SELECT updated_at FROM attempts WHERE outcome != 'in_progress' ORDER BY id DESC LIMIT ?`, [limit || 500]);
  }

  async function eraseAll() {
    await exec('DELETE FROM attempts');
    await exec('DELETE FROM tasks');
    await exec('DELETE FROM skills');
    await insertSeedSkills();
    await setMeta('skills_seed', SEED_VERSION);
  }

  DBD.db = {
    NAME, init,
    isReady() { return ready; },
    query, exec,
    listSkills, getSkill, addSkill, updateSkill, deleteSkill, notePractice,
    insertTask, getTask, listRecentTasks, listPreviousBriefs, countTasks, findByFingerprint,
    createAttempt, getAttempt, latestAttemptForTask, latestOpenAttemptForTask, updateAttempt,
    recentAttempts, overallStats, perSkillStats, completedAttemptDates, eraseAll
  };
})();
