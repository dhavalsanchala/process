/* =========================================================
   ProcDocs — app.js
   Vanilla JS, IndexedDB-backed documentation hub
   ========================================================= */

const APP_VERSION = '1.0.0';
const SCHEMA_VERSION = 1;
const DB_NAME = 'procDocsDB';
const DB_VERSION = 2;
const STORES = ['processes', 'checklists', 'emailTemplates', 'insights', 'folders',
                'checklistSnapshots', 'stepNotes', 'meta', 'trash', 'autoBackups'];

/* ---------- Utilities ---------- */
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0;
  return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});
const now = () => new Date().toISOString();
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  const diff = (now - d) / 86400000;
  if (diff < 7) return d.toLocaleDateString([], {weekday:'short'});
  return d.toLocaleDateString([], {day:'numeric', month:'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined});
}
function formatFull(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

async function sha256(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ---------- IndexedDB helper ---------- */
const db = {
  _db: null,
  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = (e) => {
        const idb = req.result;
        const ensure = (name, idx = []) => {
          if (!idb.objectStoreNames.contains(name)) {
            const s = idb.createObjectStore(name, { keyPath: 'id' });
            idx.forEach(i => s.createIndex(i.name, i.key, i.opts || {}));
          }
        };
        ensure('processes', [
          {name:'folderId', key:'folderId'},
          {name:'updatedAt', key:'updatedAt'},
          {name:'tags', key:'tags', opts:{multiEntry:true}}
        ]);
        ensure('checklists', [
          {name:'folderId', key:'folderId'},
          {name:'updatedAt', key:'updatedAt'},
          {name:'tags', key:'tags', opts:{multiEntry:true}}
        ]);
        ensure('emailTemplates', [
          {name:'folderId', key:'folderId'},
          {name:'updatedAt', key:'updatedAt'},
          {name:'tags', key:'tags', opts:{multiEntry:true}}
        ]);
        ensure('insights', [
          {name:'folderId', key:'folderId'},
          {name:'updatedAt', key:'updatedAt'},
          {name:'date', key:'date'},
          {name:'flag', key:'flag'},
          {name:'tags', key:'tags', opts:{multiEntry:true}}
        ]);
        ensure('folders', [
          {name:'parentId', key:'parentId'},
          {name:'tabScope', key:'tabScope'}
        ]);
        ensure('checklistSnapshots', [
          {name:'checklistId', key:'checklistId'},
          {name:'completedAt', key:'completedAt'}
        ]);
        ensure('stepNotes', [
          {name:'processId', key:'processId'},
          {name:'stepId', key:'stepId'},
          {name:'createdAt', key:'createdAt'}
        ]);
        ensure('meta');
        ensure('trash', [{name:'deletedAt', key:'deletedAt'}]);
        ensure('autoBackups', [{name:'createdAt', key:'createdAt'}]);
      };
      req.onsuccess = () => { this._db = req.result; resolve(req.result); };
    });
  },
  _tx(stores, mode = 'readonly') {
    return this._db.transaction(stores, mode);
  },
  async get(store, id) {
    await this.open();
    return new Promise((res, rej) => {
      const r = this._tx(store).objectStore(store).get(id);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async getAll(store) {
    await this.open();
    return new Promise((res, rej) => {
      const r = this._tx(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async getByIndex(store, indexName, value) {
    await this.open();
    return new Promise((res, rej) => {
      const tx = this._tx(store);
      const idx = tx.objectStore(store).index(indexName);
      const r = idx.getAll(value);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async put(store, value) {
    await this.open();
    return new Promise((res, rej) => {
      const r = this._tx(store, 'readwrite').objectStore(store).put(value);
      r.onsuccess = () => res(value);
      r.onerror = () => rej(r.error);
    });
  },
  async bulkPut(store, values) {
    await this.open();
    return new Promise((res, rej) => {
      const tx = this._tx(store, 'readwrite');
      const os = tx.objectStore(store);
      values.forEach(v => os.put(v));
      tx.oncomplete = () => res(values.length);
      tx.onerror = () => rej(tx.error);
    });
  },
  async delete(store, id) {
    await this.open();
    return new Promise((res, rej) => {
      const r = this._tx(store, 'readwrite').objectStore(store).delete(id);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  },
  async clear(store) {
    await this.open();
    return new Promise((res, rej) => {
      const r = this._tx(store, 'readwrite').objectStore(store).clear();
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  },
  async count(store) {
    await this.open();
    return new Promise((res, rej) => {
      const r = this._tx(store).objectStore(store).count();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
};

/* ---------- App state ---------- */
const state = {
  currentTab: 'processes',
  currentFolderId: null,
  currentItemId: null,
  folders: [],
  items: [],
  sortBy: 'updated',
  theme: 'light',
  searchIndex: null,
  contextMenuTarget: null,
  linker: { stepId: null, type: null, selected: new Set() },
  selection: new Set(),  // multi-select item ids
  lastSelectedId: null,  // for shift-click range select
  folderPicker: null     // { onPick: (folderId) => void, exclude: Set<string> }
};

/* ---------- Meta / settings ---------- */
async function getMeta(key, dflt = null) {
  const m = await db.get('meta', key);
  return m ? m.value : dflt;
}
async function setMeta(key, value) {
  await db.put('meta', { id: key, value, updatedAt: now() });
}

/* ---------- Toast / save indicator ---------- */
function toast(msg, type = '') {
  const c = $('#toastContainer');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
const showSaved = debounce(() => {
  const el = $('#saveIndicator');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1200);
}, 100);

/* ---------- Seeding defaults ---------- */
async function seedIfEmpty() {
  const tabs = ['processes', 'checklists', 'emailTemplates', 'insights'];
  for (const t of tabs) {
    const existing = await db.get('folders', 'uncat_' + t);
    if (!existing) {
      await db.put('folders', {
        id: 'uncat_' + t,
        name: 'Uncategorized',
        parentId: null,
        tabScope: t,
        color: '#8a7f70',
        builtIn: true,
        createdAt: now(),
        updatedAt: now(),
        collapsed: false
      });
    }
  }
}

/* ---------- Folders ---------- */
async function getFoldersForTab(tab) {
  return await db.getByIndex('folders', 'tabScope', tab);
}
function buildFolderTree(folders) {
  const byParent = {};
  folders.forEach(f => {
    const p = f.parentId || 'root';
    (byParent[p] = byParent[p] || []).push(f);
  });
  Object.values(byParent).forEach(arr => arr.sort((a,b) => {
    if (a.builtIn && !b.builtIn) return -1;
    if (!a.builtIn && b.builtIn) return 1;
    return a.name.localeCompare(b.name);
  }));
  return byParent;
}
async function renderFolderTree() {
  state.folders = await getFoldersForTab(state.currentTab);
  const tree = buildFolderTree(state.folders);
  const itemCounts = await computeFolderCounts();
  const root = $('#folderTree');
  root.innerHTML = '';

  // "All items" pseudo folder
  const allDiv = document.createElement('div');
  allDiv.className = 'folder-node';
  const allRow = document.createElement('div');
  allRow.className = 'folder-row' + (state.currentFolderId === null ? ' active' : '');
  allRow.innerHTML = `
    <span class="folder-caret empty"></span>
    <span class="folder-dot" style="background:var(--accent)"></span>
    <span class="folder-label">All</span>
    <span class="folder-count">${state.items.length || ''}</span>
  `;
  allRow.onclick = () => { state.currentFolderId = null; clearSelection(); loadList(); renderFolderTree(); if (isMobile()) setMobileScreen('list'); };
  allDiv.appendChild(allRow);
  root.appendChild(allDiv);

  const renderLevel = (parentId, container) => {
    const list = tree[parentId || 'root'] || [];
    list.forEach(f => {
      const total = itemCounts[f.id] || 0;
      const node = document.createElement('div');
      node.className = 'folder-node';
      const hasChildren = (tree[f.id] || []).length > 0;
      const collapsed = !!f.collapsed;
      const row = document.createElement('div');
      row.className = 'folder-row' + (state.currentFolderId === f.id ? ' active' : '');
      row.dataset.folderId = f.id;
      row.innerHTML = `
        <span class="folder-caret ${hasChildren ? '' : 'empty'} ${collapsed ? 'collapsed' : ''}">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
        </span>
        <span class="folder-dot" style="background:${escapeHtml(f.color || '#8a7f70')}"></span>
        <span class="folder-label">${escapeHtml(f.name)}</span>
        <span class="folder-count">${total || ''}</span>
      `;
      row.onclick = (e) => {
        if (e.target.closest('.folder-caret') && hasChildren) {
          toggleFolderCollapse(f.id);
          return;
        }
        state.currentFolderId = f.id;
        clearSelection();
        loadList();
        renderFolderTree();
        if (isMobile()) setMobileScreen('list');
      };
      row.oncontextmenu = (e) => { e.preventDefault(); if (isMobile()) { openFolderActionSheet(f); } else { openFolderContextMenu(e, f); } };
      attachLongPress(row, () => openFolderActionSheet(f));

      // Make folders draggable for re-parenting
      row.draggable = !f.builtIn;
      row.ondragstart = (e) => {
        e.dataTransfer.setData('text/folder', JSON.stringify({ folderId: f.id }));
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('drag-source');
      };
      row.ondragend = () => row.classList.remove('drag-source');

      // Accept drops: items from list, or other folders for re-parenting
      row.ondragover = (e) => {
        e.preventDefault();
        // distinguish folder-on-folder from item-on-folder visually
        const isFolderDrag = e.dataTransfer.types.includes('text/folder');
        if (isFolderDrag) {
          row.classList.add('drag-target');
        } else {
          row.classList.add('drag-over');
        }
      };
      row.ondragleave = () => {
        row.classList.remove('drag-over');
        row.classList.remove('drag-target');
      };
      row.ondrop = async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        row.classList.remove('drag-target');
        // Folder-on-folder: re-parent
        const folderPayload = e.dataTransfer.getData('text/folder');
        if (folderPayload) {
          try {
            const { folderId: draggedId } = JSON.parse(folderPayload);
            if (draggedId === f.id) return; // no-op drop on self
            await reparentFolder(draggedId, f.id);
          } catch (err) { console.error(err); }
          return;
        }
        // Items-on-folder: move one or many
        const data = e.dataTransfer.getData('text/plain');
        if (data) {
          try {
            const parsed = JSON.parse(data);
            const ids = parsed.itemIds || (parsed.itemId ? [parsed.itemId] : []);
            const store = parsed.store || state.currentTab;
            if (ids.length === 0) return;
            await moveItemsToFolder(ids, store, f.id);
            toast(`Moved ${ids.length} item${ids.length === 1 ? '' : 's'} to ${f.name}`);
          } catch (err) { console.error(err); }
        }
      };
      node.appendChild(row);
      if (hasChildren) {
        const childWrap = document.createElement('div');
        childWrap.className = 'folder-children' + (collapsed ? ' collapsed' : '');
        renderLevel(f.id, childWrap);
        node.appendChild(childWrap);
      }
      container.appendChild(node);
    });
  };
  renderLevel(null, root);
}

async function toggleFolderCollapse(id) {
  const f = await db.get('folders', id);
  f.collapsed = !f.collapsed;
  await db.put('folders', f);
  renderFolderTree();
}

async function computeFolderCounts() {
  const items = await db.getAll(state.currentTab);
  const counts = {};
  items.filter(i => !i.deleted).forEach(i => {
    counts[i.folderId] = (counts[i.folderId] || 0) + 1;
  });
  return counts;
}

/* ---------- Folder context menu ---------- */
function openFolderContextMenu(e, folder) {
  state.contextMenuTarget = folder;
  const menu = $('#folderContextMenu');
  menu.hidden = false;
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
}
function closeFolderContextMenu() {
  $('#folderContextMenu').hidden = true;
  state.contextMenuTarget = null;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('#folderContextMenu')) closeFolderContextMenu();
});
$('#folderContextMenu').addEventListener('click', async (e) => {
  const action = e.target.closest('button')?.dataset.action;
  const f = state.contextMenuTarget;
  if (!f || !action) return;
  closeFolderContextMenu();
  if (action === 'rename') {
    const nn = prompt('Rename folder', f.name);
    if (nn && nn.trim()) { f.name = nn.trim(); f.updatedAt = now(); await db.put('folders', f); renderFolderTree(); }
  } else if (action === 'addSub') {
    const nn = prompt('New sub-folder name');
    if (nn && nn.trim()) await createFolder(nn.trim(), f.id);
  } else if (action === 'color') {
    const c = prompt('Hex colour (e.g. #8b3a1f)', f.color || '#8a7f70');
    if (c) { f.color = c; f.updatedAt = now(); await db.put('folders', f); renderFolderTree(); }
  } else if (action === 'moveFolder') {
    if (f.builtIn) { toast('Cannot move the Uncategorized folder', 'error'); return; }
    // Build exclude set: this folder + all its descendants
    const all = await db.getAll('folders');
    const excl = new Set([f.id]);
    let added = true;
    while (added) {
      added = false;
      for (const x of all) {
        if (!excl.has(x.id) && x.parentId && excl.has(x.parentId)) {
          excl.add(x.id);
          added = true;
        }
      }
    }
    openFolderPicker({
      title: `Move "${f.name}" to…`,
      tabScope: f.tabScope,
      excludeIds: excl,
      onPick: async (folderId) => {
        await reparentFolder(f.id, folderId);
      }
    });
  } else if (action === 'exportFolder') {
    await exportFolderById(f.id);
  } else if (action === 'importIntoFolder') {
    triggerFolderImport(f.id);
  } else if (action === 'delete') {
    if (f.builtIn) { toast('Cannot delete the Uncategorized folder', 'error'); return; }
    const items = (await db.getByIndex(state.currentTab, 'folderId', f.id)).length;
    confirmDialog({
      title: 'Delete folder?',
      message: `Delete "${f.name}"? ${items > 0 ? `${items} item(s) inside will move to Uncategorized.` : ''}`,
      ok: async () => {
        // move children up to parent, items to uncat
        const subs = await db.getByIndex('folders', 'parentId', f.id);
        for (const s of subs) { s.parentId = f.parentId; await db.put('folders', s); }
        const itemsInF = await db.getByIndex(state.currentTab, 'folderId', f.id);
        for (const it of itemsInF) { it.folderId = 'uncat_' + state.currentTab; it.updatedAt = now(); await db.put(state.currentTab, it); }
        await db.delete('folders', f.id);
        renderFolderTree(); loadList();
        toast('Folder deleted');
      }
    });
  }
});

async function createFolder(name, parentId = null) {
  const f = {
    id: uuid(),
    name,
    parentId,
    tabScope: state.currentTab,
    color: '#8a7f70',
    builtIn: false,
    createdAt: now(),
    updatedAt: now(),
    collapsed: false
  };
  await db.put('folders', f);
  renderFolderTree();
  toast('Folder created');
}

/* ---------- Move helpers ---------- */
async function moveItemsToFolder(itemIds, store, targetFolderId) {
  for (const id of itemIds) {
    const it = await db.get(store, id);
    if (!it) continue;
    it.folderId = targetFolderId;
    it.updatedAt = now();
    await db.put(store, it);
  }
  clearSelection();
  await renderFolderTree();
  await loadList();
}

async function reparentFolder(folderId, newParentId) {
  if (folderId === newParentId) { toast('Cannot move a folder into itself', 'error'); return; }
  const folder = await db.get('folders', folderId);
  if (!folder) return;
  if (folder.builtIn) { toast('Cannot move the Uncategorized folder', 'error'); return; }
  // Prevent moving a folder into one of its own descendants
  const allFolders = await db.getAll('folders');
  const descendants = new Set([folderId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of allFolders) {
      if (!descendants.has(f.id) && f.parentId && descendants.has(f.parentId)) {
        descendants.add(f.id);
        added = true;
      }
    }
  }
  if (descendants.has(newParentId)) {
    toast('Cannot move a folder into its own sub-folder', 'error');
    return;
  }
  // tabScope must match
  const newParent = await db.get('folders', newParentId);
  if (newParent && newParent.tabScope !== folder.tabScope) {
    toast('Cannot move folder across tabs', 'error');
    return;
  }
  folder.parentId = newParentId;
  folder.updatedAt = now();
  await db.put('folders', folder);
  await renderFolderTree();
  toast(`Moved "${folder.name}" into "${newParent?.name || 'root'}"`);
}

/* ---------- Multi-select ---------- */
function toggleItemSelection(itemId, isShift) {
  if (isShift && state.lastSelectedId && state.lastSelectedId !== itemId) {
    // Range select between lastSelectedId and itemId
    const idx1 = state.items.findIndex(i => i.id === state.lastSelectedId);
    const idx2 = state.items.findIndex(i => i.id === itemId);
    if (idx1 >= 0 && idx2 >= 0) {
      const [lo, hi] = idx1 < idx2 ? [idx1, idx2] : [idx2, idx1];
      for (let k = lo; k <= hi; k++) state.selection.add(state.items[k].id);
    }
  } else {
    if (state.selection.has(itemId)) state.selection.delete(itemId);
    else state.selection.add(itemId);
  }
  state.lastSelectedId = itemId;
  // Re-render to reflect selection
  const containers = $$('.list-item');
  containers.forEach(el => {
    const id = el.dataset.id;
    const sel = state.selection.has(id);
    el.classList.toggle('multi-selected', sel);
    const cb = el.querySelector('[data-checkbox]');
    if (cb) cb.classList.toggle('checked', sel);
  });
  updateMultiselectBar();
}
function clearSelection() {
  state.selection.clear();
  state.lastSelectedId = null;
  $$('.list-item').forEach(el => {
    el.classList.remove('multi-selected');
    const cb = el.querySelector('[data-checkbox]');
    if (cb) cb.classList.remove('checked');
  });
  updateMultiselectBar();
}
function updateMultiselectBar() {
  const bar = $('#multiselectBar');
  const count = state.selection.size;
  if (count === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  $('#multiselectCount').textContent = `${count} selected`;
}

/* ---------- Folder picker (reusable modal) ---------- */
async function openFolderPicker({ title, tabScope, excludeIds = new Set(), onPick }) {
  state.folderPicker = { onPick, excludeIds: new Set(excludeIds), tabScope, selectedId: null };
  $('#folderPickerTitle').textContent = title || 'Move to folder';
  $('#folderPickerSearch').value = '';
  $('#folderPickerConfirm').disabled = true;
  $('#folderPickerModal').hidden = false;
  await populateFolderPicker('');
  setTimeout(() => $('#folderPickerSearch').focus(), 50);
}
async function populateFolderPicker(query) {
  if (!state.folderPicker) return;
  const { tabScope, excludeIds } = state.folderPicker;
  const all = (await db.getAll('folders')).filter(f => f.tabScope === tabScope);
  // Build tree with depth
  const byParent = {};
  all.forEach(f => {
    const p = f.parentId || 'root';
    (byParent[p] = byParent[p] || []).push(f);
  });
  Object.values(byParent).forEach(arr => arr.sort((a,b) => {
    if (a.builtIn && !b.builtIn) return -1;
    if (!a.builtIn && b.builtIn) return 1;
    return a.name.localeCompare(b.name);
  }));
  const host = $('#folderPickerList');
  host.innerHTML = '';
  const q = query.trim().toLowerCase();
  let any = false;
  const renderLevel = (parentId, depth) => {
    const arr = byParent[parentId || 'root'] || [];
    for (const f of arr) {
      if (excludeIds.has(f.id)) {
        // skip the folder itself, but continue descending isn't safe since you can't move INTO a descendant either
        // — descendants are already added to excludeIds by caller when relevant
        continue;
      }
      const matchesQuery = !q || f.name.toLowerCase().includes(q);
      if (matchesQuery) {
        any = true;
        const el = document.createElement('div');
        el.className = 'folder-picker-item' + (depth > 0 ? ' depth-' + Math.min(depth, 4) : '');
        el.dataset.id = f.id;
        el.innerHTML = `
          <span class="folder-dot" style="background:${escapeHtml(f.color || '#8a7f70')}"></span>
          <span style="flex:1">${escapeHtml(f.name)}</span>
          ${f.builtIn ? '<span style="font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.06em">default</span>' : ''}
        `;
        el.onclick = () => {
          host.querySelectorAll('.folder-picker-item').forEach(x => x.classList.remove('selected'));
          el.classList.add('selected');
          state.folderPicker.selectedId = f.id;
          $('#folderPickerConfirm').disabled = false;
        };
        host.appendChild(el);
      }
      renderLevel(f.id, depth + 1);
    }
  };
  renderLevel(null, 0);
  if (!any) {
    host.innerHTML = '<div class="folder-picker-empty">No folders match.</div>';
  }
}
$('#folderPickerSearch').addEventListener('input', (e) => populateFolderPicker(e.target.value));
$('#folderPickerConfirm').onclick = () => {
  if (!state.folderPicker || !state.folderPicker.selectedId) return;
  const { onPick, selectedId } = state.folderPicker;
  $('#folderPickerModal').hidden = true;
  state.folderPicker = null;
  if (onPick) onPick(selectedId);
};

/* ---------- Multi-select bar actions ---------- */
$('#multiselectMove').onclick = () => {
  if (state.selection.size === 0) return;
  openFolderPicker({
    title: `Move ${state.selection.size} item${state.selection.size === 1 ? '' : 's'} to…`,
    tabScope: state.currentTab,
    excludeIds: new Set(),
    onPick: async (folderId) => {
      const ids = Array.from(state.selection);
      await moveItemsToFolder(ids, state.currentTab, folderId);
      toast(`Moved ${ids.length} item${ids.length === 1 ? '' : 's'}`);
    }
  });
};
$('#multiselectDelete').onclick = () => {
  if (state.selection.size === 0) return;
  const count = state.selection.size;
  confirmDialog({
    title: `Move ${count} item${count === 1 ? '' : 's'} to trash?`,
    message: 'You can restore from the Trash for 30 days.',
    ok: async () => {
      for (const id of Array.from(state.selection)) {
        const item = await db.get(state.currentTab, id);
        if (!item) continue;
        item.deleted = true;
        item.deletedAt = now();
        item.deletedFromStore = state.currentTab;
        await db.put(state.currentTab, item);
        await db.put('trash', {
          id: item.id,
          store: state.currentTab,
          title: item.title || 'Untitled',
          deletedAt: item.deletedAt
        });
      }
      clearSelection();
      await loadList();
      toast(`Moved ${count} item${count === 1 ? '' : 's'} to trash`);
    }
  });
};
$('#multiselectClear').onclick = clearSelection;

/* ---------- Tabs ---------- */
$$('#tabs .tab').forEach(t => t.addEventListener('click', () => {
  state.currentTab = t.dataset.tab;
  state.currentFolderId = null;
  state.currentItemId = null;
  clearSelection();
  $$('#tabs .tab').forEach(x => x.classList.toggle('active', x === t));
  $('#listTitle').textContent = ({processes:'Processes', checklists:'Checklists', emailTemplates:'Email Templates', insights:'Insights & Performance'})[state.currentTab];
  $('#detailEmpty').hidden = false;
  $('#detailContent').hidden = true;
  renderFolderTree();
  loadList();
  if (isMobile()) setMobileScreen('list');
}));

/* ---------- List rendering ---------- */
async function loadList() {
  const all = await db.getAll(state.currentTab);
  let items = all.filter(i => !i.deleted);
  if (state.currentFolderId) items = items.filter(i => i.folderId === state.currentFolderId);
  // sort
  items.sort((a, b) => {
    if (state.sortBy === 'title') return (a.title || '').localeCompare(b.title || '');
    if (state.sortBy === 'created') return (b.createdAt || '').localeCompare(a.createdAt || '');
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
  state.items = items;
  // Update list title to show current folder context
  if (state.currentFolderId) {
    const f = state.folders.find(x => x.id === state.currentFolderId);
    $('#listTitle').textContent = f ? f.name : 'All items';
  } else {
    $('#listTitle').textContent = 'All items';
  }
  const container = $('#listContainer');
  const empty = $('#listEmpty');
  container.innerHTML = '';
  if (items.length === 0) {
    empty.hidden = false;
    const folderHint = isMobile() ? `<div style="font-size:12px;opacity:0.7;margin-top:8px">Tap the <strong>folder icon</strong> above to browse folders.</div>` : '';
    empty.innerHTML = `
      <div class="list-empty-mark">◇</div>
      <div>No items yet</div>
      <div style="font-size:12px;opacity:0.7">Tap <strong>New</strong> to create one.</div>
      ${folderHint}
    `;
    return;
  }
  empty.hidden = true;
  items.forEach(it => {
    const el = document.createElement('div');
    const isSelected = state.selection.has(it.id);
    el.className = 'list-item' + (state.currentItemId === it.id ? ' active' : '') + (isSelected ? ' multi-selected' : '');
    el.dataset.id = it.id;
    el.draggable = true;
    const folder = state.folders.find(f => f.id === it.folderId);
    const snippet = getItemSnippet(it);
    el.innerHTML = `
      <div class="list-item-content-wrap">
        <div class="list-item-row">
          <div class="list-item-checkbox${isSelected ? ' checked' : ''}" data-checkbox></div>
          <div class="list-item-main">
            <div class="list-item-title">${escapeHtml(it.title || 'Untitled')}</div>
            ${snippet ? `<div class="list-item-snippet">${escapeHtml(snippet)}</div>` : ''}
            <div class="list-item-meta">
              <span>${formatDate(it.updatedAt)}</span>
              <span class="dot">·</span>
              <span>${escapeHtml(folder?.name || 'Uncategorized')}</span>
            </div>
          </div>
          <button class="list-item-more" data-more title="More actions" aria-label="More actions">⋯</button>
        </div>
      </div>
      <div class="list-item-swipe-actions">
        <button class="list-item-swipe-action move" data-swipe-action="move">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 9h14M5 9V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M12 13v6m-3-3 3 3 3-3"/></svg>
          <span>Move</span>
        </button>
        <button class="list-item-swipe-action delete" data-swipe-action="delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          <span>Delete</span>
        </button>
      </div>
    `;
    el.onclick = (e) => {
      // "..." button → open item action sheet
      if (e.target.closest('[data-more]')) {
        e.preventDefault();
        e.stopPropagation();
        openItemActionSheet(it);
        return;
      }
      // Swipe actions
      if (e.target.closest('[data-swipe-action]')) {
        const action = e.target.closest('[data-swipe-action]').dataset.swipeAction;
        el.classList.remove('swiped');
        if (action === 'move') {
          openFolderPicker({
            title: `Move "${it.title || 'Untitled'}" to…`,
            tabScope: state.currentTab,
            excludeIds: new Set(),
            onPick: async (folderId) => {
              await moveItemsToFolder([it.id], state.currentTab, folderId);
              toast('Moved');
            }
          });
        } else if (action === 'delete') {
          confirmDialog({
            title: 'Move to trash?',
            message: 'You can restore from the Trash for 30 days.',
            ok: async () => {
              it.deleted = true;
              it.deletedAt = now();
              it.deletedFromStore = state.currentTab;
              await db.put(state.currentTab, it);
              await db.put('trash', { id: it.id, store: state.currentTab, title: it.title || 'Untitled', deletedAt: it.deletedAt });
              await loadList();
              toast('Moved to trash');
            }
          });
        }
        return;
      }
      // Checkbox → toggle selection only
      if (e.target.closest('[data-checkbox]')) {
        toggleItemSelection(it.id, e.shiftKey);
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        toggleItemSelection(it.id, true);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        toggleItemSelection(it.id, false);
        return;
      }
      // If a swipe is open on this item, close it instead of opening
      if (el.classList.contains('swiped')) {
        el.classList.remove('swiped');
        return;
      }
      if (state.selection.size > 0) {
        clearSelection();
      }
      openItem(it.id);
      // On mobile, navigate to detail screen
      if (isMobile()) setMobileScreen('detail');
    };
    el.ondragstart = (e) => {
      let ids;
      if (state.selection.has(it.id) && state.selection.size > 1) {
        ids = Array.from(state.selection);
      } else {
        ids = [it.id];
      }
      e.dataTransfer.setData('text/plain', JSON.stringify({ itemIds: ids, store: state.currentTab }));
      e.dataTransfer.setData('text/item', JSON.stringify({ itemId: it.id, store: state.currentTab }));
      el.classList.add('dragging');
    };
    el.ondragend = () => el.classList.remove('dragging');
    // Long-press opens the item action sheet (mobile convenience)
    attachLongPress(el, (e) => {
      if (e.target.closest('[data-checkbox], [data-more], [data-swipe-action]')) return;
      openItemActionSheet(it);
    });
    // Touch swipe to reveal actions
    attachSwipeActions(el, it);
    container.appendChild(el);
  });
  updateMultiselectBar();
  // refresh counts in tree
  renderFolderTree();
}

function getItemSnippet(it) {
  if (state.currentTab === 'processes') {
    return it.description || (it.steps?.length ? `${it.steps.length} step(s)` : '');
  }
  if (state.currentTab === 'checklists') {
    return it.description || (it.items?.length ? `${it.items.length} item(s)` : '');
  }
  if (state.currentTab === 'emailTemplates') {
    return it.subject || '';
  }
  if (state.currentTab === 'insights') {
    const flag = it.flag ? it.flag + ' ' : '';
    return flag + (stripHtml(it.body || '').slice(0, 100));
  }
  return '';
}

/* ---------- Open item ---------- */
async function openItem(id) {
  state.currentItemId = id;
  loadList();
  const item = await db.get(state.currentTab, id);
  if (!item) return;
  $('#detailEmpty').hidden = true;
  $('#detailContent').hidden = false;
  if (state.currentTab === 'processes') await renderProcessDetail(item);
  else if (state.currentTab === 'checklists') await renderChecklistDetail(item);
  else if (state.currentTab === 'emailTemplates') await renderTemplateDetail(item);
  else await renderInsightDetail(item);
}

/* ---------- Save helpers ---------- */
async function saveItem(item) {
  item.updatedAt = now();
  item.version = (item.version || 0) + 1;
  await db.put(state.currentTab, item);
  showSaved();
  // refresh list snippet
  const idx = state.items.findIndex(i => i.id === item.id);
  if (idx >= 0) state.items[idx] = item;
  // do not full re-render list to avoid focus loss; just update meta in place
  const listEl = $(`.list-item[data-id="${item.id}"]`);
  if (listEl) {
    listEl.querySelector('.list-item-title').textContent = item.title || 'Untitled';
    const snip = getItemSnippet(item);
    const snipEl = listEl.querySelector('.list-item-snippet');
    if (snipEl) snipEl.textContent = snip;
    const metaEl = listEl.querySelector('.list-item-meta');
    if (metaEl) metaEl.firstElementChild.textContent = formatDate(item.updatedAt);
  }
}

/* ---------- Create new ---------- */
async function createItem() {
  let item;
  const folderId = state.currentFolderId || ('uncat_' + state.currentTab);
  const ts = now();
  if (state.currentTab === 'processes') {
    item = {
      id: uuid(),
      title: '',
      description: '',
      tags: [],
      folderId,
      steps: [],
      createdAt: ts,
      updatedAt: ts,
      version: 1
    };
  } else if (state.currentTab === 'checklists') {
    item = {
      id: uuid(),
      title: '',
      description: '',
      tags: [],
      folderId,
      items: [],
      createdAt: ts,
      updatedAt: ts,
      version: 1
    };
  } else if (state.currentTab === 'emailTemplates') {
    item = {
      id: uuid(),
      title: '',
      tags: [],
      folderId,
      subject: '',
      body: '',
      lastValues: {},
      createdAt: ts,
      updatedAt: ts,
      version: 1
    };
  } else {
    // insights
    item = {
      id: uuid(),
      title: '',
      body: '',
      flag: '',
      date: ts.slice(0, 10), // YYYY-MM-DD
      tags: [],
      folderId,
      createdAt: ts,
      updatedAt: ts,
      version: 1
    };
  }
  await db.put(state.currentTab, item);
  await loadList();
  openItem(item.id);
  if (isMobile()) setMobileScreen('detail');
}

/* ---------- Tag widget ---------- */
function renderTags(item, container, onChange) {
  container.innerHTML = '';
  (item.tags || []).forEach((tag, i) => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${escapeHtml(tag)} <button data-i="${i}">×</button>`;
    pill.querySelector('button').onclick = () => {
      item.tags.splice(i, 1);
      onChange();
    };
    container.appendChild(pill);
  });
  const input = document.createElement('input');
  input.className = 'tag-add-input';
  input.placeholder = '+ tag';
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      item.tags = item.tags || [];
      if (!item.tags.includes(input.value.trim())) {
        item.tags.push(input.value.trim());
      }
      onChange();
    }
  };
  container.appendChild(input);
}

/* ---------- Folder selector ---------- */
function folderSelectOptions(item) {
  return state.folders.map(f =>
    `<option value="${f.id}" ${f.id === item.folderId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`
  ).join('');
}

/* ===========================================================
   PROCESS DETAIL
   =========================================================== */
async function renderProcessDetail(item) {
  const root = $('#detailContent');
  root.innerHTML = `
    <div class="detail-meta-row">
      <select class="select" id="procFolder">${folderSelectOptions(item)}</select>
      <span class="dot">·</span>
      <span>Updated ${formatDate(item.updatedAt)}</span>
      <span class="dot">·</span>
      <span>v${item.version || 1}</span>
      <span style="flex:1"></span>
      <button class="ghost-btn" id="procRunBtn" title="Run mode">▶ Run</button>
      <button class="ghost-btn" id="procDupBtn" title="Duplicate">⎘ Duplicate</button>
      <button class="ghost-btn" id="procExportMdBtn" title="Export as Markdown">↓ Markdown</button>
      <button class="ghost-btn" id="procDeleteBtn" style="color:var(--danger)" title="Delete">🗑 Delete</button>
    </div>
    <input class="detail-title-input" id="procTitle" placeholder="Untitled process" value="${escapeHtml(item.title || '')}">
    <textarea class="detail-description" id="procDesc" rows="2" placeholder="Short description (optional)…">${escapeHtml(item.description || '')}</textarea>
    <div class="detail-tags" id="procTags"></div>
    <div class="detail-section-title"><span>Steps</span><span style="font-family:var(--font-body);font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">${item.steps?.length || 0} step(s)</span></div>
    <div id="stepsContainer"></div>
    <button class="add-step-btn" id="addStepBtn">+ Add step</button>
  `;

  $('#procTitle').addEventListener('input', debounce((e) => { item.title = e.target.value; saveItem(item); }, 400));
  $('#procDesc').addEventListener('input', debounce((e) => { item.description = e.target.value; saveItem(item); }, 400));
  $('#procFolder').addEventListener('change', (e) => { item.folderId = e.target.value; saveItem(item); renderFolderTree(); });
  $('#procRunBtn').onclick = () => enterRunMode(item);
  $('#procDupBtn').onclick = () => duplicateProcess(item);
  $('#procExportMdBtn').onclick = () => exportProcessMarkdown(item);
  $('#procDeleteBtn').onclick = () => deleteCurrentItem(item);

  const procTagsCb = () => { saveItem(item); renderTags(item, $('#procTags'), procTagsCb); };
  renderTags(item, $('#procTags'), procTagsCb);

  await renderSteps(item);

  $('#addStepBtn').onclick = () => {
    item.steps = item.steps || [];
    item.steps.push({
      id: uuid(),
      title: '',
      description: '',
      substeps: [],
      linkedChecklists: [],
      linkedTemplates: [],
      status: 'not_started',
      estimatedTime: '',
      assignee: ''
    });
    saveItem(item);
    renderSteps(item);
  };
}

async function renderSteps(item) {
  const container = $('#stepsContainer');
  container.innerHTML = '';
  (item.steps || []).forEach((step, idx) => {
    const el = document.createElement('div');
    el.className = 'step status-' + (step.status || 'not_started');
    el.dataset.stepId = step.id;
    el.draggable = true;
    el.innerHTML = `
      <div class="step-header">
        <div class="step-drag-handle" title="Drag to reorder">⋮⋮</div>
        <div class="step-number">${idx + 1}</div>
        <div class="step-main">
          <input class="step-title-input" placeholder="Step title…" value="${escapeHtml(step.title || '')}">
        </div>
        <div class="step-actions">
          <select class="step-status ${step.status || 'not_started'}" data-action="status">
            <option value="not_started" ${step.status==='not_started'?'selected':''}>Not started</option>
            <option value="in_progress" ${step.status==='in_progress'?'selected':''}>In progress</option>
            <option value="done" ${step.status==='done'?'selected':''}>Done</option>
          </select>
          <button class="iconbtn small" data-action="expand" title="Expand">▾</button>
          <button class="iconbtn small" data-action="delete" title="Delete step" style="color:var(--danger)">🗑</button>
        </div>
      </div>
      <div class="step-body">
        <div class="rich-toolbar">
          <button data-cmd="bold"><strong>B</strong></button>
          <button data-cmd="italic"><em>I</em></button>
          <button data-cmd="insertUnorderedList">•</button>
          <button data-cmd="insertOrderedList">1.</button>
          <span class="sep"></span>
          <button data-cmd="formatBlock" data-arg="h3">H</button>
          <button data-cmd="formatBlock" data-arg="pre">{ }</button>
          <button data-cmd="createLink">🔗</button>
          <button data-cmd="formatBlock" data-arg="p">¶</button>
        </div>
        <div class="rich-editor" contenteditable="true" data-placeholder="Step description, instructions, context…">${step.description || ''}</div>

        <div class="substeps-wrap">
          <div style="font-size:11px;color:var(--ink-mute);font-weight:600;text-transform:uppercase;letter-spacing:0.1em;margin:8px 0 6px;">Sub-steps</div>
          <div class="substeps-host"></div>
          <button class="add-step-btn" data-action="add-substep" style="margin-top:4px">+ Add sub-step</button>
        </div>

        <div class="notes-section">
          <div class="notes-section-title">
            <span>Notes log — learnings, edge cases, situations</span>
          </div>
          <div class="note-add">
            <select class="note-flag-select" data-flag>
              <option value="">—</option>
              <option value="💡">💡</option>
              <option value="⚠️">⚠️</option>
              <option value="❓">❓</option>
            </select>
            <textarea data-note placeholder="Add a note…" rows="1"></textarea>
            <button class="note-add-btn" data-action="add-note">Add</button>
          </div>
          <div class="notes-list" data-notes-list></div>
        </div>

        <div class="linked-section">
          <div style="font-size:11px;color:var(--ink-mute);font-weight:600;text-transform:uppercase;letter-spacing:0.1em;margin:8px 0 6px;display:flex;justify-content:space-between;align-items:center">
            <span>Linked checklists</span>
            <button class="ghost-btn" data-action="link-checklist" style="padding:3px 8px;font-size:11px">+ Link</button>
          </div>
          <div class="linked-list" data-linked-checklists></div>
        </div>

        <div class="linked-section">
          <div style="font-size:11px;color:var(--ink-mute);font-weight:600;text-transform:uppercase;letter-spacing:0.1em;margin:8px 0 6px;display:flex;justify-content:space-between;align-items:center">
            <span>Linked email templates</span>
            <button class="ghost-btn" data-action="link-template" style="padding:3px 8px;font-size:11px">+ Link</button>
          </div>
          <div class="linked-list" data-linked-templates></div>
        </div>
      </div>
    `;

    // header click → expand
    el.querySelector('.step-header').addEventListener('click', (e) => {
      if (e.target.closest('input, select, button')) return;
      el.classList.toggle('expanded');
    });
    el.querySelector('[data-action="expand"]').onclick = () => el.classList.toggle('expanded');
    el.querySelector('[data-action="delete"]').onclick = () => {
      confirmDialog({
        title: 'Delete step?',
        message: 'This will also remove all notes attached to this step.',
        ok: async () => {
          item.steps.splice(idx, 1);
          // delete notes
          const notes = await db.getByIndex('stepNotes', 'stepId', step.id);
          for (const n of notes) await db.delete('stepNotes', n.id);
          saveItem(item);
          renderSteps(item);
        }
      });
    };
    // title input
    el.querySelector('.step-title-input').addEventListener('input', debounce((e) => {
      step.title = e.target.value;
      saveItem(item);
    }, 400));
    // status
    el.querySelector('[data-action="status"]').addEventListener('change', (e) => {
      step.status = e.target.value;
      el.className = 'step status-' + step.status + (el.classList.contains('expanded') ? ' expanded' : '');
      e.target.className = 'step-status ' + step.status;
      saveItem(item);
    });

    // rich editor
    const editor = el.querySelector('.rich-editor');
    editor.addEventListener('input', debounce(() => {
      step.description = editor.innerHTML;
      saveItem(item);
    }, 500));
    el.querySelectorAll('.rich-toolbar button').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        editor.focus();
        const cmd = btn.dataset.cmd;
        let arg = btn.dataset.arg || null;
        if (cmd === 'createLink') {
          const url = prompt('URL');
          if (url) document.execCommand(cmd, false, url);
        } else {
          document.execCommand(cmd, false, arg);
        }
        step.description = editor.innerHTML;
        saveItem(item);
      };
    });

    // sub-steps
    renderSubsteps(step, el.querySelector('.substeps-host'), item, 0);
    el.querySelector('[data-action="add-substep"]').onclick = () => {
      step.substeps = step.substeps || [];
      step.substeps.push({ id: uuid(), title: '', substeps: [] });
      saveItem(item);
      renderSubsteps(step, el.querySelector('.substeps-host'), item, 0);
    };

    // notes
    renderNotesForStep(item.id, step.id, el.querySelector('[data-notes-list]'));
    const noteTa = el.querySelector('[data-note]');
    el.querySelector('[data-action="add-note"]').onclick = async () => {
      const txt = noteTa.value.trim();
      if (!txt) return;
      const flag = el.querySelector('[data-flag]').value;
      const note = {
        id: uuid(),
        processId: item.id,
        stepId: step.id,
        text: txt,
        flag,
        createdAt: now()
      };
      await db.put('stepNotes', note);
      noteTa.value = '';
      el.querySelector('[data-flag]').value = '';
      renderNotesForStep(item.id, step.id, el.querySelector('[data-notes-list]'));
      showSaved();
    };

    // linked checklists / templates
    renderLinkedCards(step, 'linkedChecklists', 'checklists', el.querySelector('[data-linked-checklists]'), item);
    renderLinkedCards(step, 'linkedTemplates', 'emailTemplates', el.querySelector('[data-linked-templates]'), item);
    el.querySelector('[data-action="link-checklist"]').onclick = () => openLinker(step, 'checklists', item);
    el.querySelector('[data-action="link-template"]').onclick = () => openLinker(step, 'emailTemplates', item);

    // drag-and-drop reordering
    el.addEventListener('dragstart', (e) => {
      if (!e.target.closest('.step-drag-handle')) {
        // only let drag handle initiate; cancel otherwise
        // (but drag from anywhere on step is fine too — we just keep simple)
      }
      e.dataTransfer.setData('text/step-id', step.id);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/step-id');
      if (!draggedId || draggedId === step.id) return;
      const fromIdx = item.steps.findIndex(s => s.id === draggedId);
      const toIdx = idx;
      if (fromIdx < 0) return;
      const [moved] = item.steps.splice(fromIdx, 1);
      item.steps.splice(toIdx, 0, moved);
      saveItem(item);
      renderSteps(item);
    });

    container.appendChild(el);
  });
}

function renderSubsteps(parent, host, rootItem, depth) {
  host.innerHTML = '';
  (parent.substeps || []).forEach((sub, idx) => {
    const el = document.createElement('div');
    el.className = 'substep';
    el.innerHTML = `
      <div class="substep-header">
        <span class="substep-bullet">▸</span>
        <input class="substep-title-input" placeholder="Sub-step…" value="${escapeHtml(sub.title || '')}">
        <div class="substep-actions">
          ${depth < 2 ? `<button class="iconbtn small" data-action="add-child" title="Add nested">+</button>` : ''}
          <button class="iconbtn small" data-action="del" title="Delete" style="color:var(--danger)">×</button>
        </div>
      </div>
      <div class="substep-children"></div>
    `;
    el.querySelector('.substep-title-input').addEventListener('input', debounce((e) => {
      sub.title = e.target.value;
      saveItem(rootItem);
    }, 400));
    el.querySelector('[data-action="del"]').onclick = () => {
      parent.substeps.splice(idx, 1);
      saveItem(rootItem);
      renderSubsteps(parent, host, rootItem, depth);
    };
    const addChild = el.querySelector('[data-action="add-child"]');
    if (addChild) addChild.onclick = () => {
      sub.substeps = sub.substeps || [];
      sub.substeps.push({ id: uuid(), title: '', substeps: [] });
      saveItem(rootItem);
      renderSubsteps(parent, host, rootItem, depth);
    };
    renderSubsteps(sub, el.querySelector('.substep-children'), rootItem, depth + 1);
    host.appendChild(el);
  });
}

async function renderNotesForStep(processId, stepId, host) {
  const notes = await db.getByIndex('stepNotes', 'stepId', stepId);
  notes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  host.innerHTML = '';
  if (notes.length === 0) {
    host.innerHTML = `<div class="notes-empty">No notes yet. Capture learnings, edge cases, situational tips here.</div>`;
    return;
  }
  notes.forEach(n => {
    const el = document.createElement('div');
    el.className = 'note-item';
    el.innerHTML = `
      <div class="note-item-header">
        ${n.flag ? `<span class="note-flag">${n.flag}</span>` : ''}
        <span>${formatFull(n.createdAt)}</span>
      </div>
      <div class="note-item-text">${escapeHtml(n.text)}</div>
      <button class="note-delete" title="Delete">×</button>
    `;
    el.querySelector('.note-delete').onclick = async () => {
      await db.delete('stepNotes', n.id);
      renderNotesForStep(processId, stepId, host);
    };
    host.appendChild(el);
  });
}

async function renderLinkedCards(step, field, store, host, rootItem) {
  host.innerHTML = '';
  const ids = step[field] || [];
  if (ids.length === 0) {
    host.innerHTML = `<div style="font-size:11px;color:var(--ink-faint);font-style:italic;padding:4px 0">None linked.</div>`;
    return;
  }
  for (const id of ids) {
    const it = await db.get(store, id);
    if (!it) continue;
    const el = document.createElement('div');
    el.className = 'linked-card';
    const icon = store === 'checklists' ? '☑' : '✉';
    el.innerHTML = `
      <div class="linked-card-header">
        <span class="linked-card-icon">${icon}</span>
        <span class="linked-card-title">${escapeHtml(it.title || 'Untitled')}</span>
        <button class="linked-card-unlink" title="Unlink">unlink</button>
      </div>
      <div class="linked-card-body"></div>
    `;
    el.querySelector('.linked-card-header').addEventListener('click', (e) => {
      if (e.target.closest('.linked-card-unlink')) return;
      el.classList.toggle('expanded');
      if (el.classList.contains('expanded')) {
        renderLinkedCardBody(el.querySelector('.linked-card-body'), it, store);
      }
    });
    el.querySelector('.linked-card-unlink').onclick = (e) => {
      e.stopPropagation();
      step[field] = step[field].filter(x => x !== id);
      saveItem(rootItem);
      renderLinkedCards(step, field, store, host, rootItem);
    };
    host.appendChild(el);
  }
}

function renderLinkedCardBody(host, it, store) {
  if (store === 'checklists') {
    host.innerHTML = `
      <div style="margin-bottom:8px;font-style:italic">${escapeHtml(it.description || '')}</div>
      <div>${(it.items || []).map(i => `<div style="padding:3px 0">☐ ${escapeHtml(i.text || '')}</div>`).join('')}</div>
      <div style="margin-top:8px"><button class="ghost-btn" data-jump>Open checklist →</button></div>
    `;
    host.querySelector('[data-jump]').onclick = () => jumpToItem('checklists', it.id);
  } else {
    host.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">${escapeHtml(it.subject || '')}</div>
      <div style="white-space:pre-wrap">${escapeHtml(it.body || '')}</div>
      <div style="margin-top:8px"><button class="ghost-btn" data-jump>Open template →</button></div>
    `;
    host.querySelector('[data-jump]').onclick = () => jumpToItem('emailTemplates', it.id);
  }
}

function jumpToItem(tab, id) {
  state.currentTab = tab;
  state.currentFolderId = null;
  $$('#tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  $('#listTitle').textContent = ({processes:'Processes', checklists:'Checklists', emailTemplates:'Email Templates', insights:'Insights & Performance'})[tab];
  renderFolderTree();
  loadList().then(() => openItem(id));
}

/* ---------- Linker modal ---------- */
function openLinker(step, store, rootItem) {
  state.linker = { step, store, rootItem };
  $('#linkerTitle').textContent = 'Link ' + (store === 'checklists' ? 'checklists' : 'email templates');
  $('#linkerModal').hidden = false;
  $('#linkerSearch').value = '';
  populateLinker('');
  $('#linkerSearch').focus();
}
async function populateLinker(query) {
  const { store, step } = state.linker;
  const field = store === 'checklists' ? 'linkedChecklists' : 'linkedTemplates';
  const items = (await db.getAll(store)).filter(i => !i.deleted);
  const filtered = query
    ? items.filter(i => (i.title || '').toLowerCase().includes(query.toLowerCase()) || (i.subject || '').toLowerCase().includes(query.toLowerCase()))
    : items;
  filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  const host = $('#linkerList');
  host.innerHTML = '';
  if (filtered.length === 0) {
    host.innerHTML = '<div class="linker-empty">No items. Create some first.</div>';
    return;
  }
  const selected = new Set(step[field] || []);
  filtered.forEach(i => {
    const row = document.createElement('label');
    row.className = 'linker-item';
    const isChecked = selected.has(i.id);
    row.innerHTML = `
      <input type="checkbox" value="${i.id}" ${isChecked ? 'checked' : ''}>
      <div style="flex:1">
        <div style="font-weight:500">${escapeHtml(i.title || 'Untitled')}</div>
        <div style="font-size:11px;color:var(--ink-mute)">${escapeHtml((store==='checklists' ? i.description : i.subject) || '')}</div>
      </div>
    `;
    host.appendChild(row);
  });
}
$('#linkerSearch').addEventListener('input', (e) => populateLinker(e.target.value));
$('#linkerSave').onclick = async () => {
  const { step, store, rootItem } = state.linker;
  const field = store === 'checklists' ? 'linkedChecklists' : 'linkedTemplates';
  const checked = Array.from($('#linkerList').querySelectorAll('input:checked')).map(i => i.value);
  step[field] = checked;
  await saveItem(rootItem);
  $('#linkerModal').hidden = true;
  // re-render whole detail to refresh linked cards
  openItem(rootItem.id);
};

/* ---------- Duplicate / export markdown / delete ---------- */
async function duplicateProcess(item) {
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = uuid();
  copy.title = (copy.title || 'Untitled') + ' (copy)';
  copy.createdAt = now();
  copy.updatedAt = now();
  copy.version = 1;
  // refresh step ids so notes don't bleed
  if (copy.steps) {
    for (const s of copy.steps) {
      const oldId = s.id;
      s.id = uuid();
      // copy notes for this step
      const oldNotes = await db.getByIndex('stepNotes', 'stepId', oldId);
      for (const n of oldNotes) {
        await db.put('stepNotes', {
          ...n,
          id: uuid(),
          processId: copy.id,
          stepId: s.id
        });
      }
    }
  }
  await db.put('processes', copy);
  await loadList();
  openItem(copy.id);
  toast('Duplicated');
}

async function exportProcessMarkdown(item) {
  let md = `# ${item.title || 'Untitled process'}\n\n`;
  if (item.description) md += item.description + '\n\n';
  if (item.tags?.length) md += `_Tags: ${item.tags.join(', ')}_\n\n`;
  md += `## Steps\n\n`;
  for (let i = 0; i < (item.steps || []).length; i++) {
    const s = item.steps[i];
    md += `### ${i+1}. ${s.title || 'Untitled step'}\n\n`;
    if (s.status && s.status !== 'not_started') md += `_Status: ${s.status}_\n\n`;
    if (s.description) md += stripHtml(s.description) + '\n\n';
    md += subStepsMd(s.substeps, 0);
    const notes = await db.getByIndex('stepNotes', 'stepId', s.id);
    if (notes.length) {
      md += `**Notes:**\n\n`;
      notes.sort((a,b) => a.createdAt.localeCompare(b.createdAt));
      for (const n of notes) {
        md += `- ${n.flag || ''} _${formatFull(n.createdAt)}_ — ${n.text}\n`;
      }
      md += '\n';
    }
    if (s.linkedChecklists?.length) {
      md += `**Linked checklists:**\n`;
      for (const cid of s.linkedChecklists) {
        const c = await db.get('checklists', cid);
        if (c) md += `- ${c.title}\n`;
      }
      md += '\n';
    }
    if (s.linkedTemplates?.length) {
      md += `**Linked email templates:**\n`;
      for (const tid of s.linkedTemplates) {
        const t = await db.get('emailTemplates', tid);
        if (t) md += `- ${t.title}\n`;
      }
      md += '\n';
    }
  }
  downloadFile(`${(item.title || 'process').replace(/[^a-z0-9]+/gi, '_')}.md`, md, 'text/markdown');
}
function subStepsMd(subs, depth) {
  if (!subs || !subs.length) return '';
  let out = '';
  const pad = '  '.repeat(depth);
  for (const s of subs) {
    out += `${pad}- ${s.title || ''}\n`;
    out += subStepsMd(s.substeps, depth + 1);
  }
  return out + '\n';
}
function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || '';
}

async function deleteCurrentItem(item) {
  confirmDialog({
    title: 'Move to trash?',
    message: 'You can restore from the Trash for 30 days.',
    ok: async () => {
      item.deleted = true;
      item.deletedAt = now();
      item.deletedFromStore = state.currentTab;
      await db.put(state.currentTab, item);
      // also move to trash store for fast listing
      await db.put('trash', {
        id: item.id,
        store: state.currentTab,
        title: item.title || 'Untitled',
        deletedAt: item.deletedAt
      });
      state.currentItemId = null;
      $('#detailEmpty').hidden = false;
      $('#detailContent').hidden = true;
      loadList();
      toast('Moved to trash');
    }
  });
}

/* ===========================================================
   CHECKLIST DETAIL
   =========================================================== */
async function renderChecklistDetail(item) {
  const root = $('#detailContent');
  // back-refs: which process steps link to this checklist
  const allProcs = await db.getAll('processes');
  const backrefs = [];
  for (const p of allProcs) {
    if (p.deleted) continue;
    for (const s of (p.steps || [])) {
      if ((s.linkedChecklists || []).includes(item.id)) {
        backrefs.push({ procId: p.id, procTitle: p.title || 'Untitled', stepTitle: s.title || 'Untitled step' });
      }
    }
  }
  root.innerHTML = `
    <div class="detail-meta-row">
      <select class="select" id="clFolder">${folderSelectOptions(item)}</select>
      <span class="dot">·</span>
      <span>Updated ${formatDate(item.updatedAt)}</span>
      <span class="dot">·</span>
      <span>v${item.version || 1}</span>
      <span style="flex:1"></span>
      <button class="ghost-btn" id="clSnapshotBtn" title="Save snapshot of current state">📷 Snapshot</button>
      <button class="ghost-btn" id="clResetBtn" title="Uncheck all">⟲ Reset</button>
      <button class="ghost-btn" id="clDeleteBtn" style="color:var(--danger)">🗑 Delete</button>
    </div>
    <input class="detail-title-input" id="clTitle" placeholder="Untitled checklist" value="${escapeHtml(item.title || '')}">
    <textarea class="detail-description" id="clDesc" rows="2" placeholder="Description…">${escapeHtml(item.description || '')}</textarea>
    <div class="detail-tags" id="clTags"></div>
    ${backrefs.length ? `
      <div class="detail-section-title">Used in</div>
      <div>${backrefs.map(b => `<div class="backref" data-jump="${b.procId}">${escapeHtml(b.procTitle)} → ${escapeHtml(b.stepTitle)}</div>`).join('')}</div>
    ` : ''}
    <div class="detail-section-title"><span>Items</span><span style="font-family:var(--font-body);font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">${(item.items || []).filter(i=>i.checked).length}/${(item.items||[]).length} checked</span></div>
    <div class="checklist-items" id="clItems"></div>
    <button class="add-step-btn" id="clAddBtn" style="margin-top:10px">+ Add item</button>
    <div class="detail-section-title">Snapshot history</div>
    <div id="clSnapshots"></div>
  `;
  $('#clTitle').addEventListener('input', debounce(e => { item.title = e.target.value; saveItem(item); }, 400));
  $('#clDesc').addEventListener('input', debounce(e => { item.description = e.target.value; saveItem(item); }, 400));
  $('#clFolder').addEventListener('change', e => { item.folderId = e.target.value; saveItem(item); renderFolderTree(); });
  $('#clDeleteBtn').onclick = () => deleteCurrentItem(item);
  $('#clResetBtn').onclick = () => {
    (item.items || []).forEach(i => i.checked = false);
    saveItem(item);
    renderChecklistDetail(item);
  };
  $('#clSnapshotBtn').onclick = async () => {
    const reflection = prompt('Reflection / note for this snapshot (optional)');
    const snap = {
      id: uuid(),
      checklistId: item.id,
      completedAt: now(),
      items: (item.items || []).map(i => ({ text: i.text, checked: !!i.checked })),
      reflection: reflection || ''
    };
    await db.put('checklistSnapshots', snap);
    renderChecklistDetail(item);
    toast('Snapshot saved');
  };
  const clTagsCb = () => { saveItem(item); renderTags(item, $('#clTags'), clTagsCb); };
  renderTags(item, $('#clTags'), clTagsCb);

  // back-ref jumps
  root.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => jumpToItem('processes', b.dataset.jump));

  renderChecklistItems(item);
  renderChecklistSnapshots(item);

  $('#clAddBtn').onclick = () => {
    item.items = item.items || [];
    item.items.push({ id: uuid(), text: '', checked: false, sub: '' });
    saveItem(item);
    renderChecklistItems(item);
  };
}

function renderChecklistItems(item) {
  const host = $('#clItems');
  host.innerHTML = '';
  (item.items || []).forEach((ci, idx) => {
    const el = document.createElement('div');
    el.className = 'checklist-item';
    el.innerHTML = `
      <div class="checklist-item-checkbox ${ci.checked ? 'checked' : ''}"></div>
      <div class="checklist-item-text-wrap">
        <input class="checklist-item-text ${ci.checked ? 'checked' : ''}" placeholder="Item…" value="${escapeHtml(ci.text || '')}">
        <input class="checklist-item-sub-input" placeholder="(sub-note, optional)" value="${escapeHtml(ci.sub || '')}">
      </div>
      <div class="checklist-item-actions">
        <button class="iconbtn small" title="Delete" style="color:var(--danger)">×</button>
      </div>
    `;
    el.querySelector('.checklist-item-checkbox').onclick = () => {
      ci.checked = !ci.checked;
      saveItem(item);
      renderChecklistItems(item);
    };
    el.querySelector('.checklist-item-text').addEventListener('input', debounce(e => {
      ci.text = e.target.value; saveItem(item);
    }, 400));
    el.querySelector('.checklist-item-sub-input').addEventListener('input', debounce(e => {
      ci.sub = e.target.value; saveItem(item);
    }, 400));
    el.querySelector('.iconbtn').onclick = () => {
      item.items.splice(idx, 1);
      saveItem(item);
      renderChecklistItems(item);
    };
    host.appendChild(el);
  });
}

async function renderChecklistSnapshots(item) {
  const snaps = await db.getByIndex('checklistSnapshots', 'checklistId', item.id);
  snaps.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  const host = $('#clSnapshots');
  if (snaps.length === 0) {
    host.innerHTML = `<div style="font-size:12px;color:var(--ink-mute);font-style:italic">No snapshots yet. Use the 📷 button after a run to save one.</div>`;
    return;
  }
  host.innerHTML = '';
  snaps.forEach(s => {
    const checkedCount = s.items.filter(i => i.checked).length;
    const el = document.createElement('div');
    el.className = 'snapshot-item';
    el.innerHTML = `
      <div class="snapshot-info">
        <div class="snapshot-stats"><strong>${formatFull(s.completedAt)}</strong> — ${checkedCount}/${s.items.length} checked</div>
        ${s.reflection ? `<div class="snapshot-reflection">${escapeHtml(s.reflection)}</div>` : ''}
      </div>
      <div class="snapshot-actions">
        <button class="iconbtn small" data-action="view" title="View details">👁</button>
        <button class="iconbtn small" data-action="delete" title="Delete" style="color:var(--danger)">×</button>
      </div>
    `;
    el.querySelector('[data-action="view"]').onclick = () => {
      alert(s.items.map(i => `${i.checked ? '☑' : '☐'} ${i.text}`).join('\n'));
    };
    el.querySelector('[data-action="delete"]').onclick = async () => {
      await db.delete('checklistSnapshots', s.id);
      renderChecklistSnapshots(item);
    };
    host.appendChild(el);
  });
}

/* ===========================================================
   EMAIL TEMPLATE DETAIL
   =========================================================== */
async function renderTemplateDetail(item) {
  const root = $('#detailContent');
  const allProcs = await db.getAll('processes');
  const backrefs = [];
  for (const p of allProcs) {
    if (p.deleted) continue;
    for (const s of (p.steps || [])) {
      if ((s.linkedTemplates || []).includes(item.id)) {
        backrefs.push({ procId: p.id, procTitle: p.title || 'Untitled', stepTitle: s.title || 'Untitled step' });
      }
    }
  }
  root.innerHTML = `
    <div class="detail-meta-row">
      <select class="select" id="tplFolder">${folderSelectOptions(item)}</select>
      <span class="dot">·</span>
      <span>Updated ${formatDate(item.updatedAt)}</span>
      <span class="dot">·</span>
      <span>v${item.version || 1}</span>
      <span style="flex:1"></span>
      <button class="ghost-btn" id="tplDeleteBtn" style="color:var(--danger)">🗑 Delete</button>
    </div>
    <input class="detail-title-input" id="tplTitle" placeholder="Untitled template" value="${escapeHtml(item.title || '')}">
    <div class="detail-tags" id="tplTags"></div>
    ${backrefs.length ? `
      <div class="detail-section-title">Used in</div>
      <div>${backrefs.map(b => `<div class="backref" data-jump="${b.procId}">${escapeHtml(b.procTitle)} → ${escapeHtml(b.stepTitle)}</div>`).join('')}</div>
    ` : ''}
    <div class="detail-section-title">Subject</div>
    <input class="template-subject-input" id="tplSubject" placeholder="Email subject — use {{variables}}" value="${escapeHtml(item.subject || '')}">
    <div class="detail-section-title">Body</div>
    <div class="rich-toolbar" id="tplToolbar">
      <button data-cmd="bold"><strong>B</strong></button>
      <button data-cmd="italic"><em>I</em></button>
      <button data-cmd="insertUnorderedList">•</button>
      <button data-cmd="insertOrderedList">1.</button>
      <span class="sep"></span>
      <button data-cmd="createLink">🔗</button>
      <span class="sep"></span>
      <button id="togglePlain" style="margin-left:auto">Plain ⇄ Rich</button>
    </div>
    <div class="rich-editor" id="tplBody" contenteditable="true" data-placeholder="Body — use {{variable_name}} for fill-ins">${item.body || ''}</div>
    <textarea id="tplBodyPlain" class="rich-editor" style="display:none;width:100%;min-height:150px;font-family:var(--font-mono);font-size:13px" placeholder="Plain text body"></textarea>
    <div class="detail-section-title">Variables</div>
    <div class="template-vars-panel" id="tplVars"></div>
    <div class="detail-section-title">Preview</div>
    <div class="template-preview" id="tplPreview"></div>
    <div class="template-actions-row">
      <button class="primary-btn" id="tplCopySubj">Copy subject</button>
      <button class="primary-btn" id="tplCopyBody">Copy body</button>
      <button class="primary-btn" id="tplCopyBoth">Copy both</button>
      <button class="ghost-btn" id="tplMailto">📧 Open in mail client</button>
    </div>
  `;

  root.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => jumpToItem('processes', b.dataset.jump));

  $('#tplTitle').addEventListener('input', debounce(e => { item.title = e.target.value; saveItem(item); }, 400));
  $('#tplFolder').addEventListener('change', e => { item.folderId = e.target.value; saveItem(item); renderFolderTree(); });
  $('#tplDeleteBtn').onclick = () => deleteCurrentItem(item);

  const subjEl = $('#tplSubject');
  const bodyEl = $('#tplBody');
  const bodyPlainEl = $('#tplBodyPlain');
  bodyPlainEl.value = stripHtml(item.body || '');

  const refreshVars = () => renderTemplateVars(item);
  subjEl.addEventListener('input', debounce(() => { item.subject = subjEl.value; saveItem(item); refreshVars(); }, 400));
  bodyEl.addEventListener('input', debounce(() => { item.body = bodyEl.innerHTML; bodyPlainEl.value = stripHtml(bodyEl.innerHTML); saveItem(item); refreshVars(); }, 400));
  bodyPlainEl.addEventListener('input', debounce(() => { item.body = escapeHtml(bodyPlainEl.value).replace(/\n/g, '<br>'); bodyEl.innerHTML = item.body; saveItem(item); refreshVars(); }, 400));

  $('#tplToolbar').querySelectorAll('button[data-cmd]').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      bodyEl.focus();
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const u = prompt('URL'); if (u) document.execCommand(cmd, false, u);
      } else document.execCommand(cmd);
      item.body = bodyEl.innerHTML;
      saveItem(item);
    };
  });
  $('#togglePlain').onclick = () => {
    if (bodyEl.style.display === 'none') {
      bodyEl.style.display = '';
      bodyPlainEl.style.display = 'none';
    } else {
      bodyEl.style.display = 'none';
      bodyPlainEl.style.display = '';
    }
  };

  const tplTagsCb = () => { saveItem(item); renderTags(item, $('#tplTags'), tplTagsCb); };
  renderTags(item, $('#tplTags'), tplTagsCb);
  refreshVars();

  $('#tplCopySubj').onclick = () => {
    navigator.clipboard.writeText(renderTemplateText(item, 'subject'));
    toast('Subject copied');
  };
  $('#tplCopyBody').onclick = () => {
    navigator.clipboard.writeText(renderTemplateText(item, 'body'));
    toast('Body copied');
  };
  $('#tplCopyBoth').onclick = () => {
    navigator.clipboard.writeText(`Subject: ${renderTemplateText(item, 'subject')}\n\n${renderTemplateText(item, 'body')}`);
    toast('Copied');
  };
  $('#tplMailto').onclick = () => {
    const s = encodeURIComponent(renderTemplateText(item, 'subject'));
    const b = encodeURIComponent(renderTemplateText(item, 'body'));
    window.location.href = `mailto:?subject=${s}&body=${b}`;
  };
}

function extractVars(item) {
  const text = (item.subject || '') + ' ' + stripHtml(item.body || '');
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const set = new Set();
  let m;
  while ((m = re.exec(text)) !== null) set.add(m[1]);
  return Array.from(set);
}
function renderTemplateVars(item) {
  const vars = extractVars(item);
  const host = $('#tplVars');
  if (vars.length === 0) {
    host.innerHTML = `<div style="font-size:12px;color:var(--ink-mute);font-style:italic">No variables. Use {{variable_name}} in subject or body.</div>`;
    renderTemplatePreview(item, {});
    return;
  }
  item.lastValues = item.lastValues || {};
  host.innerHTML = '';
  const values = {};
  vars.forEach(v => {
    const row = document.createElement('div');
    row.className = 'template-vars-row';
    const last = item.lastValues[v] || '';
    values[v] = last;
    row.innerHTML = `
      <label class="template-var-label">{{${escapeHtml(v)}}}</label>
      <input class="template-var-input" data-var="${escapeHtml(v)}" value="${escapeHtml(last)}" placeholder="Value">
    `;
    row.querySelector('input').addEventListener('input', debounce(e => {
      values[v] = e.target.value;
      item.lastValues[v] = e.target.value;
      saveItem(item);
      renderTemplatePreview(item, values);
    }, 300));
    host.appendChild(row);
  });
  renderTemplatePreview(item, values);
}
function renderTemplatePreview(item, values) {
  const subj = applyVars(item.subject || '', values);
  const body = applyVars(stripHtml(item.body || ''), values);
  $('#tplPreview').innerHTML = `
    <div class="template-preview-subject">${escapeHtml(subj) || '<em style="color:var(--ink-faint)">(no subject)</em>'}</div>
    <div class="template-preview-body">${escapeHtml(body) || '<em style="color:var(--ink-faint)">(no body)</em>'}</div>
  `;
}
function applyVars(text, values) {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => values[k] || `{{${k}}}`);
}
function renderTemplateText(item, which) {
  const vars = extractVars(item);
  const values = {};
  vars.forEach(v => values[v] = item.lastValues?.[v] || '');
  if (which === 'subject') return applyVars(item.subject || '', values);
  return applyVars(stripHtml(item.body || ''), values);
}

/* ===========================================================
   INSIGHT DETAIL
   =========================================================== */
const INSIGHT_FLAGS = [
  { value: '', label: '— none —' },
  { value: '💡', label: '💡 Insight' },
  { value: '📈', label: '📈 Performance' },
  { value: '✅', label: '✅ Win' },
  { value: '⚠️', label: '⚠️ Setback' }
];

async function renderInsightDetail(item) {
  const root = $('#detailContent');
  // ensure date defaults
  if (!item.date) item.date = (item.createdAt || now()).slice(0, 10);
  root.innerHTML = `
    <div class="detail-meta-row">
      <select class="select" id="insFolder">${folderSelectOptions(item)}</select>
      <span class="dot">·</span>
      <span>Updated ${formatDate(item.updatedAt)}</span>
      <span class="dot">·</span>
      <span>v${item.version || 1}</span>
      <span style="flex:1"></span>
      <button class="ghost-btn" id="insDupBtn" title="Duplicate">⎘ Duplicate</button>
      <button class="ghost-btn" id="insDeleteBtn" style="color:var(--danger)" title="Delete">🗑 Delete</button>
    </div>
    <input class="detail-title-input" id="insTitle" placeholder="Untitled insight" value="${escapeHtml(item.title || '')}">

    <div class="insight-meta-grid">
      <div class="insight-meta-field">
        <label class="insight-meta-label">Type</label>
        <select class="select insight-flag-select" id="insFlag">
          ${INSIGHT_FLAGS.map(f => `<option value="${f.value}" ${item.flag === f.value ? 'selected' : ''}>${f.label}</option>`).join('')}
        </select>
      </div>
      <div class="insight-meta-field">
        <label class="insight-meta-label">Date</label>
        <input type="date" class="select insight-date-input" id="insDate" value="${escapeHtml(item.date || '')}">
      </div>
    </div>

    <div class="detail-tags" id="insTags"></div>

    <div class="detail-section-title">Body</div>
    <div class="rich-toolbar" id="insToolbar">
      <button data-cmd="bold"><strong>B</strong></button>
      <button data-cmd="italic"><em>I</em></button>
      <button data-cmd="insertUnorderedList">•</button>
      <button data-cmd="insertOrderedList">1.</button>
      <span class="sep"></span>
      <button data-cmd="formatBlock" data-arg="h3">H</button>
      <button data-cmd="formatBlock" data-arg="pre">{ }</button>
      <button data-cmd="createLink">🔗</button>
      <button data-cmd="formatBlock" data-arg="p">¶</button>
    </div>
    <div class="rich-editor insight-body-editor" id="insBody" contenteditable="true" data-placeholder="Write the insight, observation, learning, or performance note…">${item.body || ''}</div>
  `;

  // Wire up
  $('#insTitle').addEventListener('input', debounce(e => { item.title = e.target.value; saveItem(item); }, 400));
  $('#insFolder').addEventListener('change', e => { item.folderId = e.target.value; saveItem(item); renderFolderTree(); });
  $('#insFlag').addEventListener('change', e => { item.flag = e.target.value; saveItem(item); });
  $('#insDate').addEventListener('change', e => { item.date = e.target.value; saveItem(item); });
  $('#insDupBtn').onclick = () => duplicateInsight(item);
  $('#insDeleteBtn').onclick = () => deleteCurrentItem(item);

  const bodyEl = $('#insBody');
  bodyEl.addEventListener('input', debounce(() => {
    item.body = bodyEl.innerHTML;
    saveItem(item);
  }, 500));

  $('#insToolbar').querySelectorAll('button[data-cmd]').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      bodyEl.focus();
      const cmd = btn.dataset.cmd;
      const arg = btn.dataset.arg || null;
      if (cmd === 'createLink') {
        const u = prompt('URL'); if (u) document.execCommand(cmd, false, u);
      } else {
        document.execCommand(cmd, false, arg);
      }
      item.body = bodyEl.innerHTML;
      saveItem(item);
    };
  });

  const insTagsCb = () => { saveItem(item); renderTags(item, $('#insTags'), insTagsCb); };
  renderTags(item, $('#insTags'), insTagsCb);
}

async function duplicateInsight(item) {
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = uuid();
  copy.title = (copy.title || 'Untitled') + ' (copy)';
  copy.createdAt = now();
  copy.updatedAt = now();
  copy.version = 1;
  await db.put('insights', copy);
  await loadList();
  openItem(copy.id);
  toast('Duplicated');
}

/* ===========================================================
   RUN MODE
   =========================================================== */
function enterRunMode(item) {
  $('#runMode').hidden = false;
  $('#runModeTitle').textContent = item.title || 'Untitled';
  const body = $('#runModeBody');
  body.innerHTML = '';
  (item.steps || []).forEach((s, idx) => {
    const el = document.createElement('div');
    el.className = 'run-step';
    el.innerHTML = `
      <div class="run-step-header">
        <div class="run-step-check ${s._runChecked ? 'checked' : ''}"></div>
        <div class="step-number">${idx+1}</div>
        <div class="run-step-title">${escapeHtml(s.title || 'Untitled')}</div>
      </div>
      <div class="run-step-body">
        <div>${s.description || ''}</div>
        ${renderRunSubsteps(s.substeps)}
      </div>
    `;
    el.querySelector('.run-step-check').onclick = (e) => {
      e.stopPropagation();
      s._runChecked = !s._runChecked;
      el.querySelector('.run-step-check').classList.toggle('checked', s._runChecked);
    };
    el.querySelector('.run-step-header').addEventListener('click', (e) => {
      if (e.target.closest('.run-step-check')) return;
      el.classList.toggle('expanded');
    });
    body.appendChild(el);
  });
}
function renderRunSubsteps(subs) {
  if (!subs || !subs.length) return '';
  return `<div class="run-substep-children">` + subs.map(s => `
    <div class="run-substep">▸ ${escapeHtml(s.title || '')}${renderRunSubsteps(s.substeps)}</div>
  `).join('') + `</div>`;
}
$('#runExitBtn').onclick = () => $('#runMode').hidden = true;

/* ===========================================================
   SEARCH
   =========================================================== */
async function buildSearchIndex() {
  const proc = await db.getAll('processes');
  const cl = await db.getAll('checklists');
  const tpl = await db.getAll('emailTemplates');
  const ins = await db.getAll('insights');
  const notes = await db.getAll('stepNotes');
  state.searchIndex = { proc, cl, tpl, ins, notes };
}
function runSearch(q) {
  q = q.toLowerCase().trim();
  if (!q || !state.searchIndex) return { processes: [], checklists: [], emailTemplates: [], insights: [], notes: [] };
  const { proc, cl, tpl, ins, notes } = state.searchIndex;
  const match = (s) => (s || '').toLowerCase().includes(q);
  const matchObj = (o, keys) => keys.some(k => match(o[k]));
  const processes = proc.filter(p => !p.deleted && (
    matchObj(p, ['title', 'description']) ||
    (p.tags || []).some(t => match(t)) ||
    (p.steps || []).some(s => matchObj(s, ['title','description']) ||
      (s.substeps || []).some(sub => match(sub.title)))
  ));
  const checklists = cl.filter(c => !c.deleted && (
    matchObj(c, ['title','description']) ||
    (c.tags || []).some(t => match(t)) ||
    (c.items || []).some(i => match(i.text) || match(i.sub))
  ));
  const emailTemplates = tpl.filter(t => !t.deleted && (
    matchObj(t, ['title','subject']) ||
    match(stripHtml(t.body || '')) ||
    (t.tags || []).some(x => match(x))
  ));
  const insights = ins.filter(i => !i.deleted && (
    matchObj(i, ['title']) ||
    match(stripHtml(i.body || '')) ||
    (i.tags || []).some(x => match(x)) ||
    match(i.flag) || match(i.date)
  ));
  const matchedNotes = notes.filter(n => match(n.text));
  return { processes, checklists, emailTemplates, insights, notes: matchedNotes };
}
function openSearch() {
  $('#searchModal').hidden = false;
  $('#searchInput').value = '';
  $('#searchResults').innerHTML = '';
  setTimeout(() => $('#searchInput').focus(), 50);
}
$('#searchInput').addEventListener('input', debounce(async (e) => {
  if (!state.searchIndex) await buildSearchIndex();
  const r = runSearch(e.target.value);
  renderSearchResults(r);
}, 200));
function renderSearchResults(r) {
  const host = $('#searchResults');
  host.innerHTML = '';
  const groups = [
    { key: 'processes', label: 'Processes', items: r.processes, tab: 'processes' },
    { key: 'checklists', label: 'Checklists', items: r.checklists, tab: 'checklists' },
    { key: 'emailTemplates', label: 'Email Templates', items: r.emailTemplates, tab: 'emailTemplates' },
    { key: 'insights', label: 'Insights & Performance', items: r.insights, tab: 'insights' },
    { key: 'notes', label: 'Step Notes', items: r.notes, tab: 'processes' }
  ];
  let total = 0;
  groups.forEach(g => total += g.items.length);
  if (total === 0) {
    host.innerHTML = `<div style="padding:20px;color:var(--ink-mute);font-size:13px;text-align:center">No results.</div>`;
    return;
  }
  groups.forEach(g => {
    if (g.items.length === 0) return;
    const sec = document.createElement('div');
    sec.className = 'search-result-group';
    sec.innerHTML = `<div class="search-result-group-title">${g.label} · ${g.items.length}</div>`;
    g.items.slice(0, 10).forEach(it => {
      const row = document.createElement('div');
      row.className = 'search-result';
      const title = it.title || it.subject || (it.text ? it.text.slice(0,60) : 'Untitled');
      row.innerHTML = `
        <div class="search-result-title">${escapeHtml(title)}</div>
        <div class="search-result-context">${escapeHtml(searchContext(it, g.key))}</div>
      `;
      row.onclick = () => {
        $('#searchModal').hidden = true;
        if (g.key === 'notes') jumpToItem('processes', it.processId);
        else jumpToItem(g.tab, it.id);
      };
      sec.appendChild(row);
    });
    host.appendChild(sec);
  });
}
function searchContext(it, key) {
  if (key === 'notes') return `Note from ${formatFull(it.createdAt)}`;
  if (key === 'processes') return (it.description || '').slice(0, 80) || `${it.steps?.length || 0} step(s)`;
  if (key === 'checklists') return (it.description || '').slice(0, 80) || `${it.items?.length || 0} item(s)`;
  if (key === 'emailTemplates') return (it.subject || '').slice(0, 80);
  if (key === 'insights') return `${it.flag || ''} ${it.date || ''} ${stripHtml(it.body || '').slice(0, 80)}`.trim();
  return '';
}

/* ===========================================================
   EXPORT / IMPORT
   =========================================================== */
async function exportData(scope = 'full') {
  const data = {};
  if (scope === 'full') {
    for (const s of STORES) data[s] = await db.getAll(s);
  } else {
    data[scope] = await db.getAll(scope);
    data.folders = (await db.getAll('folders')).filter(f => f.tabScope === scope);
    if (scope === 'processes') data.stepNotes = await db.getAll('stepNotes');
    if (scope === 'checklists') data.checklistSnapshots = await db.getAll('checklistSnapshots');
  }
  const dataString = JSON.stringify(data);
  const checksum = await sha256(dataString);
  const envelope = {
    appName: 'ProcDocs',
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now(),
    exportType: scope === 'full' ? 'full' : 'scoped',
    scope,
    checksum,
    data
  };
  const blob = JSON.stringify(envelope, null, 2);
  const stamp = new Date().toISOString().slice(0,16).replace(/[:T-]/g,'').replace(/(\d{8})(\d{4})/, '$1-$2');
  downloadFile(`procdocs-backup-${stamp}.json`, blob, 'application/json');
  await setMeta('lastExportAt', now());
  updateBackupBanner();
  toast('Exported', 'success');
}
function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Folder-scoped export/import ---------- */
// Walk a folder + all descendants, return { folders, items }
async function gatherFolderSubtree(rootFolderId) {
  const allFolders = await db.getAll('folders');
  const folderById = new Map(allFolders.map(f => [f.id, f]));
  const root = folderById.get(rootFolderId);
  if (!root) return null;
  const tabScope = root.tabScope;
  // collect this folder + descendants by walking parentId graph
  const folderIds = new Set([rootFolderId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of allFolders) {
      if (!folderIds.has(f.id) && f.parentId && folderIds.has(f.parentId)) {
        folderIds.add(f.id);
        added = true;
      }
    }
  }
  const folders = allFolders.filter(f => folderIds.has(f.id));
  const allItems = await db.getAll(tabScope);
  const items = allItems.filter(i => !i.deleted && folderIds.has(i.folderId));
  // gather aux records keyed off items
  const aux = {};
  if (tabScope === 'processes') {
    const allNotes = await db.getAll('stepNotes');
    const itemIds = new Set(items.map(i => i.id));
    aux.stepNotes = allNotes.filter(n => itemIds.has(n.processId));
  } else if (tabScope === 'checklists') {
    const allSnaps = await db.getAll('checklistSnapshots');
    const itemIds = new Set(items.map(i => i.id));
    aux.checklistSnapshots = allSnaps.filter(s => itemIds.has(s.checklistId));
  }
  return { tabScope, root, folders, items, aux };
}

async function exportFolderById(folderId) {
  const bundle = await gatherFolderSubtree(folderId);
  if (!bundle) { toast('Folder not found', 'error'); return; }
  const data = {
    folders: bundle.folders,
    [bundle.tabScope]: bundle.items,
    ...bundle.aux
  };
  const dataString = JSON.stringify(data);
  const checksum = await sha256(dataString);
  const envelope = {
    appName: 'ProcDocs',
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now(),
    exportType: 'folder',
    scope: bundle.tabScope,
    sourceFolderId: bundle.root.id,
    sourceFolderName: bundle.root.name,
    checksum,
    data
  };
  const blob = JSON.stringify(envelope, null, 2);
  const stamp = new Date().toISOString().slice(0,16).replace(/[:T-]/g,'').replace(/(\d{8})(\d{4})/, '$1-$2');
  const safeName = (bundle.root.name || 'folder').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
  downloadFile(`procdocs-folder-${safeName}-${stamp}.json`, blob, 'application/json');
  toast(`Exported ${bundle.folders.length} folder(s), ${bundle.items.length} item(s)`, 'success');
}

// Import flow specifically scoped to a target folder.
// Forces merge-only — never replace — and re-roots the imported folder tree under the target.
let pendingFolderImport = null;
function triggerFolderImport(targetFolderId) {
  pendingFolderImport = { targetFolderId, file: null, env: null };
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const env = JSON.parse(text);
      if (!env.data || !env.schemaVersion) throw new Error('Not a ProcDocs backup');
      if (env.exportType !== 'folder' && env.exportType !== 'scoped' && env.exportType !== 'full') {
        throw new Error('Unrecognized export type');
      }
      // Determine scope of imported file
      const targetFolder = await db.get('folders', targetFolderId);
      if (!targetFolder) throw new Error('Target folder no longer exists');
      const importScope = env.scope || detectScopeFromData(env.data);
      if (importScope && importScope !== targetFolder.tabScope) {
        const ok = confirm(`This export contains ${importScope} items, but you're importing into a ${targetFolder.tabScope} folder. Continue anyway?`);
        if (!ok) return;
      }
      const dataString = JSON.stringify(env.data);
      const checksum = await sha256(dataString);
      const checksumOk = env.checksum === checksum;
      pendingFolderImport.env = env;
      pendingFolderImport.targetFolder = targetFolder;
      showFolderImportPreview(env, targetFolder, checksumOk);
    } catch (err) {
      toast('Invalid file: ' + err.message, 'error');
    }
  };
  input.click();
}

function detectScopeFromData(data) {
  for (const s of ['processes','checklists','emailTemplates','insights']) {
    if (data[s] && data[s].length > 0) return s;
  }
  return null;
}

function showFolderImportPreview(env, targetFolder, checksumOk) {
  const counts = {};
  for (const s of STORES) counts[s] = (env.data[s] || []).length;
  // Build preview modal content into the existing #importModal
  $('#importPreview').hidden = false;
  $('#importPickBtn').hidden = true;
  $('#importModal').hidden = false;
  $('#importPreview').innerHTML = `
    <div style="font-size:13px;margin-bottom:12px">
      <strong>Source:</strong> ${escapeHtml(env.sourceFolderName || '—')} (${escapeHtml(env.exportType)})<br>
      <strong>Target:</strong> ${escapeHtml(targetFolder.name)}<br>
      <strong>Exported:</strong> ${formatFull(env.exportedAt)}
      ${checksumOk ? '<span style="color:var(--success);margin-left:8px">✓ checksum ok</span>' : '<span style="color:var(--danger);margin-left:8px">⚠ checksum mismatch</span>'}
    </div>
    <div class="import-preview-stats">
      <div class="import-preview-stat"><span>Folders</span><strong>${counts.folders||0}</strong></div>
      <div class="import-preview-stat"><span>Items</span><strong>${(counts.processes||0)+(counts.checklists||0)+(counts.emailTemplates||0)+(counts.insights||0)}</strong></div>
      <div class="import-preview-stat"><span>Step notes</span><strong>${counts.stepNotes||0}</strong></div>
      <div class="import-preview-stat"><span>Snapshots</span><strong>${counts.checklistSnapshots||0}</strong></div>
    </div>
    <div style="font-size:12px;color:var(--ink-mute);margin:8px 0 12px;line-height:1.5">
      Other folders outside <strong>${escapeHtml(targetFolder.name)}</strong> will not be touched. Choose how to handle the imported records:
    </div>
    <div class="import-mode-options">
      <button class="import-mode-option" data-folder-mode="import-as-new">
        <strong>Import as new (safest)</strong>
        <span>Every imported record gets a fresh ID. Re-importing the same file creates duplicates. Use this for sharing or adding a colleague's export.</span>
      </button>
      <button class="import-mode-option" data-folder-mode="merge-newer">
        <strong>Merge — keep newer</strong>
        <span>For records with matching IDs, keeps whichever is newer. New records added as-is. Use this to restore your own backup of this folder.</span>
      </button>
    </div>
  `;
  $('#importPreview').querySelectorAll('[data-folder-mode]').forEach(b => {
    b.onclick = () => doFolderImport(b.dataset.folderMode);
  });
}

async function doFolderImport(mode) {
  const { env, targetFolder } = pendingFolderImport;
  const data = env.data || {};
  const scope = targetFolder.tabScope;
  const incomingItems = data[scope] || [];
  const incomingFolders = data.folders || [];

  let imported = 0, skipped = 0, foldersAdded = 0;

  if (mode === 'import-as-new') {
    // Map old IDs → new IDs for folders and items, then re-root the folder tree.
    const idMap = {};
    // Decide which incoming folder is the "root" of the imported subtree:
    // it's the one whose parentId is not in the import file (or null).
    const incomingFolderIds = new Set(incomingFolders.map(f => f.id));
    const rootImports = incomingFolders.filter(f => !f.parentId || !incomingFolderIds.has(f.parentId));
    // Assign fresh IDs to every folder in the bundle
    for (const f of incomingFolders) {
      idMap[f.id] = uuid();
    }
    // Assign fresh IDs to every item
    for (const it of incomingItems) {
      idMap[it.id] = uuid();
    }
    // Write folders with remapped IDs/parents, re-root roots under target
    for (const f of incomingFolders) {
      const newFolder = { ...f, id: idMap[f.id], tabScope: scope };
      newFolder.builtIn = false;
      if (rootImports.find(r => r.id === f.id)) {
        newFolder.parentId = targetFolder.id;
      } else {
        newFolder.parentId = idMap[f.parentId] || targetFolder.id;
      }
      newFolder.updatedAt = now();
      await db.put('folders', newFolder);
      foldersAdded++;
    }
    // Write items, remap folderId and any nested references via idMap
    for (const it of incomingItems) {
      const newItem = { ...it, id: idMap[it.id] };
      newItem.folderId = idMap[it.folderId] || targetFolder.id;
      newItem.updatedAt = now();
      newItem.version = 1;
      // Remap step IDs in processes; nested references
      if (scope === 'processes' && newItem.steps) {
        const stepIdMap = {};
        newItem.steps = newItem.steps.map(s => {
          const newStepId = uuid();
          stepIdMap[s.id] = newStepId;
          return { ...s, id: newStepId };
        });
        // store step map for stepNotes remapping
        idMap['__steps_' + it.id] = stepIdMap;
        // remap linkedChecklists / linkedTemplates — drop dangling refs (no map = leave as-is so they may break)
        for (const s of newItem.steps) {
          if (s.linkedChecklists) s.linkedChecklists = s.linkedChecklists.map(c => idMap[c] || c);
          if (s.linkedTemplates) s.linkedTemplates = s.linkedTemplates.map(t => idMap[t] || t);
        }
      }
      await db.put(scope, newItem);
      imported++;
    }
    // Write aux records (stepNotes / snapshots) with remapped foreign keys
    if (data.stepNotes) {
      for (const n of data.stepNotes) {
        const newProcId = idMap[n.processId];
        if (!newProcId) continue;
        const stepIdMap = idMap['__steps_' + n.processId] || {};
        const newStepId = stepIdMap[n.stepId] || n.stepId;
        await db.put('stepNotes', { ...n, id: uuid(), processId: newProcId, stepId: newStepId });
      }
    }
    if (data.checklistSnapshots) {
      for (const s of data.checklistSnapshots) {
        const newCid = idMap[s.checklistId];
        if (!newCid) continue;
        await db.put('checklistSnapshots', { ...s, id: uuid(), checklistId: newCid });
      }
    }
  } else if (mode === 'merge-newer') {
    // Preserve IDs. For each incoming folder/item, only write if newer or new.
    // Folders: don't re-root — keep their original parent if it exists in DB or in import, else fall back to target.
    const incomingFolderIds = new Set(incomingFolders.map(f => f.id));
    for (const f of incomingFolders) {
      const existing = await db.get('folders', f.id);
      if (existing) {
        const a = new Date(existing.updatedAt || 0).getTime();
        const b = new Date(f.updatedAt || 0).getTime();
        if (b > a) {
          await db.put('folders', { ...f, tabScope: scope, builtIn: existing.builtIn || false });
          foldersAdded++;
        } else skipped++;
      } else {
        // New folder — if its parent doesn't exist in DB and isn't in the import, root it to target
        const parentExists = f.parentId && (incomingFolderIds.has(f.parentId) || await db.get('folders', f.parentId));
        await db.put('folders', { ...f, tabScope: scope, parentId: parentExists ? f.parentId : targetFolder.id, builtIn: false });
        foldersAdded++;
      }
    }
    for (const it of incomingItems) {
      const existing = await db.get(scope, it.id);
      if (existing) {
        const a = new Date(existing.updatedAt || 0).getTime();
        const b = new Date(it.updatedAt || 0).getTime();
        if (b > a) { await db.put(scope, it); imported++; } else skipped++;
      } else {
        // Ensure folderId points somewhere valid
        const folderOk = it.folderId && (incomingFolderIds.has(it.folderId) || await db.get('folders', it.folderId));
        await db.put(scope, { ...it, folderId: folderOk ? it.folderId : targetFolder.id });
        imported++;
      }
    }
    if (data.stepNotes) {
      for (const n of data.stepNotes) {
        const existing = await db.get('stepNotes', n.id);
        if (!existing) { await db.put('stepNotes', n); }
      }
    }
    if (data.checklistSnapshots) {
      for (const s of data.checklistSnapshots) {
        const existing = await db.get('checklistSnapshots', s.id);
        if (!existing) { await db.put('checklistSnapshots', s); }
      }
    }
  }

  $('#importModal').hidden = true;
  $('#importPreview').hidden = true;
  $('#importPickBtn').hidden = false;
  pendingFolderImport = null;
  await renderFolderTree();
  await loadList();
  toast(`Imported ${imported} item(s), ${foldersAdded} folder(s). ${skipped} skipped.`, 'success');
}

let pendingImport = null;
$('#importPickBtn').onclick = () => $('#importFile').click();
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const env = JSON.parse(text);
    if (!env.data || !env.schemaVersion) throw new Error('Not a ProcDocs backup');
    // checksum check
    const dataString = JSON.stringify(env.data);
    const checksum = await sha256(dataString);
    const checksumOk = env.checksum === checksum;
    pendingImport = env;
    showImportPreview(env, checksumOk);
  } catch (err) {
    toast('Invalid file: ' + err.message, 'error');
  }
  e.target.value = '';
});
function showImportPreview(env, checksumOk) {
  const counts = {};
  for (const s of STORES) counts[s] = (env.data[s] || []).length;
  const host = $('#importPreview');
  host.hidden = false;
  host.innerHTML = `
    <div style="font-size:13px;margin-bottom:10px">
      <strong>From:</strong> ${escapeHtml(env.appName || 'Unknown')} v${escapeHtml(env.appVersion || '?')}<br>
      <strong>Exported:</strong> ${formatFull(env.exportedAt)}<br>
      <strong>Schema:</strong> v${env.schemaVersion}
      ${checksumOk ? '<span style="color:var(--success);margin-left:8px">✓ checksum ok</span>' : '<span style="color:var(--danger);margin-left:8px">⚠ checksum mismatch</span>'}
    </div>
    <div class="import-preview-stats">
      <div class="import-preview-stat"><span>Processes</span><strong>${counts.processes||0}</strong></div>
      <div class="import-preview-stat"><span>Checklists</span><strong>${counts.checklists||0}</strong></div>
      <div class="import-preview-stat"><span>Email templates</span><strong>${counts.emailTemplates||0}</strong></div>
      <div class="import-preview-stat"><span>Insights</span><strong>${counts.insights||0}</strong></div>
      <div class="import-preview-stat"><span>Folders</span><strong>${counts.folders||0}</strong></div>
      <div class="import-preview-stat"><span>Step notes</span><strong>${counts.stepNotes||0}</strong></div>
      <div class="import-preview-stat"><span>Snapshots</span><strong>${counts.checklistSnapshots||0}</strong></div>
    </div>
    <div class="import-mode-options">
      <button class="import-mode-option" data-mode="replace">
        <strong>Replace all</strong>
        <span>Wipes current data and loads this backup. Type "REPLACE" to confirm.</span>
      </button>
      <button class="import-mode-option" data-mode="merge-newer">
        <strong>Merge — keep newer</strong>
        <span>For matching IDs, keeps the record with the later updatedAt.</span>
      </button>
      <button class="import-mode-option" data-mode="merge-new">
        <strong>Merge — import as new</strong>
        <span>Assigns fresh IDs so nothing collides with existing data.</span>
      </button>
    </div>
  `;
  host.querySelectorAll('.import-mode-option').forEach(b => {
    b.onclick = () => doImport(b.dataset.mode);
  });
}
async function doImport(mode) {
  if (!pendingImport) return;
  const env = pendingImport;
  const migrated = migrate(env.data, env.schemaVersion);

  if (mode === 'replace') {
    confirmDialog({
      title: 'Replace all data?',
      message: 'Type REPLACE to confirm. This wipes everything currently in the app.',
      requireType: 'REPLACE',
      ok: async () => {
        for (const s of STORES) await db.clear(s);
        for (const s of STORES) if (migrated[s]) await db.bulkPut(s, migrated[s]);
        await afterImport(0, 'Replaced all data');
      }
    });
    return;
  }

  let imported = 0, skipped = 0;

  for (const s of STORES) {
    const incoming = migrated[s] || [];
    if (!incoming.length) continue;
    if (mode === 'merge-new') {
      // remap ids
      const idMap = {};
      for (const rec of incoming) {
        const newId = uuid();
        idMap[rec.id] = newId;
        rec.id = newId;
      }
      // fix references (e.g. stepNotes.processId, folders.parentId, snapshots.checklistId)
      remapReferences(incoming, idMap, s);
      await db.bulkPut(s, incoming);
      imported += incoming.length;
    } else {
      // merge-newer
      for (const rec of incoming) {
        const existing = await db.get(s, rec.id);
        if (!existing) {
          await db.put(s, rec); imported++;
        } else {
          const a = new Date(existing.updatedAt || 0).getTime();
          const b = new Date(rec.updatedAt || 0).getTime();
          if (b > a) { await db.put(s, rec); imported++; }
          else skipped++;
        }
      }
    }
  }
  await afterImport(imported, `Imported ${imported} record(s). Skipped ${skipped}.`);
}
function remapReferences(records, idMap, store) {
  // We don't perfectly know which fields are refs to which store, but for safe operation
  // within merge-new, since ALL stores are remapped, blanket-mapping any string field
  // value that matches a known old id is acceptable.
  for (const r of records) {
    for (const k of Object.keys(r)) {
      if (typeof r[k] === 'string' && idMap[r[k]]) {
        r[k] = idMap[r[k]];
      }
      if (Array.isArray(r[k])) {
        r[k] = r[k].map(v => (typeof v === 'string' && idMap[v]) ? idMap[v] : v);
        // process steps array — recursively scan ids/refs
        for (const item of r[k]) {
          if (item && typeof item === 'object') remapObjectIds(item, idMap);
        }
      }
    }
  }
}
function remapObjectIds(obj, idMap) {
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] === 'string' && idMap[obj[k]]) {
      obj[k] = idMap[obj[k]];
    } else if (Array.isArray(obj[k])) {
      obj[k] = obj[k].map(v => (typeof v === 'string' && idMap[v]) ? idMap[v] : v);
      for (const v of obj[k]) if (v && typeof v === 'object') remapObjectIds(v, idMap);
    } else if (obj[k] && typeof obj[k] === 'object') {
      remapObjectIds(obj[k], idMap);
    }
  }
}
async function afterImport(count, msg) {
  $('#importModal').hidden = true;
  $('#importPreview').hidden = true;
  pendingImport = null;
  await renderFolderTree();
  await loadList();
  toast(msg, 'success');
}

// Schema migration pipeline. Keep all old migrations indefinitely.
function migrate(data, fromVersion) {
  let v = fromVersion;
  let d = data;
  // No migrations needed yet — but the pipeline is here for future versions.
  // while (v < SCHEMA_VERSION) {
  //   if (v === 1) { d = migrateV1toV2(d); v = 2; }
  //   ...
  // }
  return d;
}

/* ---------- Auto-backup ---------- */
async function maybeAutoBackup() {
  const last = await getMeta('lastAutoBackup');
  const lastTs = last ? new Date(last).getTime() : 0;
  if (Date.now() - lastTs < 86400000) return; // less than 24h
  try {
    const data = {};
    for (const s of STORES) if (s !== 'autoBackups') data[s] = await db.getAll(s);
    const envelope = {
      id: uuid(),
      createdAt: now(),
      data,
      size: JSON.stringify(data).length
    };
    await db.put('autoBackups', envelope);
    // prune to last 7
    const all = await db.getAll('autoBackups');
    all.sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    for (let i = 7; i < all.length; i++) await db.delete('autoBackups', all[i].id);
    await setMeta('lastAutoBackup', now());
  } catch (e) { console.warn('auto-backup failed', e); }
}

/* ---------- Backup banner ---------- */
async function updateBackupBanner() {
  const last = await getMeta('lastExportAt');
  const dismissed = await getMeta('backupBannerDismissedAt');
  const banner = $('#backupBanner');
  if (!last) {
    if (!dismissed || (Date.now() - new Date(dismissed).getTime() > 7*86400000)) {
      const counts = await Promise.all(['processes','checklists','emailTemplates','insights'].map(s => db.count(s)));
      const total = counts.reduce((a,b)=>a+b, 0);
      if (total > 0) {
        $('#backupBannerText').textContent = `You haven't exported a backup yet — protect your data.`;
        banner.hidden = false;
        return;
      }
    }
    banner.hidden = true;
    return;
  }
  const days = (Date.now() - new Date(last).getTime()) / 86400000;
  if (days > 14 && (!dismissed || new Date(dismissed) < new Date(last))) {
    $('#backupBannerText').textContent = `It's been ${Math.floor(days)} days since your last backup. Consider exporting.`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}
$('#backupBannerDismiss').onclick = async () => {
  await setMeta('backupBannerDismissedAt', now());
  $('#backupBanner').hidden = true;
};
$('#backupBannerExport').onclick = () => exportData('full');

/* ===========================================================
   TRASH
   =========================================================== */
async function openTrash() {
  $('#trashModal').hidden = false;
  const trash = await db.getAll('trash');
  trash.sort((a,b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  const host = $('#trashBody');
  if (trash.length === 0) {
    host.innerHTML = `<div style="color:var(--ink-mute);font-size:13px;text-align:center;padding:24px">Trash is empty.</div>`;
    return;
  }
  // purge >30 days
  const cutoff = Date.now() - 30*86400000;
  for (const t of trash) {
    if (new Date(t.deletedAt).getTime() < cutoff) {
      await db.delete('trash', t.id);
      await db.delete(t.store, t.id);
    }
  }
  const fresh = await db.getAll('trash');
  fresh.sort((a,b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  host.innerHTML = '';
  if (fresh.length === 0) {
    host.innerHTML = `<div style="color:var(--ink-mute);font-size:13px;text-align:center;padding:24px">Trash is empty.</div>`;
    return;
  }
  fresh.forEach(t => {
    const days = Math.floor((Date.now() - new Date(t.deletedAt).getTime()) / 86400000);
    const remaining = 30 - days;
    const el = document.createElement('div');
    el.className = 'trash-item';
    el.innerHTML = `
      <div class="trash-item-info">
        <div>${escapeHtml(t.title)} <span style="color:var(--ink-mute);font-size:11px">(${t.store})</span></div>
        <div class="trash-item-meta">Deleted ${formatFull(t.deletedAt)} · ${remaining}d remaining</div>
      </div>
      <div class="trash-item-actions">
        <button class="ghost-btn" data-action="restore">Restore</button>
        <button class="danger-btn" data-action="purge">Delete forever</button>
      </div>
    `;
    el.querySelector('[data-action="restore"]').onclick = async () => {
      const item = await db.get(t.store, t.id);
      if (item) {
        delete item.deleted; delete item.deletedAt; delete item.deletedFromStore;
        item.updatedAt = now();
        await db.put(t.store, item);
      }
      await db.delete('trash', t.id);
      openTrash();
      loadList();
      toast('Restored');
    };
    el.querySelector('[data-action="purge"]').onclick = () => {
      confirmDialog({
        title: 'Delete forever?',
        message: 'This cannot be undone.',
        ok: async () => {
          await db.delete(t.store, t.id);
          await db.delete('trash', t.id);
          // also clean any stepNotes for processes
          if (t.store === 'processes') {
            const notes = await db.getByIndex('stepNotes', 'processId', t.id);
            for (const n of notes) await db.delete('stepNotes', n.id);
          }
          openTrash();
          toast('Deleted');
        }
      });
    };
    host.appendChild(el);
  });
}

/* ===========================================================
   SETTINGS
   =========================================================== */
async function openSettings() {
  $('#settingsModal').hidden = false;
  $$('.layout-mode-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.layoutMode === layoutMode));
  const counts = {};
  for (const s of STORES) counts[s] = await db.count(s);
  $('#dbStats').innerHTML = `
    ${counts.processes} processes · ${counts.checklists} checklists · ${counts.emailTemplates} templates · ${counts.insights} insights<br>
    ${counts.folders} folders · ${counts.stepNotes} notes · ${counts.checklistSnapshots} snapshots
  `;
  const last = await getMeta('lastExportAt');
  $('#lastExportStat').textContent = last ? formatFull(last) : 'Never';

  const backups = await db.getAll('autoBackups');
  backups.sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const list = $('#autoBackupsList');
  if (backups.length === 0) {
    list.innerHTML = `<div style="color:var(--ink-mute);font-size:12px;font-style:italic">No auto-backups yet. One will be created after 24 hours of use.</div>`;
  } else {
    list.innerHTML = '';
    backups.forEach(b => {
      const el = document.createElement('div');
      el.className = 'auto-backup-item';
      el.innerHTML = `
        <span>${formatFull(b.createdAt)} · ${Math.round((b.size||0)/1024)} KB</span>
        <div style="display:flex;gap:4px">
          <button class="ghost-btn" data-action="download">Download</button>
          <button class="ghost-btn" data-action="restore" style="color:var(--accent)">Restore</button>
        </div>
      `;
      el.querySelector('[data-action="download"]').onclick = () => {
        const env = {
          appName: 'ProcDocs', appVersion: APP_VERSION,
          schemaVersion: SCHEMA_VERSION,
          exportedAt: b.createdAt,
          exportType: 'auto-backup',
          data: b.data
        };
        downloadFile(`procdocs-auto-${b.createdAt.slice(0,10)}.json`, JSON.stringify(env, null, 2), 'application/json');
      };
      el.querySelector('[data-action="restore"]').onclick = () => {
        confirmDialog({
          title: 'Restore from auto-backup?',
          message: 'This will REPLACE all current data with the snapshot from ' + formatFull(b.createdAt) + '. Type RESTORE to confirm.',
          requireType: 'RESTORE',
          ok: async () => {
            for (const s of STORES) if (s !== 'autoBackups') await db.clear(s);
            for (const s of STORES) if (s !== 'autoBackups' && b.data[s]) await db.bulkPut(s, b.data[s]);
            $('#settingsModal').hidden = true;
            await renderFolderTree();
            await loadList();
            toast('Restored from auto-backup', 'success');
          }
        });
      };
      list.appendChild(el);
    });
  }
}
$('#wipeAllBtn').onclick = () => {
  confirmDialog({
    title: 'Wipe everything?',
    message: 'This permanently deletes all your data and cannot be undone. Type WIPE to confirm.',
    requireType: 'WIPE',
    ok: async () => {
      for (const s of STORES) await db.clear(s);
      await seedIfEmpty();
      $('#settingsModal').hidden = true;
      state.currentItemId = null;
      $('#detailEmpty').hidden = false;
      $('#detailContent').hidden = true;
      await renderFolderTree();
      await loadList();
      toast('All data wiped');
    }
  });
};
$('#linkGraphBtn').onclick = openLinkGraph;

async function openLinkGraph() {
  $('#linkGraphModal').hidden = false;
  const procs = (await db.getAll('processes')).filter(p => !p.deleted);
  const body = $('#linkGraphBody');
  if (procs.length === 0) {
    body.innerHTML = `<div style="color:var(--ink-mute);font-size:13px;text-align:center;padding:24px">No processes yet.</div>`;
    return;
  }
  body.innerHTML = '';
  for (const p of procs) {
    const links = [];
    for (const s of (p.steps || [])) {
      for (const cid of (s.linkedChecklists || [])) {
        const c = await db.get('checklists', cid);
        if (c) links.push({ stepTitle: s.title || 'Untitled step', type: 'checklist', title: c.title || 'Untitled' });
      }
      for (const tid of (s.linkedTemplates || [])) {
        const t = await db.get('emailTemplates', tid);
        if (t) links.push({ stepTitle: s.title || 'Untitled step', type: 'template', title: t.title || 'Untitled' });
      }
    }
    if (links.length === 0) continue;
    const el = document.createElement('div');
    el.className = 'link-graph-process';
    el.innerHTML = `
      <div class="link-graph-process-header">${escapeHtml(p.title || 'Untitled')}</div>
      <div class="link-graph-process-links">
        ${links.map(l => `<div class="link-graph-link"><strong>${escapeHtml(l.stepTitle)}</strong> → ${l.type === 'checklist' ? '☑' : '✉'} ${escapeHtml(l.title)}</div>`).join('')}
      </div>
    `;
    body.appendChild(el);
  }
  if (body.innerHTML === '') {
    body.innerHTML = `<div style="color:var(--ink-mute);font-size:13px;text-align:center;padding:24px">No links yet. Link checklists and templates from process steps.</div>`;
  }
}

/* ===========================================================
   CONFIRM DIALOG
   =========================================================== */
function confirmDialog({ title, message, ok, requireType }) {
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  const typeInput = $('#confirmTypeInput');
  const okBtn = $('#confirmOk');
  if (requireType) {
    typeInput.hidden = false;
    typeInput.value = '';
    typeInput.placeholder = `Type ${requireType} to confirm`;
    okBtn.disabled = true;
    typeInput.oninput = () => okBtn.disabled = typeInput.value.trim() !== requireType;
  } else {
    typeInput.hidden = true;
    okBtn.disabled = false;
  }
  $('#confirmModal').hidden = false;
  const cleanup = () => {
    $('#confirmModal').hidden = true;
    okBtn.onclick = null;
    $('#confirmCancel').onclick = null;
  };
  okBtn.onclick = () => { cleanup(); ok && ok(); };
  $('#confirmCancel').onclick = cleanup;
}

/* ===========================================================
   THEME
   =========================================================== */
async function applyTheme() {
  const t = await getMeta('theme', 'light');
  state.theme = t;
  document.body.dataset.theme = t;
}
$('#themeBtn').onclick = async () => {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.body.dataset.theme = state.theme;
  await setMeta('theme', state.theme);
};

/* ===========================================================
   WIRE-UP
   =========================================================== */
$('#searchBtn').onclick = openSearch;
$('#newBtn').onclick = createItem;
$('#quickNewBtn').onclick = createItem;
$('#fabBtn').onclick = createItem;

/* ---------- Layout mode (Auto / Desktop / Mobile) ---------- */
const MOBILE_BREAKPOINT = 768;
// 'auto' = follow screen width (original behaviour)
// 'desktop' = force the multi-pane desktop layout regardless of width
// 'mobile' = force the single-screen mobile layout regardless of width
let layoutMode = 'auto';

// The effective layout: resolves 'auto' against the current viewport width.
const isMobile = () => {
  if (layoutMode === 'mobile') return true;
  if (layoutMode === 'desktop') return false;
  return window.innerWidth <= MOBILE_BREAKPOINT;
};

// Push the chosen mode onto <body> so CSS can force the matching layout.
function applyLayoutMode() {
  if (layoutMode === 'auto') {
    delete document.body.dataset.layoutMode;
  } else {
    document.body.dataset.layoutMode = layoutMode;
  }
  initMobileScreen();
  // Reflect current selection in any open toggle UI.
  $$('.layout-mode-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.layoutMode === layoutMode));
}

async function loadLayoutMode() {
  layoutMode = await getMeta('layoutMode', 'auto');
  if (!['auto', 'desktop', 'mobile'].includes(layoutMode)) layoutMode = 'auto';
  applyLayoutMode();
}

async function setLayoutMode(mode) {
  layoutMode = mode;
  await setMeta('layoutMode', mode);
  applyLayoutMode();
}

/* ---------- Mobile screen navigation ---------- */
function setMobileScreen(name) {
  if (!isMobile()) return;
  document.body.dataset.mobileScreen = name;
}
function clearMobileScreen() {
  delete document.body.dataset.mobileScreen;
}
function initMobileScreen() {
  if (isMobile()) {
    // Default to "list" view on mobile if nothing selected
    if (!document.body.dataset.mobileScreen) {
      document.body.dataset.mobileScreen = 'list';
    }
  } else {
    clearMobileScreen();
  }
}
window.addEventListener('resize', initMobileScreen);

$('#listBackBtn').onclick = () => setMobileScreen('folders');
$('#detailBackBtn').onclick = () => setMobileScreen('list');

/* ---------- Action sheet (mobile context menu) ---------- */
function openActionSheet({ title, actions }) {
  const sheet = $('#actionSheet');
  $('#actionSheetTitle').textContent = title || '';
  const body = $('#actionSheetBody');
  body.innerHTML = '';
  for (const a of actions) {
    if (a.separator) {
      const sep = document.createElement('div');
      sep.className = 'action-sheet-sep';
      body.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.className = a.danger ? 'danger' : '';
    btn.innerHTML = `${a.icon ? a.icon + ' ' : ''}<span>${escapeHtml(a.label)}</span>`;
    btn.onclick = () => {
      closeActionSheet();
      setTimeout(() => a.onClick && a.onClick(), 50);
    };
    body.appendChild(btn);
  }
  sheet.hidden = false;
}
function closeActionSheet() {
  $('#actionSheet').hidden = true;
}
$('#actionSheet').addEventListener('click', (e) => {
  if (e.target === $('#actionSheet') || e.target.closest('[data-close-action-sheet]')) {
    closeActionSheet();
  }
});

/* Build folder context actions for action sheet (mobile equivalent of right-click menu) */
async function openFolderActionSheet(folder) {
  const actions = [
    { label: 'Rename', onClick: async () => {
      const nn = prompt('Rename folder', folder.name);
      if (nn && nn.trim()) { folder.name = nn.trim(); folder.updatedAt = now(); await db.put('folders', folder); renderFolderTree(); }
    }},
    { label: 'Add sub-folder', onClick: async () => {
      const nn = prompt('New sub-folder name');
      if (nn && nn.trim()) await createFolder(nn.trim(), folder.id);
    }},
    { label: 'Change colour', onClick: async () => {
      const c = prompt('Hex colour (e.g. #8b3a1f)', folder.color || '#8a7f70');
      if (c) { folder.color = c; folder.updatedAt = now(); await db.put('folders', folder); renderFolderTree(); }
    }},
    { label: 'Move to…', onClick: async () => {
      if (folder.builtIn) { toast('Cannot move the Uncategorized folder', 'error'); return; }
      const all = await db.getAll('folders');
      const excl = new Set([folder.id]);
      let added = true;
      while (added) {
        added = false;
        for (const x of all) if (!excl.has(x.id) && x.parentId && excl.has(x.parentId)) { excl.add(x.id); added = true; }
      }
      openFolderPicker({
        title: `Move "${folder.name}" to…`,
        tabScope: folder.tabScope,
        excludeIds: excl,
        onPick: async (folderId) => await reparentFolder(folder.id, folderId)
      });
    }},
    { separator: true },
    { label: 'Export folder…', onClick: () => exportFolderById(folder.id) },
    { label: 'Import into folder…', onClick: () => triggerFolderImport(folder.id) },
    { separator: true },
    { label: 'Delete folder', danger: true, onClick: () => {
      if (folder.builtIn) { toast('Cannot delete the Uncategorized folder', 'error'); return; }
      handleFolderDelete(folder);
    }}
  ];
  openActionSheet({ title: folder.name, actions });
}

async function handleFolderDelete(folder) {
  const items = (await db.getByIndex(state.currentTab, 'folderId', folder.id)).length;
  confirmDialog({
    title: 'Delete folder?',
    message: `Delete "${folder.name}"? ${items > 0 ? `${items} item(s) inside will move to Uncategorized.` : ''}`,
    ok: async () => {
      const subs = await db.getByIndex('folders', 'parentId', folder.id);
      for (const s of subs) { s.parentId = folder.parentId; await db.put('folders', s); }
      const itemsInF = await db.getByIndex(state.currentTab, 'folderId', folder.id);
      for (const it of itemsInF) { it.folderId = 'uncat_' + state.currentTab; it.updatedAt = now(); await db.put(state.currentTab, it); }
      await db.delete('folders', folder.id);
      renderFolderTree(); loadList();
      toast('Folder deleted');
    }
  });
}

/* Build item context actions for action sheet */
function openItemActionSheet(item) {
  const actions = [
    { label: 'Open', onClick: () => { openItem(item.id); setMobileScreen('detail'); }},
    { label: 'Move to…', onClick: () => {
      openFolderPicker({
        title: `Move "${item.title || 'Untitled'}" to…`,
        tabScope: state.currentTab,
        excludeIds: new Set(),
        onPick: async (folderId) => {
          await moveItemsToFolder([item.id], state.currentTab, folderId);
          toast('Moved');
        }
      });
    }},
    { label: 'Duplicate', onClick: async () => {
      if (state.currentTab === 'processes') return duplicateProcess(item);
      // Generic duplicate
      const copy = JSON.parse(JSON.stringify(item));
      copy.id = uuid();
      copy.title = (copy.title || 'Untitled') + ' (copy)';
      copy.createdAt = now();
      copy.updatedAt = now();
      copy.version = 1;
      await db.put(state.currentTab, copy);
      await loadList();
      toast('Duplicated');
    }},
    { separator: true },
    { label: 'Delete', danger: true, onClick: () => {
      confirmDialog({
        title: 'Move to trash?',
        message: 'You can restore from the Trash for 30 days.',
        ok: async () => {
          item.deleted = true;
          item.deletedAt = now();
          item.deletedFromStore = state.currentTab;
          await db.put(state.currentTab, item);
          await db.put('trash', { id: item.id, store: state.currentTab, title: item.title || 'Untitled', deletedAt: item.deletedAt });
          await loadList();
          toast('Moved to trash');
        }
      });
    }}
  ];
  openActionSheet({ title: item.title || 'Untitled', actions });
}

/* ---------- Long-press helper ---------- */
function attachLongPress(el, handler) {
  let timer = null;
  let startX = 0, startY = 0, moved = false;
  const start = (e) => {
    const touch = e.touches ? e.touches[0] : e;
    startX = touch.clientX; startY = touch.clientY; moved = false;
    timer = setTimeout(() => {
      if (!moved) {
        // Provide haptic feedback if available
        if (navigator.vibrate) navigator.vibrate(15);
        handler(e);
      }
    }, 450);
  };
  const move = (e) => {
    const touch = e.touches ? e.touches[0] : e;
    if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
      moved = true;
      clearTimeout(timer);
    }
  };
  const end = () => clearTimeout(timer);
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', move, { passive: true });
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}

/* ---------- Swipe gesture for list items ---------- */
function attachSwipeActions(itemEl, item) {
  let startX = 0, startY = 0, currentX = 0;
  let dragging = false;
  let direction = null; // 'h' or 'v' once determined
  const contentWrap = itemEl.querySelector('.list-item-content-wrap');
  if (!contentWrap) return;
  
  const start = (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; currentX = 0;
    dragging = true;
    direction = null;
  };
  const move = (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (!direction) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        direction = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
    }
    if (direction === 'h') {
      currentX = Math.min(0, dx); // only allow swipe-left
      contentWrap.style.transform = `translateX(${currentX}px)`;
    }
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (direction === 'h') {
      if (currentX < -60) {
        // open
        itemEl.classList.add('swiped');
        contentWrap.style.transform = '';
      } else {
        itemEl.classList.remove('swiped');
        contentWrap.style.transform = '';
      }
    }
  };
  itemEl.addEventListener('touchstart', start, { passive: true });
  itemEl.addEventListener('touchmove', move, { passive: true });
  itemEl.addEventListener('touchend', end);
  itemEl.addEventListener('touchcancel', end);
  
  // Close swiped state when interacting elsewhere
  document.addEventListener('click', (e) => {
    if (!itemEl.contains(e.target) && itemEl.classList.contains('swiped')) {
      itemEl.classList.remove('swiped');
    }
  });
}

/* ---------- Sidebar / list-pane collapse ---------- */
async function applyCollapseState() {
  const sc = await getMeta('sidebarCollapsed', false);
  const lc = await getMeta('listCollapsed', false);
  const layout = $('#layout');
  layout.classList.toggle('sidebar-collapsed', !!sc);
  layout.classList.toggle('list-collapsed', !!lc);
  $('#listExpandBtn').hidden = !lc;
  // Update topbar toggle icon — different orientation when collapsed
  const icon = $('#sidebarToggleIcon');
  if (sc) {
    icon.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>';
  } else {
    icon.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>';
  }
}
$('#sidebarToggleBtn').onclick = async () => {
  const sc = await getMeta('sidebarCollapsed', false);
  await setMeta('sidebarCollapsed', !sc);
  await applyCollapseState();
};
$('#listCollapseBtn').onclick = async () => {
  await setMeta('listCollapsed', true);
  await applyCollapseState();
};
$('#listExpandBtn').onclick = async () => {
  await setMeta('listCollapsed', false);
  await applyCollapseState();
};
$('#exportBtn').onclick = () => $('#exportModal').hidden = false;
$$('.export-option').forEach(b => b.onclick = () => { $('#exportModal').hidden = true; exportData(b.dataset.export); });
$('#importBtn').onclick = () => { $('#importPreview').hidden = true; $('#importModal').hidden = false; };
$('#settingsBtn').onclick = openSettings;
$$('.layout-mode-opt').forEach(btn => {
  btn.onclick = () => setLayoutMode(btn.dataset.layoutMode);
});
$('#trashBtn').onclick = openTrash;
$('#newFolderBtn').onclick = () => {
  const n = prompt('Folder name');
  if (n && n.trim()) createFolder(n.trim());
};
$('#sortSelect').addEventListener('change', (e) => { state.sortBy = e.target.value; loadList(); });

// close any modal on backdrop or close btn
$$('.modal-backdrop').forEach(m => {
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.closest('[data-close-modal]')) {
      m.hidden = true;
    }
  });
});

// keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); createItem(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'e') { e.preventDefault(); $('#exportModal').hidden = false; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
    e.preventDefault();
    (async () => {
      const sc = await getMeta('sidebarCollapsed', false);
      await setMeta('sidebarCollapsed', !sc);
      await applyCollapseState();
    })();
  }
  if (e.key === 'Escape') {
    $$('.modal-backdrop').forEach(m => m.hidden = true);
    closeActionSheet();
    if (!$('#runMode').hidden) $('#runMode').hidden = true;
    if (state.selection.size > 0) clearSelection();
  }
});

/* ===========================================================
   INIT
   =========================================================== */
(async function init() {
  try {
    await db.open();
    await applyTheme();
    await loadLayoutMode();
    await applyCollapseState();
    initMobileScreen();
    await seedIfEmpty();
    await renderFolderTree();
    await loadList();
    await buildSearchIndex();
    await maybeAutoBackup();
    await updateBackupBanner();
    // rebuild index on any change (debounced)
    const refreshIndex = debounce(() => buildSearchIndex(), 1000);
    const oldPut = db.put.bind(db);
    db.put = async (...args) => { const r = await oldPut(...args); refreshIndex(); return r; };
  } catch (err) {
    console.error(err);
    alert('Failed to initialize ProcDocs: ' + err.message + '\n\nIndexedDB may be unavailable (private browsing?). The app cannot run.');
  }
})();

/* ---------- Service worker registration (PWA / offline) ---------- */
if ('serviceWorker' in navigator) {
  let refreshing = false;
  let updateToastShown = false;

  // When the controller changes (i.e. the new SW takes over), reload once.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  // Listen for messages from the service worker
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SW_UPDATED') {
      // The SW activated and claimed us — log it but don't reload
      // (the controllerchange handler does that)
      console.log('Service worker updated to', event.data.version);
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').then((reg) => {
      // Force the SW to check for updates every time the page becomes visible
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
      // Also check for updates every 30 minutes while open
      setInterval(() => reg.update(), 30 * 60 * 1000);

      // When a new SW is found, watch it
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller && !updateToastShown) {
            updateToastShown = true;
            // Show an action toast that lets user opt in to reload now
            showUpdateToast(newWorker);
          }
        });
      });
    }).catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

function showUpdateToast(newWorker) {
  const c = $('#toastContainer');
  const t = document.createElement('div');
  t.className = 'toast success';
  t.style.animation = 'toastIn 0.2s'; // don't auto-dismiss
  t.style.cursor = 'pointer';
  t.innerHTML = `<span>New version available</span> <strong style="margin-left:8px;text-decoration:underline">Tap to reload</strong>`;
  t.onclick = () => {
    if (newWorker) newWorker.postMessage({ type: 'SKIP_WAITING' });
    // The controllerchange handler will reload the page once the new SW takes over.
    // As a fallback in case the SW didn't activate, reload anyway after a short delay.
    setTimeout(() => window.location.reload(), 800);
  };
  c.appendChild(t);
}
