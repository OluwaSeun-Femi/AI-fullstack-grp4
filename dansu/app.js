(() => {
  'use strict';
  const $ = (s, e = document) => e.querySelector(s);
  const $$ = (s, e = document) => [...e.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];

  const state = {
    view: 'active', tag: null, color: null, q: '', sort: 'updated',
    notes: [], tags: [], current: null, tagsDraft: [], mode: 'split', saveTimer: null,
  };

  // ------------------------------------------------------------- API client
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function toast(msg, err) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

  function timeAgo(iso) {
    const s = Math.round((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString();
  }

  // ------------------------------------------------------------- tiny, safe markdown renderer
  function md(src) {
    const blocks = [];
    const text = esc(src).replace(/```[\w-]*\n([\s\S]*?)```/g, (m, code) => {
      blocks.push('<pre><code>' + code + '</code></pre>');
      return '\u0000' + (blocks.length - 1) + '\u0000';
    });
    const inline = (s) => s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    const out = []; let list = null; let para = [];
    const flush = () => { if (para.length) { out.push('<p>' + inline(para.join('<br>')) + '</p>'); para = []; } };
    const open = (type) => { if (list !== type) { closeList(); out.push('<' + type + '>'); list = type; } };
    const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    for (const line of text.split('\n')) {
      let m;
      if (/^\u0000\d+\u0000$/.test(line.trim())) { flush(); closeList(); out.push(line.trim()); continue; }
      if (!line.trim()) { flush(); closeList(); continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flush(); closeList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
      if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flush(); closeList(); out.push('<hr>'); continue; }
      if ((m = line.match(/^&gt;\s?(.*)$/))) { flush(); closeList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
      if ((m = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)$/i))) {
        flush(); open('ul');
        out.push(`<li class="task"><input type="checkbox" disabled ${m[1].toLowerCase() === 'x' ? 'checked' : ''}> ${inline(m[2])}</li>`); continue;
      }
      if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { flush(); open('ul'); out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { flush(); open('ol'); out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      closeList(); para.push(line);
    }
    flush(); closeList();
    return out.join('\n').replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[i]);
  }

  // ------------------------------------------------------------- loading + rendering the list
  async function loadNotes() {
    const p = new URLSearchParams({ view: state.view, sort: state.sort, limit: '100' });
    if (state.q) p.set('q', state.q);
    if (state.tag) p.set('tag', state.tag);
    if (state.color) p.set('color', state.color);
    const res = await api('/notes?' + p);
    state.notes = res.data;
    renderList();
  }
  async function loadSide() {
    const [tags, stats] = await Promise.all([api('/tags'), api('/stats')]);
    state.tags = tags;
    $('#c-active').textContent = stats.active;
    $('#c-archived').textContent = stats.archived;
    $('#c-trash').textContent = stats.trash;
    const box = $('#tagList');
    box.innerHTML = tags.length ? '' : '<span class="count">No tags yet</span>';
    tags.forEach((t) => {
      const b = document.createElement('button');
      b.className = 'tag' + (state.tag === t.tag ? ' active' : '');
      b.textContent = `#${t.tag} ${t.count}`;
      b.onclick = () => { state.tag = state.tag === t.tag ? null : t.tag; refresh(); };
      box.appendChild(b);
    });
  }
  const refresh = guard(async () => { await Promise.all([loadNotes(), loadSide()]); });

  function plain(s) { return s.replace(/[#>*`_~\[\]()-]/g, '').replace(/\s+/g, ' ').trim(); }

  function renderList() {
    const box = $('#list');
    $('#emptyTrash').classList.toggle('hidden', state.view !== 'trash' || !state.notes.length);
    if (!state.notes.length) {
      box.innerHTML = `<div class="none">${state.q || state.tag || state.color ? 'No notes match your filters.' : state.view === 'trash' ? 'Trash is empty.' : state.view === 'archived' ? 'Nothing archived.' : 'No notes yet. Press Ctrl+N!'}</div>`;
      return;
    }
    box.innerHTML = '';
    state.notes.forEach((n) => {
      const el = document.createElement('div');
      el.className = 'card' + (state.current && state.current.id === n.id ? ' sel' : '');
      el.dataset.color = n.color;
      el.innerHTML = `
        <h4>${n.pinned ? '📌' : ''}<span>${esc(n.title || 'Untitled')}</span></h4>
        <p>${esc(plain(n.content).slice(0, 160)) || '<i>Empty note</i>'}</p>
        <div class="meta"><span>${timeAgo(n.updatedAt)}</span><span>· ${n.wordCount} words</span>
        ${n.tags.slice(0, 3).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>`;
      el.onclick = () => openNote(n.id);
      box.appendChild(el);
    });
  }

  // ------------------------------------------------------------- editor
  async function flushSave() {
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; await save(); }
  }

  const openNote = guard(async (id) => {
    await flushSave();
    state.current = await api('/notes/' + id);
    state.tagsDraft = [...state.current.tags];
    fillEditor();
    renderList();
    $('#app').classList.add('editing');
  });

  function fillEditor() {
    const n = state.current;
    $('#empty').classList.toggle('hidden', !!n);
    $('#editor').classList.toggle('hidden', !n);
    if (!n) return;
    const trash = !!n.deletedAt;
    $('#editor').classList.toggle('readonly', trash);
    $('#title').value = n.title;
    $('#content').value = n.content;
    $('#pinBtn').classList.toggle('on', n.pinned);
    $('#archiveBtn').title = n.archived ? 'Unarchive' : 'Archive';
    $('#archiveBtn').classList.toggle('on', n.archived);
    $('#restoreBtn').classList.toggle('hidden', !trash);
    ['pinBtn', 'archiveBtn', 'historyBtn', 'dupBtn'].forEach((i) => $('#' + i).classList.toggle('hidden', trash));
    $('#delBtn').title = trash ? 'Delete forever' : 'Move to trash';
    renderChips(); renderColors(); renderPreview(); renderFoot();
    $('#status').textContent = trash ? 'In trash (read-only)' : 'All changes saved';
  }

  function renderChips() {
    const box = $('#chips');
    $$('.chip', box).forEach((c) => c.remove());
    const input = $('#tagInput');
    state.tagsDraft.forEach((t) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.innerHTML = `#${esc(t)} <button title="Remove">✕</button>`;
      c.querySelector('button').onclick = () => { state.tagsDraft = state.tagsDraft.filter((x) => x !== t); renderChips(); scheduleSave(); };
      box.insertBefore(c, input);
    });
    input.classList.toggle('hidden', !!(state.current && state.current.deletedAt));
  }

  function renderColors() {
    const box = $('#colors');
    box.innerHTML = '';
    COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'sw' + (state.current.color === c ? ' active' : '');
      b.dataset.c = c; b.title = c;
      b.onclick = () => { if (state.current.deletedAt) return; state.current.color = c; renderColors(); scheduleSave(); };
      box.appendChild(b);
    });
  }

  function renderPreview() { $('#preview').innerHTML = md($('#content').value); }
  function renderFoot() {
    const n = state.current;
    const text = $('#content').value;
    const w = text.trim() ? text.trim().split(/\s+/).length : 0;
    $('#edFoot').innerHTML = `<span>${w} words</span><span>${text.length} characters</span><span>~${Math.max(1, Math.round(w / 200))} min read</span>
      <span>Created ${new Date(n.createdAt).toLocaleString()}</span><span>Edited ${timeAgo(n.updatedAt)}</span>`;
  }

  function scheduleSave() {
    if (!state.current || state.current.deletedAt) return;
    $('#status').textContent = 'Saving…';
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => { state.saveTimer = null; save(); }, 700);
  }

  const save = guard(async () => {
    const n = state.current;
    if (!n || n.deletedAt) return;
    const updated = await api('/notes/' + n.id, {
      method: 'PUT',
      body: { title: $('#title').value, content: $('#content').value, tags: state.tagsDraft, color: n.color },
    });
    if (!state.current || state.current.id !== updated.id) return;
    state.current = { ...state.current, ...updated };
    $('#status').textContent = 'Saved ✓ ' + new Date().toLocaleTimeString();
    renderFoot();
    await Promise.all([loadNotes(), loadSide()]);
  });

  const patch = guard(async (changes) => {
    await flushSave();
    state.current = await api('/notes/' + state.current.id, { method: 'PUT', body: changes });
    state.tagsDraft = [...state.current.tags];
    fillEditor();
    await refresh();
  });

  function closeEditor() { state.current = null; fillEditor(); $('#app').classList.remove('editing'); renderList(); }

  // ------------------------------------------------------------- actions
  const newNote = guard(async () => {
    await flushSave();
    if (state.view !== 'active') { state.view = 'active'; syncNav(); }
    state.q = ''; state.tag = null; state.color = null; $('#search').value = '';
    const n = await api('/notes', { method: 'POST', body: { title: '', content: '' } });
    await refresh();
    await openNote(n.id);
    $('#title').focus();
  });

  const deleteCurrent = guard(async () => {
    const n = state.current;
    if (!n) return;
    if (n.deletedAt) {
      if (!confirm('Delete this note forever? This cannot be undone.')) return;
      await api(`/notes/${n.id}?permanent=true`, { method: 'DELETE' });
      toast('Note deleted forever');
    } else {
      await flushSave();
      await api('/notes/' + n.id, { method: 'DELETE' });
      toast('Moved to trash');
    }
    closeEditor(); await refresh();
  });

  const restoreCurrent = guard(async () => {
    await api(`/notes/${state.current.id}/restore`, { method: 'POST' });
    toast('Note restored'); closeEditor(); await refresh();
  });

  const duplicateCurrent = guard(async () => {
    await flushSave();
    const c = await api(`/notes/${state.current.id}/duplicate`, { method: 'POST' });
    toast('Note duplicated'); await refresh(); await openNote(c.id);
  });

  function downloadBlob(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  function downloadMd() {
    const n = state.current;
    const name = (($('#title').value || 'note').replace(/[^\w\- ]+/g, '').trim() || 'note') + '.md';
    downloadBlob(name, `# ${$('#title').value}\n\n${$('#content').value}\n`, 'text/markdown');
  }

  // ------------------------------------------------------------- modals
  function modal(title, html) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modalBack').classList.remove('hidden');
  }
  const closeModal = () => $('#modalBack').classList.add('hidden');

  const showHistory = guard(async () => {
    await flushSave();
    const versions = await api(`/notes/${state.current.id}/versions`);
    modal('Version history', versions.length ? '' : '<p class="none">No earlier versions yet. Versions are saved automatically as you edit.</p>');
    versions.forEach((v) => {
      const d = document.createElement('div');
      d.className = 'ver';
      d.innerHTML = `<div><b>${esc(v.title || 'Untitled')}</b> <span class="count">${new Date(v.savedAt).toLocaleString()}</span>
        <p>${esc(plain(v.content).slice(0, 120)) || '<i>Empty</i>'}</p></div><button class="btn small">Restore</button>`;
      d.querySelector('button').onclick = guard(async () => {
        state.current = await api(`/notes/${state.current.id}/versions/${v.id}/restore`, { method: 'POST' });
        state.tagsDraft = [...state.current.tags];
        fillEditor(); closeModal(); toast('Version restored'); await refresh();
      });
      $('#modalBody').appendChild(d);
    });
  });

  const showStats = guard(async () => {
    const s = await api('/stats');
    const max = Math.max(1, ...s.last7Days.map((d) => d.created));
    modal('Your notes at a glance', `
      <div class="stat-grid">
        <div class="stat"><b>${s.active}</b><span>Active notes</span></div>
        <div class="stat"><b>${s.pinned}</b><span>Pinned</span></div>
        <div class="stat"><b>${s.archived}</b><span>Archived</span></div>
        <div class="stat"><b>${s.totalWords}</b><span>Total words</span></div>
        <div class="stat"><b>${s.avgWords}</b><span>Avg words / note</span></div>
        <div class="stat"><b>${s.readingMinutes} min</b><span>Total reading time</span></div>
        <div class="stat"><b>${s.uniqueTags}</b><span>Unique tags</span></div>
        <div class="stat"><b>${Math.floor(s.uptimeSeconds / 60)} min</b><span>Server uptime</span></div>
      </div>
      <b>Notes created, last 7 days</b>
      <div class="bars">${s.last7Days.map((d) => `<div class="bar" style="height:${(d.created / max) * 100}%"><i>${d.created}</i></div>`).join('')}</div>
      <div class="bar-labels">${s.last7Days.map((d) => `<span>${d.date.slice(5)}</span>`).join('')}</div>
      <p class="count">${s.longest ? `Longest note: “${esc(s.longest.title)}” (${s.longest.words} words)` : ''}</p>
      <p class="count">Storage: ${esc(s.storage)}. Export your notes before stopping the server.</p>`);
  });

  // ------------------------------------------------------------- misc UI wiring
  function syncNav() { $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view)); }

  function buildColorFilter() {
    const box = $('#colorFilter');
    COLORS.filter((c) => c !== 'default').forEach((c) => {
      const b = document.createElement('button');
      b.className = 'sw'; b.dataset.c = c; b.title = 'Filter: ' + c;
      b.onclick = () => { state.color = state.color === c ? null : c; $$('.sw', box).forEach((x) => x.classList.toggle('active', x.dataset.c === state.color)); loadNotes(); };
      box.appendChild(b);
    });
  }

  function applyTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('theme', t); } catch {} }
  function initTheme() {
    let t = null;
    try { t = localStorage.getItem('theme'); } catch {}
    applyTheme(t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  }

  function setMode(m) {
    state.mode = m;
    $('#edBody').className = 'ed-body ' + m;
    $$('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  }

  function format(f) {
    const ta = $('#content');
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e);
    let ins;
    if (['**', '*', '`'].includes(f)) ins = f + (sel || 'text') + f;
    else {
      const ls = value.lastIndexOf('\n', s - 1) + 1;
      ta.value = value.slice(0, ls) + f + value.slice(ls);
      ta.setSelectionRange(s + f.length, e + f.length); ta.focus();
      renderPreview(); scheduleSave(); return;
    }
    ta.value = value.slice(0, s) + ins + value.slice(e);
    ta.setSelectionRange(s + f.length, s + ins.length - f.length); ta.focus();
    renderPreview(); scheduleSave();
  }

  function wire() {
    $('#newBtn').onclick = newNote;
    $('#nav').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.view = b.dataset.view; state.tag = null; syncNav(); closeEditor(); refresh();
    };
    let st; $('#search').oninput = (e) => { clearTimeout(st); st = setTimeout(() => { state.q = e.target.value; loadNotes().catch((x) => toast(x.message, true)); }, 200); };
    $('#sort').onchange = (e) => { state.sort = e.target.value; loadNotes().catch((x) => toast(x.message, true)); };
    $('#emptyTrash').onclick = guard(async () => {
      if (!confirm('Permanently delete everything in the trash?')) return;
      const r = await api('/trash', { method: 'DELETE' });
      toast(`${r.removed} note(s) erased`); closeEditor(); refresh();
    });

    $('#title').oninput = scheduleSave;
    $('#content').oninput = () => { renderPreview(); renderFoot(); scheduleSave(); };
    $('#tagInput').onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const v = e.target.value.trim().toLowerCase().replace(/^#/, '');
        if (v && !state.tagsDraft.includes(v) && state.tagsDraft.length < 10) { state.tagsDraft.push(v); renderChips(); scheduleSave(); }
        e.target.value = '';
        $('#tagInput').focus();
      } else if (e.key === 'Backspace' && !e.target.value && state.tagsDraft.length) {
        state.tagsDraft.pop(); renderChips(); scheduleSave(); $('#tagInput').focus();
      }
    };

    $('#pinBtn').onclick = () => patch({ pinned: !state.current.pinned });
    $('#archiveBtn').onclick = guard(async () => {
      const archived = !state.current.archived;
      await patch({ archived });
      toast(archived ? 'Archived' : 'Unarchived');
      closeEditor();
    });
    $('#historyBtn').onclick = showHistory;
    $('#dupBtn').onclick = duplicateCurrent;
    $('#mdBtn').onclick = downloadMd;
    $('#delBtn').onclick = deleteCurrent;
    $('#restoreBtn').onclick = restoreCurrent;
    $('#backBtn').onclick = async () => { await flushSave(); $('#app').classList.remove('editing'); };
    $('#modes').onclick = (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); };
    $('#fmt').onclick = (e) => { const b = e.target.closest('button'); if (b && !state.current.deletedAt) format(b.dataset.f); };

    $('#statsBtn').onclick = showStats;
    $('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    $('#exportBtn').onclick = () => { window.location.href = '/api/export'; };
    $('#importBtn').onclick = () => $('#importFile').click();
    $('#importFile').onchange = guard(async (e) => {
      const f = e.target.files[0]; if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch { throw new Error('That file is not valid JSON'); }
      const r = await api('/import', { method: 'POST', body: data });
      toast(`Imported ${r.imported} note(s)` + (r.skipped ? `, skipped ${r.skipped}` : ''));
      e.target.value = ''; refresh();
    });
    $('#modalClose').onclick = closeModal;
    $('#modalBack').onclick = (e) => { if (e.target.id === 'modalBack') closeModal(); };

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
      else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); flushSave(); }
      else if (mod && e.key === '/') { e.preventDefault(); setMode(state.mode === 'preview' ? 'split' : 'preview'); }
      else if (e.key === 'Escape') closeModal();
    });
    window.addEventListener('beforeunload', () => { if (state.saveTimer) flushSave(); });
  }

  initTheme(); buildColorFilter(); wire(); setMode('split'); fillEditor(); refresh();
})();
