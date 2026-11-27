'use strict';
/**
 * Notes API + web app server
 * - Zero dependencies (only Node.js built-ins)
 * - NO database: all notes live in process memory (a Map). Restart = clean slate.
 *   Use the Export / Import feature to carry your notes between sessions.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const STARTED_AT = Date.now();
const COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const MAX_VERSIONS = 20;
const VERSION_GAP_MS = 30 * 1000; // don't snapshot more often than this
const RATE_LIMIT = { windowMs: 60 * 1000, max: 300 };

// ---------------------------------------------------------------- in-memory store
const notes = new Map();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const now = () => new Date().toISOString();
const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function makeNote(input) {
  const t = now();
  return {
    id: crypto.randomUUID(),
    title: input.title || '',
    content: input.content || '',
    tags: input.tags || [],
    color: input.color || 'default',
    pinned: !!input.pinned,
    archived: !!input.archived,
    deletedAt: null,
    createdAt: input.createdAt || t,
    updatedAt: input.updatedAt || t,
    versions: [],
  };
}

// Public representation (versions are fetched separately, so list responses stay small)
function publicNote(n) {
  const { versions, ...rest } = n;
  return { ...rest, wordCount: words(n.content), versionCount: versions.length };
}

// ---------------------------------------------------------------- validation
function validate(input, { partial }) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  const out = {};
  if ('title' in input) {
    if (typeof input.title !== 'string') throw new HttpError(400, '"title" must be a string');
    if (input.title.length > 200) throw new HttpError(400, '"title" must be at most 200 characters');
    out.title = input.title;
  }
  if ('content' in input) {
    if (typeof input.content !== 'string') throw new HttpError(400, '"content" must be a string');
    if (input.content.length > 100000) throw new HttpError(400, '"content" must be at most 100,000 characters');
    out.content = input.content;
  }
  if ('tags' in input) {
    if (!Array.isArray(input.tags) || input.tags.some((t) => typeof t !== 'string')) {
      throw new HttpError(400, '"tags" must be an array of strings');
    }
    const clean = [...new Set(input.tags.map((t) => t.trim().toLowerCase().slice(0, 30)).filter(Boolean))];
    if (clean.length > 10) throw new HttpError(400, 'A note can have at most 10 tags');
    out.tags = clean;
  }
  if ('color' in input) {
    if (!COLORS.includes(input.color)) throw new HttpError(400, `"color" must be one of: ${COLORS.join(', ')}`);
    out.color = input.color;
  }
  for (const key of ['pinned', 'archived']) {
    if (key in input) {
      if (typeof input[key] !== 'boolean') throw new HttpError(400, `"${key}" must be a boolean`);
      out[key] = input[key];
    }
  }
  if (!partial && !('title' in out) && !('content' in out)) {
    throw new HttpError(400, 'Provide at least a "title" or "content"');
  }
  return out;
}

// ---------------------------------------------------------------- helpers
function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new HttpError(413, 'Payload too large (max 2MB)')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const hits = new Map();
function rateLimit(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  const t = Date.now();
  let rec = hits.get(ip);
  if (!rec || t - rec.start > RATE_LIMIT.windowMs) { rec = { start: t, count: 0 }; hits.set(ip, rec); }
  rec.count++;
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT.max);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT.max - rec.count));
  if (rec.count > RATE_LIMIT.max) throw new HttpError(429, 'Too many requests, slow down');
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (t - v.start > RATE_LIMIT.windowMs) hits.delete(k); }, 60000).unref();

function getNote(id) {
  const n = notes.get(id);
  if (!n) throw new HttpError(404, 'Note not found');
  return n;
}

function applyUpdate(note, data) {
  const changedText = ('title' in data && data.title !== note.title) || ('content' in data && data.content !== note.content);
  if (changedText) {
    const last = note.versions[note.versions.length - 1];
    if (!last || Date.now() - new Date(last.savedAt).getTime() > VERSION_GAP_MS) {
      note.versions.push({ id: crypto.randomUUID(), title: note.title, content: note.content, savedAt: now() });
      if (note.versions.length > MAX_VERSIONS) note.versions.shift();
    }
  }
  Object.assign(note, data);
  if (Object.keys(data).length) note.updatedAt = now();
}

// ---------------------------------------------------------------- route handlers
function listNotes(url) {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const tag = (url.searchParams.get('tag') || '').trim().toLowerCase();
  const view = url.searchParams.get('view') || 'active';
  const color = url.searchParams.get('color');
  const sort = url.searchParams.get('sort') || 'updated';
  const order = url.searchParams.get('order') === 'asc' ? 1 : -1;
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 50));
  if (!['active', 'archived', 'trash'].includes(view)) throw new HttpError(400, 'view must be active, archived or trash');
  if (!['updated', 'created', 'title', 'words'].includes(sort)) throw new HttpError(400, 'sort must be updated, created, title or words');

  let list = [...notes.values()].filter((n) => {
    if (view === 'trash') return n.deletedAt;
    if (n.deletedAt) return false;
    return view === 'archived' ? n.archived : !n.archived;
  });
  if (tag) list = list.filter((n) => n.tags.includes(tag));
  if (color) list = list.filter((n) => n.color === color);
  if (q) list = list.filter((n) => (n.title + ' ' + n.content + ' ' + n.tags.join(' ')).toLowerCase().includes(q));

  const key = {
    updated: (n) => n.updatedAt, created: (n) => n.createdAt,
    title: (n) => n.title.toLowerCase(), words: (n) => words(n.content),
  }[sort];
  list.sort((a, b) => {
    if (view === 'active' && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const x = key(a), y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * order;
  });

  const total = list.length;
  const data = list.slice((page - 1) * limit, page * limit).map(publicNote);
  return { data, meta: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) } };
}

function stats() {
  const all = [...notes.values()];
  const live = all.filter((n) => !n.deletedAt);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    days.push({
      date: d.toISOString().slice(0, 10),
      created: live.filter((n) => new Date(n.createdAt) >= d && new Date(n.createdAt) < next).length,
    });
  }
  const colors = {};
  live.forEach((n) => { colors[n.color] = (colors[n.color] || 0) + 1; });
  const longest = live.slice().sort((a, b) => words(b.content) - words(a.content))[0];
  const totalWords = live.reduce((s, n) => s + words(n.content), 0);
  return {
    active: live.filter((n) => !n.archived).length,
    archived: live.filter((n) => n.archived).length,
    trash: all.length - live.length,
    pinned: live.filter((n) => n.pinned && !n.archived).length,
    totalWords,
    avgWords: live.length ? Math.round(totalWords / live.length) : 0,
    readingMinutes: Math.max(0, Math.round(totalWords / 200)),
    uniqueTags: new Set(live.flatMap((n) => n.tags)).size,
    colors,
    last7Days: days,
    longest: longest ? { id: longest.id, title: longest.title || 'Untitled', words: words(longest.content) } : null,
    uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
    storage: 'in-memory (no database)',
  };
}

async function handleApi(req, res, url) {
  rateLimit(req, res);
  const p = url.pathname.replace(/\/+$/, '') || '/api';
  const m = req.method;
  let r;

  if (p === '/api' && m === 'GET') {
    return send(res, 200, {
      name: 'Notes API', version: '1.0.0', storage: 'in-memory (no database)',
      endpoints: [
        'GET    /api/health', 'GET    /api/stats', 'GET    /api/tags',
        'GET    /api/notes?q=&tag=&view=active|archived|trash&color=&sort=updated|created|title|words&order=asc|desc&page=&limit=',
        'POST   /api/notes', 'GET    /api/notes/:id', 'PUT    /api/notes/:id', 'PATCH  /api/notes/:id',
        'DELETE /api/notes/:id  (?permanent=true to erase)', 'POST   /api/notes/:id/restore', 'POST   /api/notes/:id/duplicate',
        'GET    /api/notes/:id/versions', 'POST   /api/notes/:id/versions/:versionId/restore',
        'DELETE /api/trash', 'GET    /api/export', 'POST   /api/import',
      ],
    });
  }
  if (p === '/api/health' && m === 'GET') return send(res, 200, { status: 'ok', notes: notes.size, uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000) });
  if (p === '/api/stats' && m === 'GET') return send(res, 200, stats());

  if (p === '/api/tags' && m === 'GET') {
    const counts = {};
    for (const n of notes.values()) if (!n.deletedAt) n.tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; });
    return send(res, 200, Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)));
  }

  if (p === '/api/notes' && m === 'GET') return send(res, 200, listNotes(url));
  if (p === '/api/notes' && m === 'POST') {
    const note = makeNote(validate(await readBody(req), { partial: false }));
    notes.set(note.id, note);
    return send(res, 201, publicNote(note), { Location: `/api/notes/${note.id}` });
  }

  if (p === '/api/trash' && m === 'DELETE') {
    let removed = 0;
    for (const [id, n] of notes) if (n.deletedAt) { notes.delete(id); removed++; }
    return send(res, 200, { removed });
  }

  if (p === '/api/export' && m === 'GET') {
    const data = { app: 'notes-api', exportedAt: now(), notes: [...notes.values()] };
    return send(res, 200, data, { 'Content-Disposition': `attachment; filename="notes-export-${now().slice(0, 10)}.json"` });
  }
  if (p === '/api/import' && m === 'POST') {
    const body = await readBody(req);
    if (!body || !Array.isArray(body.notes)) throw new HttpError(400, 'Expected { "notes": [ ... ] }');
    if (body.notes.length > 1000) throw new HttpError(400, 'Too many notes (max 1000 per import)');
    let imported = 0, skipped = 0;
    for (const raw of body.notes) {
      try {
        const data = validate({ title: raw.title ?? '', content: raw.content ?? '', tags: raw.tags ?? [], color: raw.color ?? 'default', pinned: !!raw.pinned, archived: !!raw.archived }, { partial: true });
        const note = makeNote({ ...data, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined });
        notes.set(note.id, note); // always a fresh id: importing never overwrites existing notes
        imported++;
      } catch { skipped++; }
    }
    return send(res, 200, { imported, skipped });
  }

  if ((r = p.match(/^\/api\/notes\/([\w-]+)$/))) {
    const note = getNote(r[1]);
    if (m === 'GET') return send(res, 200, { ...publicNote(note) });
    if (m === 'PUT' || m === 'PATCH') {
      if (note.deletedAt) throw new HttpError(409, 'Note is in the trash. Restore it first');
      applyUpdate(note, validate(await readBody(req), { partial: true }));
      return send(res, 200, publicNote(note));
    }
    if (m === 'DELETE') {
      if (url.searchParams.get('permanent') === 'true' || note.deletedAt) { notes.delete(note.id); return send(res, 204); }
      note.deletedAt = now();
      return send(res, 200, publicNote(note));
    }
  }
  if ((r = p.match(/^\/api\/notes\/([\w-]+)\/restore$/)) && m === 'POST') {
    const note = getNote(r[1]);
    note.deletedAt = null;
    return send(res, 200, publicNote(note));
  }
  if ((r = p.match(/^\/api\/notes\/([\w-]+)\/duplicate$/)) && m === 'POST') {
    const src = getNote(r[1]);
    const copy = makeNote({ title: (src.title || 'Untitled') + ' (copy)', content: src.content, tags: [...src.tags], color: src.color });
    notes.set(copy.id, copy);
    return send(res, 201, publicNote(copy));
  }
  if ((r = p.match(/^\/api\/notes\/([\w-]+)\/versions$/)) && m === 'GET') {
    return send(res, 200, getNote(r[1]).versions.slice().reverse());
  }
  if ((r = p.match(/^\/api\/notes\/([\w-]+)\/versions\/([\w-]+)\/restore$/)) && m === 'POST') {
    const note = getNote(r[1]);
    const v = note.versions.find((x) => x.id === r[2]);
    if (!v) throw new HttpError(404, 'Version not found');
    applyUpdate(note, { title: v.title, content: v.content });
    return send(res, 200, publicNote(note));
  }

  throw new HttpError(404, `No route for ${m} ${url.pathname}`);
}

// ---------------------------------------------------------------- static files
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const started = Date.now();
  res.on('finish', () => console.log(`${new Date().toISOString()}  ${req.method.padEnd(6)} ${url.pathname}  ${res.statusCode}  ${Date.now() - started}ms`));

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try { await handleApi(req, res, url); }
    catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Internal server error' : err.message });
    }
    return;
  }

  const file = STATIC[url.pathname];
  if (req.method === 'GET' && file) {
    return fs.readFile(path.join(__dirname, file[0]), (err, data) => {
      if (err) { res.writeHead(500); return res.end('Could not read file'); }
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// A welcome note so the app doesn't start empty (also lives only in memory)
notes.set('welcome', Object.assign(makeNote({
  title: 'Welcome to Notes 👋',
  tags: ['welcome', 'guide'],
  color: 'blue',
  pinned: true,
  content: `# Welcome!

This note app talks to its own **REST API** and keeps everything *in memory*, so there is no database.

## Things to try
- [x] Open this note
- [ ] Create a note with **Ctrl+N**
- [ ] Pin, colour and tag notes
- [ ] Switch between Edit / Split / Preview
- [ ] Open **History** to restore an older version
- [ ] Press **Ctrl+K** to search
- [ ] Export your notes as JSON before you stop the server

> Tip: visit /api in the browser to see every endpoint.

\`\`\`
curl http://localhost:3000/api/notes
\`\`\`
`,
}), { id: 'welcome' }));

server.listen(PORT, () => {
  console.log(`\n  Notes app running  ->  http://localhost:${PORT}`);
  console.log(`  API index          ->  http://localhost:${PORT}/api`);
  console.log('  Storage            ->  in memory only (no database)\n');
});
