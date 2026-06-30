/**
 * KanbanFlow v2 - App Logic
 * - IndexedDB persistence (no localStorage)
 * - Custom in-app modal (no browser prompt())
 * - Custom tags (create/delete your own, pick from task dialog)
 * - Settings panel via hamburger menu
 */

'use strict';

/* ============================================================
   CONSTANTS
   ============================================================ */

const DB_NAME    = 'UserData';
const DB_VERSION = 1;
const STORE_NAME = 'appState';
const STATE_KEY  = 'state';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const NEON_COLORS = [
  { name: 'cyan',   value: '#00e5ff' },
  { name: 'purple', value: '#b87eff' },
  { name: 'pink',   value: '#ff4fcd' },
  { name: 'amber',  value: '#ffb547' },
  { name: 'mint',   value: '#00ffb3' },
  { name: 'blue',   value: '#4f9fff' },
  { name: 'red',    value: '#ff4f6f' },
  { name: 'indigo', value: '#7c6fff' },
];

const COL_ACCENT_COLORS = [
  '#00e5ff','#b87eff','#00ffb3','#ffb547',
  '#ff4fcd','#4f9fff','#7c6fff','#ff4f6f'
];

// Built-in tags (always present, can't delete)
const BUILTIN_TAGS = [
  { id: 'bug',      name: 'Bug',      color: '#ff4f6f', builtin: true },
  { id: 'feature',  name: 'Feature',  color: '#00e5ff', builtin: true },
  { id: 'design',   name: 'Design',   color: '#b87eff', builtin: true },
  { id: 'docs',     name: 'Docs',     color: '#ffb547', builtin: true },
  { id: 'infra',    name: 'Infra',    color: '#00ffb3', builtin: true },
  { id: 'ux',       name: 'UX',       color: '#ff4fcd', builtin: true },
  { id: 'research', name: 'Research', color: '#4f9fff', builtin: true },
  { id: 'review',   name: 'Review',   color: '#7c6fff', builtin: true },
];

/* ============================================================
   HELPERS
   ============================================================ */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function hexToRgba(hex, a = 1) {
  if (!hex) return `rgba(255,255,255,${a})`;
  const r = parseInt(hex.slice(1, 3), 16) || 255;
  const g = parseInt(hex.slice(3, 5), 16) || 255;
  const b = parseInt(hex.slice(5, 7), 16) || 255;
  return `rgba(${r},${g},${b},${a})`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

// Returns all tags (builtin + custom merged)
function getAllTags() {
  const custom = state.customTags || [];
  return [...BUILTIN_TAGS, ...custom];
}

/* ============================================================
   INDEXEDDB
   ============================================================ */

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = e => reject(e.target.error);
  });
}

function dbGet(key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbPut(key, value) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

/* ============================================================
   STATE
   ============================================================ */

const defaultState = () => ({
  projects: [],
  activeProjectId: null,
  activeBoardId: null,
  customTags: [],
  aiApiKey: '',
});

let state = defaultState();

async function loadState() {
  try {
    const saved = await dbGet(STATE_KEY);
    if (saved) state = { ...defaultState(), ...saved };
    if (!Array.isArray(state.customTags)) state.customTags = [];
    
    // Cleanup any corrupted empty projects that got stuck during the bug
    state.projects = state.projects.filter(p => p.boards && p.boards.length > 0);

    // Inject example project if entirely empty
    if (state.projects.length === 0) {
      if (typeof window !== 'undefined' && window.DEFAULT_PROJECT_DATA) {
        state = { ...defaultState(), ...window.DEFAULT_PROJECT_DATA };
      } else {
        const exampleProject = {
          id: "proj_example123",
          name: "Example Project",
          type: "short",
          boards: [{
            id: "board_example123",
            name: "Development Workflow",
            columns: [
              { id: "col_todo", name: "To Do", cards: [{ id: "card_1", title: "Setup Database", description: "Initialize Postgres.", labels: [], assignee: "", subtasks: [] }, { id: "card_2", title: "Design API", description: "Create swagger docs.", labels: [], assignee: "", subtasks: [] }] },
              { id: "col_inprog", name: "In Progress", cards: [{ id: "card_3", title: "User Authentication", description: "Implement JWT.", labels: [], assignee: "", subtasks: [] }] },
              { id: "col_done", name: "Done", cards: [] }
            ]
          }]
        };
        state.projects.push(exampleProject);
        state.activeProjectId = exampleProject.id;
        state.activeBoardId = exampleProject.boards[0].id;
      }
    } else {
      // Ensure active IDs are valid
      if (!state.projects.find(p => p.id === state.activeProjectId)) {
        state.activeProjectId = state.projects[0].id;
      }
      const p = getActiveProject();
      if (p && !p.boards.find(b => b.id === state.activeBoardId)) {
        state.activeBoardId = p.boards[0].id;
      }
    }
    save(); // Save the cleaned/seeded data
  } catch (e) {
    console.error('Failed to load state:', e);
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await dbPut(STATE_KEY, state);
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        showToast('Storage full! Delete some images to free up space.', 'error');
      }
    }
  }, 100); // debounce writes 100ms
}

/* ============================================================
   BOARD / COLUMN / CARD CREATORS
   ============================================================ */

function getActiveProject() {
  return state.projects.find(p => p.id === state.activeProjectId) || null;
}
function getActiveBoard() {
  const p = getActiveProject();
  if (!p) return null;
  return p.boards.find(b => b.id === state.activeBoardId) || null;
}

function createBoard(name) {
  const board = {
    id: uid(), name,
    columns: [
      createColumn('To Do', 0),
      createColumn('In Progress', 1),
      createColumn('Done', 2),
    ],
  };
  return board;
}

function createColumn(name, colorIndex) {
  return {
    id: uid(), name,
    color: COL_ACCENT_COLORS[colorIndex % COL_ACCENT_COLORS.length],
    cards: [],
  };
}

function createCard(title) {
  return {
    id: uid(), title, description: '',
    labels: [], color: null, links: [], images: [],
    createdAt: Date.now(),
    completed: false
  };
}

function findCard(board, cardId) {
  for (const col of board.columns) {
    const idx = col.cards.findIndex(c => c.id === cardId);
    if (idx !== -1) return { col, card: col.cards[idx], idx };
  }
  return null;
}

/* ============================================================
   DOM REFERENCES
   ============================================================ */

const $ = id => document.getElementById(id);

const sidebar             = $('sidebar');
const sidebarToggle       = $('sidebar-toggle');
const sidebarOpenToggle   = $('sidebar-open-toggle');
const mobileSidebarToggle = $('mobile-sidebar-toggle');
const hamburgerBtn        = $('hamburger-btn');
const settingsPanel       = $('settings-panel');
const settingsOverlay     = $('settings-overlay');
const settingsCloseBtn    = $('settings-close-btn');
const tagManagerList      = $('tag-manager-list');
const newTagName          = $('new-tag-name');
const newTagColorRow      = $('new-tag-color-row');
const addTagBtn           = $('add-tag-btn');
const storageInfo         = $('storage-info');
const clearAllDataBtn     = $('clear-all-data-btn');
const boardsList          = $('boards-list');
const addBoardBtn         = $('add-board-btn');
const aiBoardBtn          = $('ai-board-btn');
const emptyAddBoardBtn    = $('empty-add-board-btn');
const exportBtn           = $('export-btn');
const importFile          = $('import-file');
const boardTitleEl        = $('board-title');
const renameBoardBtn      = $('rename-board-btn');
const addColumnBtn        = $('add-column-btn');
const searchInput         = $('search-input');
const searchClear         = $('search-clear');
const labelFilterToggle   = $('label-filter-toggle');
const labelFilterWrap     = $('label-filter-wrap');
const labelFilterDropdown = $('label-filter-dropdown');
const boardArea           = $('board-area');
const dashboardArea       = $('dashboard-area');
const dashboardGrid       = $('dashboard-grid');
const backToDashboardBtn  = $('back-to-dashboard-btn');
const emptyState          = $('empty-state');

// Horizontal scroll for Kanban boards using mouse wheel
boardArea.addEventListener('wheel', (e) => {
  if (e.target.closest('.column-cards')) return; // Let columns scroll natively
  if (e.deltaY !== 0 && e.deltaX === 0) {
    e.preventDefault();
    boardArea.scrollLeft += e.deltaY;
  }
});

// Input modal
const inputModalOverlay   = $('input-modal-overlay');
const inputModalIcon      = $('input-modal-icon');
const inputModalTitle     = $('input-modal-title');
const inputModalSubtitle  = $('input-modal-subtitle');
const inputModalField     = $('input-modal-field');
const inputModalCancel    = $('input-modal-cancel');
const inputModalConfirm   = $('input-modal-confirm');

// Task dialog
const taskDialogOverlay   = $('task-dialog-overlay');
const dialogTaskTitle     = $('dialog-task-title-input');
const dialogColorBar      = $('dialog-color-bar');
const dialogCloseBtn      = $('dialog-close-btn');
const dialogTabs          = document.querySelectorAll('.dialog-tab');
const tabPanels           = document.querySelectorAll('.tab-panel');
const dialogDesc          = $('dialog-desc');
const labelPicker         = $('label-picker');
const cardColorPicker     = $('card-color-picker');
const linksList           = $('links-list');
const linkTitleInput      = $('link-title-input');
const linkUrlInput        = $('link-url-input');
const addLinkBtn          = $('add-link-btn');
const imagesGrid          = $('images-grid');
const imageUploadArea     = $('image-upload-area');
const imageFileInput      = $('image-file-input');
const imageUploadBtn      = $('image-upload-btn');
const imageNote           = $('image-note');
const deleteTaskBtn       = $('delete-task-btn');
const cancelTaskBtn       = $('cancel-task-btn');
const saveTaskBtn         = $('save-task-btn');

// Confirm
const confirmOverlay      = $('confirm-overlay');
const confirmTitle        = $('confirm-title');
const confirmMessage      = $('confirm-message');
const confirmCancelBtn    = $('confirm-cancel-btn');
const confirmOkBtn        = $('confirm-ok-btn');

// Lightbox
const lightboxOverlay     = $('lightbox-overlay');
const lightboxImg         = $('lightbox-img');
const lightboxClose       = $('lightbox-close');
const toastContainer      = $('toast-container');

// AI Integration
const aiApiKeyInput       = $('ai-api-key');
const saveAiKeyBtn        = $('save-ai-key-btn');
const aiModalOverlay      = $('ai-modal-overlay');
const aiPromptField       = $('ai-prompt-field');
const aiLongTermCheckbox  = $('ai-long-term-checkbox');
const aiModalApiKey       = $('ai-modal-api-key');
const aiModalCancel       = $('ai-modal-cancel');
const aiModalConfirm      = $('ai-modal-confirm');
const aiLoadingOverlay    = $('ai-loading-overlay');

/* ============================================================
   TOAST
   ============================================================ */

function showToast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, duration);
}

/* ============================================================
   CONFIRM DIALOG
   ============================================================ */

let confirmResolve = null;

function showConfirm(title, message) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmOverlay.style.display = 'flex';
  return new Promise(r => { confirmResolve = r; });
}

confirmCancelBtn.addEventListener('click', () => { confirmOverlay.style.display = 'none'; confirmResolve?.(false); });
confirmOkBtn.addEventListener('click',    () => { confirmOverlay.style.display = 'none'; confirmResolve?.(true); });
confirmOverlay.addEventListener('click', e => { if (e.target === confirmOverlay) { confirmOverlay.style.display = 'none'; confirmResolve?.(false); } });

/* ============================================================
   CUSTOM INPUT MODAL  (replaces all browser prompt() calls)
   ============================================================ */

let inputModalResolve = null;

/**
 * Show the custom input modal.
 * @param {object} opts
 * @param {string} opts.title       - modal heading
 * @param {string} [opts.subtitle]  - optional hint text
 * @param {string} [opts.placeholder]
 * @param {string} [opts.defaultValue]
 * @param {string} [opts.confirmLabel]  - button label, default "Create"
 * @param {string} [opts.iconType]  - 'board' | 'column'
 * @returns {Promise<string|null>}  - trimmed value or null if cancelled
 */
function showInputModal({ title, subtitle, placeholder = '', defaultValue = '', confirmLabel = 'Create', iconType = 'board' }) {
  // Build icon
  const iconSvg = iconType === 'column'
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="3" width="13" height="13" rx="2"/><path d="M5 7H2a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>`;

  inputModalIcon.innerHTML = iconSvg;
  inputModalIcon.className = `input-modal-icon ${iconType}`;
  inputModalTitle.textContent = title;
  if (subtitle) {
    inputModalSubtitle.textContent = subtitle;
    inputModalSubtitle.style.display = '';
  } else {
    inputModalSubtitle.style.display = 'none';
  }
  inputModalField.placeholder = placeholder;
  inputModalField.value = defaultValue;
  inputModalConfirm.textContent = confirmLabel;
  inputModalOverlay.style.display = 'flex';

  setTimeout(() => { inputModalField.focus(); inputModalField.select(); }, 50);

  return new Promise(resolve => { inputModalResolve = resolve; });
}

function closeInputModal(value = null) {
  inputModalOverlay.style.display = 'none';
  inputModalResolve?.(value);
  inputModalResolve = null;
}

inputModalCancel.addEventListener('click', () => closeInputModal(null));
inputModalOverlay.addEventListener('click', e => { if (e.target === inputModalOverlay) closeInputModal(null); });
inputModalConfirm.addEventListener('click', () => {
  const v = inputModalField.value.trim();
  if (!v) { inputModalField.focus(); inputModalField.classList.add('shake'); setTimeout(() => inputModalField.classList.remove('shake'), 400); return; }
  closeInputModal(v);
});
inputModalField.addEventListener('keydown', e => {
  if (e.key === 'Enter') inputModalConfirm.click();
  if (e.key === 'Escape') closeInputModal(null);
});

/* ============================================================
   LIGHTBOX
   ============================================================ */

function openLightbox(src) { lightboxImg.src = src; lightboxOverlay.style.display = 'flex'; }
lightboxClose.addEventListener('click', () => { lightboxOverlay.style.display = 'none'; });
lightboxOverlay.addEventListener('click', e => { if (e.target === lightboxOverlay) lightboxOverlay.style.display = 'none'; });

/* ============================================================
   SIDEBAR TOGGLE
   ============================================================ */

let sidebarCollapsed = false;

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  sidebar.classList.toggle('collapsed', sidebarCollapsed);
}
sidebarToggle.addEventListener('click', toggleSidebar);
mobileSidebarToggle?.addEventListener('click', toggleSidebar);
sidebarOpenToggle?.addEventListener('click', toggleSidebar);

/* ============================================================
   SETTINGS PANEL (hamburger)
   ============================================================ */

let settingsOpen = false;

hamburgerBtn.addEventListener('click', () => {
  settingsOpen = !settingsOpen;
  if (settingsOpen) {
    settingsPanel.style.display = 'flex';
    settingsOverlay.style.display = 'block';
    renderSettingsPanel();
  } else {
    closeSettings();
  }
  hamburgerBtn.style.color = settingsOpen ? 'var(--neon-cyan)' : '';
});

settingsCloseBtn.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);

function closeSettings() {
  settingsOpen = false;
  settingsPanel.style.display = 'none';
  settingsOverlay.style.display = 'none';
  hamburgerBtn.style.color = '';
}

/* ---- RENDER SETTINGS PANEL ---- */
function renderSettingsPanel() {
  renderTagManagerList();
  renderNewTagColorRow();
  renderStorageInfo();
  if (aiApiKeyInput) aiApiKeyInput.value = state.aiApiKey || '';
}

saveAiKeyBtn?.addEventListener('click', () => {
  state.aiApiKey = aiApiKeyInput.value.trim();
  save();
  showToast('AI API Key saved.', 'success');
});

clearAllDataBtn?.addEventListener('click', async () => {
  const ok = await showConfirm('Clear All Data', 'Are you sure you want to permanently delete ALL boards, tasks, and custom tags? This action cannot be undone.');
  if (!ok) return;
  state.projects = [];
  state.customTags = [];
  state.activeProjectId = null;
  state.activeBoardId = null;
  save();
  renderAll();
  closeSettings();
  showToast('All user data has been permanently deleted.', 'success');
});

/* ---- TAG MANAGER LIST ---- */
let selectedTagColor = NEON_COLORS[0].value;

function renderTagManagerList() {
  tagManagerList.innerHTML = '';
  const allTags = getAllTags();
  if (allTags.length === 0) {
    tagManagerList.innerHTML = `<div style="font-size:0.78rem;color:var(--text-muted);padding:6px 2px">No tags yet.</div>`;
    return;
  }
  allTags.forEach(tag => {
    const item = document.createElement('div');
    item.className = 'tag-manager-item';
    item.innerHTML = `
      <div class="tag-manager-dot" style="background:${tag.color};box-shadow:0 0 6px ${hexToRgba(tag.color,0.5)}"></div>
      <span class="tag-manager-name">${escHtml(tag.name)}</span>
      <span class="tag-manager-chip-preview" style="color:${tag.color};border-color:${tag.color};background:${hexToRgba(tag.color,0.12)}">${escHtml(tag.name)}</span>
      ${tag.builtin ? '' : `<button class="tag-manager-delete" data-id="${tag.id}" title="Delete tag">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`}
    `;
    if (!tag.builtin) {
      item.querySelector('.tag-manager-delete').addEventListener('click', async () => {
        const ok = await showConfirm('Delete Tag', `Delete the "${tag.name}" tag? It will be removed from all cards.`);
        if (!ok) return;
        // Remove from customTags
        state.customTags = state.customTags.filter(t => t.id !== tag.id);
        // Remove from all cards
        state.projects.forEach(p => p.boards.forEach(b => b.columns.forEach(col => col.cards.forEach(card => {
          card.labels = card.labels.filter(l => l !== tag.id);
        }))));
        save();
        renderTagManagerList();
        showToast(`Tag "${tag.name}" deleted.`, 'success');
      });
    }
    tagManagerList.appendChild(item);
  });
}

function renderNewTagColorRow() {
  newTagColorRow.innerHTML = '';
  NEON_COLORS.forEach(c => {
    const sw = document.createElement('button');
    sw.className = 'tag-color-swatch' + (selectedTagColor === c.value ? ' selected' : '');
    sw.style.background = c.value;
    sw.style.boxShadow = `0 0 6px ${hexToRgba(c.value, 0.4)}`;
    sw.title = c.name;
    sw.addEventListener('click', () => {
      selectedTagColor = c.value;
      renderNewTagColorRow();
    });
    newTagColorRow.appendChild(sw);
  });
}

addTagBtn.addEventListener('click', () => {
  const name = newTagName.value.trim();
  if (!name) { newTagName.focus(); return; }
  // Check duplicate
  if (getAllTags().find(t => t.name.toLowerCase() === name.toLowerCase())) {
    showToast('A tag with that name already exists.', 'warning'); return;
  }
  const tag = { id: uid(), name, color: selectedTagColor, builtin: false };
  state.customTags.push(tag);
  save();
  newTagName.value = '';
  renderTagManagerList();
  showToast(`Tag "${name}" created!`, 'success');
});

newTagName.addEventListener('keydown', e => { if (e.key === 'Enter') addTagBtn.click(); });

function renderStorageInfo() {
  const data = JSON.stringify(state);
  const bytes = new Blob([data]).size;
  storageInfo.innerHTML = `
    <div class="db-status">
      <div class="db-status-dot"></div>
      IndexedDB connected
    </div>
    <br/>
    <strong>Data size:</strong> ~${formatBytes(bytes)}<br/>
    <strong>Projects:</strong> ${state.projects.length}<br/>
    <strong>Custom tags:</strong> ${state.customTags.length}<br/>
    <strong>Total cards:</strong> ${state.projects.reduce((s, p) => s + p.boards.reduce((bs, b) => bs + b.columns.reduce((ss, c) => ss + c.cards.length, 0), 0), 0)}
  `;
}

/* ============================================================
   RENDER SIDEBAR & DASHBOARD
   ============================================================ */

function renderSidebar() {
  boardsList.innerHTML = '';
  state.projects.forEach(project => {
    const isActive = project.id === state.activeProjectId;
    const item = document.createElement('div');
    item.className = 'board-item' + (isActive ? ' active' : '');
    item.dataset.id = project.id;
    let totalTasks = 0;
    project.boards.forEach(b => b.columns.forEach(c => totalTasks += c.cards.length));

    item.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
        <svg class="board-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
          <rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/>
          <rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>
        </svg>
        <div style="display:flex; flex-direction:column; min-width:0; overflow:hidden;">
          <span class="board-item-name" style="margin-bottom:2px;" title="${escHtml(project.name)}">${escHtml(project.name)}</span>
          <span style="font-size:0.65rem; color:var(--text-muted); line-height:1;">${totalTasks} task(s)</span>
        </div>
      </div>
      <div class="board-item-actions">
        <button class="board-action-btn rename" title="Rename" data-id="${project.id}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="board-action-btn delete" title="Delete" data-id="${project.id}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    `;
    item.addEventListener('click', e => { if (!e.target.closest('.board-action-btn')) switchProject(project.id); });
    item.querySelector('.board-action-btn.rename').addEventListener('click', async e => {
      e.stopPropagation();
      const newName = await showInputModal({ title: 'Rename Project', placeholder: 'Project nameâ€¦', defaultValue: project.name, confirmLabel: 'Rename', iconType: 'board' });
      if (!newName) return;
      project.name = newName;
      save();
      renderSidebar();
      if (isActive) updateBoardTitle();
    });
    item.querySelector('.board-action-btn.delete').addEventListener('click', async e => {
      e.stopPropagation();
      const ok = await showConfirm('Delete Project', `Delete "${project.name}" and all its boards? This cannot be undone.`);
      if (!ok) return;
      state.projects = state.projects.filter(p => p.id !== project.id);
      if (state.activeProjectId === project.id) {
        state.activeProjectId = state.projects[0]?.id || null;
        state.activeBoardId = null;
        if (state.projects[0] && state.projects[0].type === 'short') {
          state.activeBoardId = state.projects[0].boards[0].id;
        }
      }
      save();
      renderAll();
      showToast('Project deleted.', 'success');
    });
    boardsList.appendChild(item);
  });
}

function renderDashboard() {
  const project = getActiveProject();
  if (!project || project.type !== 'long') return;
  dashboardGrid.innerHTML = '';
  
  project.boards.forEach(board => {
    let totalTasks = 0;
    let completedTasks = 0;
    board.columns.forEach(col => {
      totalTasks += col.cards.length;
      completedTasks += col.cards.filter(c => c.completed).length;
    });
    const percent = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

    const card = document.createElement('div');
    card.className = 'dashboard-card';
    card.innerHTML = `
      <div class="dashboard-card-title">${escHtml(board.name)}</div>
      <div class="dashboard-card-meta">${totalTasks} task(s)</div>
      <div class="dashboard-progress">
        <div class="dashboard-progress-fill" style="width: ${percent}%"></div>
      </div>
    `;
    card.addEventListener('click', () => {
      state.activeBoardId = board.id;
      save();
      renderAll();
    });
    dashboardGrid.appendChild(card);
  });

  const addCard = document.createElement('div');
  addCard.className = 'dashboard-card';
  addCard.style.display = 'flex';
  addCard.style.alignItems = 'center';
  addCard.style.justifyContent = 'center';
  addCard.style.borderStyle = 'dashed';
  addCard.style.background = 'transparent';
  addCard.style.cursor = 'pointer';
  addCard.innerHTML = `
    <div style="text-align:center; color:var(--text-secondary);">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom:8px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <div>Add Board</div>
    </div>
  `;
  addCard.addEventListener('click', async () => {
    const name = await showInputModal({
      title: 'New Board',
      subtitle: 'Add a new board to this project.',
      placeholder: 'e.g. Phase 2',
      confirmLabel: 'Create Board',
      iconType: 'board',
    });
    if (!name) return;
    const b = createBoard(name);
    project.boards.push(b);
    save();
    renderAll();
    showToast(`Board "${b.name}" created!`, 'success');
  });
  dashboardGrid.appendChild(addCard);

}

/* ============================================================
   ADD PROJECT
   ============================================================ */

async function promptNewProject() {
  const name = await showInputModal({
    title: 'New Project Dashboard',
    subtitle: 'Give your project a name to get started.',
    placeholder: 'e.g. Product Roadmap',
    confirmLabel: 'Create Project',
    iconType: 'board',
  });
  if (!name) return;
  const proj = { id: uid(), name, type: 'long', boards: [] };
  state.projects.push(proj);
  save();
  switchProject(proj.id);
  showToast(`Project "${proj.name}" created!`, 'success');
}

async function promptNewBoard() {
  const name = await showInputModal({
    title: 'New Standalone Board',
    subtitle: 'Give your board a name to get started.',
    placeholder: 'e.g. Weekly Tasks',
    confirmLabel: 'Create Board',
    iconType: 'board',
  });
  if (!name) return;
  const proj = { id: uid(), name, type: 'short', boards: [createBoard('Main Board')] };
  state.projects.push(proj);
  save();
  switchProject(proj.id);
  showToast(`Board "${proj.name}" created!`, 'success');
}

const addProjectBtn = $('add-project-btn');
if (addProjectBtn) addProjectBtn.addEventListener('click', promptNewProject);
if (addBoardBtn) addBoardBtn.addEventListener('click', promptNewBoard);
if (emptyAddBoardBtn) emptyAddBoardBtn.addEventListener('click', promptNewBoard);

/* ============================================================
   SWITCH PROJECT / BOARD
   ============================================================ */

function switchProject(id) {
  state.activeProjectId = id;
  const project = state.projects.find(p => p.id === id);
  if (project) {
    if (project.type === 'short') {
      state.activeBoardId = project.boards[0].id;
    } else {
      state.activeBoardId = null; // show dashboard
    }
  }
  save();
  renderAll();
  clearFilters();
  if (window.innerWidth <= 700) { sidebarCollapsed = true; sidebar.classList.add('collapsed'); }
}

backToDashboardBtn.addEventListener('click', () => {
  const p = getActiveProject();
  if (p && p.type === 'long') {
    state.activeBoardId = null;
    save();
    renderAll();
  }
});

/* ============================================================
   RENAME BOARD (topbar title inline)
   ============================================================ */

renameBoardBtn.addEventListener('click', () => {
  const board = getActiveBoard();
  if (!board) return;
  boardTitleEl.contentEditable = 'true';
  boardTitleEl.focus();
  const range = document.createRange();
  range.selectNodeContents(boardTitleEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
});

boardTitleEl.addEventListener('blur', () => {
  const board = getActiveBoard();
  if (!board || boardTitleEl.contentEditable !== 'true') return;
  const newName = boardTitleEl.textContent.trim() || board.name;
  board.name = newName;
  boardTitleEl.contentEditable = 'false';
  boardTitleEl.textContent = newName.toUpperCase();
  save();
  renderSidebar();
});

boardTitleEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); boardTitleEl.blur(); }
  if (e.key === 'Escape') {
    const board = getActiveBoard();
    boardTitleEl.textContent = board?.name.toUpperCase() || '';
    boardTitleEl.contentEditable = 'false';
    boardTitleEl.blur();
  }
});

function updateBoardTitle() {
  const project = getActiveProject();
  const board = getActiveBoard();

  if (!project) {
    boardTitleEl.textContent = 'SELECT A PROJECT';
    renameBoardBtn.style.display = 'none';
    addColumnBtn.style.display = 'none';
    labelFilterWrap.style.display = 'none';
    backToDashboardBtn.style.display = 'none';
    return;
  }

  if (board) {
    boardTitleEl.textContent = board.name.toUpperCase();
    renameBoardBtn.style.display = '';
    addColumnBtn.style.display = '';
    labelFilterWrap.style.display = '';
    if (project.type === 'long') {
      backToDashboardBtn.style.display = '';
    } else {
      backToDashboardBtn.style.display = 'none';
    }
  } else if (project.type === 'long') {
    boardTitleEl.textContent = project.name.toUpperCase() + ' (DASHBOARD)';
    renameBoardBtn.style.display = 'none';
    addColumnBtn.style.display = 'none';
    labelFilterWrap.style.display = 'none';
    backToDashboardBtn.style.display = 'none';
  }
}

/* ============================================================
   ADD COLUMN
   ============================================================ */

addColumnBtn.addEventListener('click', async () => {
  const board = getActiveBoard();
  if (!board) return;
  const name = await showInputModal({
    title: 'New Column',
    subtitle: 'Add a column to organise your cards.',
    placeholder: 'e.g. In Review',
    confirmLabel: 'Add Column',
    iconType: 'column',
  });
  if (!name) return;
  const col = createColumn(name, board.columns.length);
  board.columns.push(col);
  save();
  renderBoard();
  showToast(`Column "${col.name}" added.`, 'success');
});

/* ============================================================
   SEARCH & FILTER
   ============================================================ */

let searchQuery  = '';
let activeLabels = new Set();

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  searchClear.style.display = searchQuery ? 'flex' : 'none';
  applyFilters();
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  searchClear.style.display = 'none';
  applyFilters();
});

let labelFilterOpen = false;
labelFilterToggle.addEventListener('click', () => {
  labelFilterOpen = !labelFilterOpen;
  labelFilterDropdown.style.display = labelFilterOpen ? 'flex' : 'none';
  labelFilterToggle.classList.toggle('active', labelFilterOpen);
  if (labelFilterOpen) renderLabelFilterDropdown();
});

document.addEventListener('click', e => {
  if (labelFilterOpen && !e.target.closest('#label-filter-wrap') && !e.target.closest('#label-filter-dropdown')) {
    labelFilterOpen = false;
    labelFilterDropdown.style.display = 'none';
    labelFilterToggle.classList.remove('active');
  }
});

function renderLabelFilterDropdown() {
  labelFilterDropdown.innerHTML = '';
  getAllTags().forEach(def => {
    const chip = document.createElement('button');
    chip.className = 'label-chip label-toggle' + (activeLabels.has(def.id) ? ' selected' : '');
    chip.style.color = def.color;
    chip.style.borderColor = def.color;
    if (activeLabels.has(def.id)) chip.style.background = hexToRgba(def.color, 0.15);
    chip.textContent = def.name;
    chip.addEventListener('click', () => {
      if (activeLabels.has(def.id)) activeLabels.delete(def.id);
      else activeLabels.add(def.id);
      renderLabelFilterDropdown();
      applyFilters();
    });
    labelFilterDropdown.appendChild(chip);
  });
  if (activeLabels.size > 0) {
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn-ghost btn-sm';
    clearBtn.style.marginLeft = 'auto';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => { activeLabels.clear(); renderLabelFilterDropdown(); applyFilters(); });
    labelFilterDropdown.appendChild(clearBtn);
  }
}

function applyFilters() {
  const hasFilter = searchQuery || activeLabels.size > 0;
  boardArea.querySelectorAll('.task-card').forEach(cardEl => {
    const board = getActiveBoard();
    if (!board) return;
    const found = findCard(board, cardEl.dataset.id);
    if (!found) return;
    const { card } = found;
    let visible = true;
    if (searchQuery) visible = (card.title + ' ' + card.description).toLowerCase().includes(searchQuery);
    if (activeLabels.size > 0) visible = visible && [...activeLabels].some(l => card.labels.includes(l));
    cardEl.classList.toggle('filtered-hidden', !visible);
  });
  const board = getActiveBoard();
  if (!board) return;
  board.columns.forEach(col => {
    const colEl = boardArea.querySelector(`.column[data-id="${col.id}"]`);
    if (!colEl) return;
    const countEl = colEl.querySelector('.column-count');
    if (!countEl) return;
    const visible = colEl.querySelectorAll('.task-card:not(.filtered-hidden)').length;
    countEl.textContent = hasFilter ? `${visible}/${col.cards.length}` : col.cards.length;
  });
}

function clearFilters() {
  searchQuery = '';
  activeLabels.clear();
  searchInput.value = '';
  searchClear.style.display = 'none';
}

/* ============================================================
   RENDER ALL
   ============================================================ */

function renderAll() {
  renderSidebar();
  updateBoardTitle();
  const p = getActiveProject();
  const b = getActiveBoard();
  
  if (p && !b) {
    // Show Dashboard
    dashboardArea.style.display = 'block';
    boardArea.style.display = 'none';
    renderDashboard();
  } else {
    // Show Board
    dashboardArea.style.display = 'none';
    boardArea.style.display = 'flex';
    renderBoard();
  }
  
  renderProjectProgress();
}

function renderProjectProgress() {
  const project = getActiveProject();
  const progressContainer = document.getElementById('board-top-progress-container');
  if (!progressContainer) return;

  if (project && project.type === 'long') {
    let totalTasks = 0;
    let completedTasks = 0;
    project.boards.forEach(board => {
      board.columns.forEach(col => {
        totalTasks += col.cards.length;
        completedTasks += col.cards.filter(c => c.completed).length;
      });
    });
    const percent = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
    progressContainer.innerHTML = `
      <div class="board-top-progress" style="margin-bottom: 20px; padding: 0 20px; max-width: 800px; margin-left: auto; margin-right: auto; width: 100%;">
        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 6px;">
          <span>Overall Project Progress</span>
          <span>${percent}% (${completedTasks}/${totalTasks} Tasks)</span>
        </div>
        <div class="dashboard-progress" style="height: 6px;">
          <div class="dashboard-progress-fill" style="width: ${percent}%;"></div>
        </div>
      </div>
    `;
    progressContainer.style.display = 'block';
  } else {
    progressContainer.style.display = 'none';
    progressContainer.innerHTML = '';
  }
}

/* ============================================================
   RENDER BOARD
   ============================================================ */

let sortableInstances = [];

function renderBoard() {
  sortableInstances.forEach(s => s.destroy());
  sortableInstances = [];
  boardArea.innerHTML = '';

  const board = getActiveBoard();
  if (!board) {
    boardArea.appendChild(emptyState);
    emptyState.style.display = '';
    return;
  }
  emptyState.style.display = 'none';

  board.columns.forEach((col, colIndex) => {
    const colEl = buildColumnEl(board, col, colIndex);
    boardArea.appendChild(colEl);

    const cardsContainer = colEl.querySelector('.column-cards');
    sortableInstances.push(Sortable.create(cardsContainer, {
      group: 'cards', animation: 150,
      ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', dragClass: 'sortable-drag',
      delay: 50, delayOnTouchOnly: true,
      onEnd(evt) {
        const b = getActiveBoard();
        if (!b) return;
        const fromColId = evt.from.closest('.column')?.dataset.id;
        const toColId   = evt.to.closest('.column')?.dataset.id;
        const fromCol   = b.columns.find(c => c.id === fromColId);
        const toCol     = b.columns.find(c => c.id === toColId);
        if (!fromCol || !toCol) return;
        const cardIdx = fromCol.cards.findIndex(c => c.id === evt.item.dataset.id);
        if (cardIdx === -1) return;
        const [card] = fromCol.cards.splice(cardIdx, 1);
        toCol.cards.splice(evt.newIndex, 0, card);
        save();
        updateColumnCounts();
        applyFilters();
      }
    }));
  });

  sortableInstances.push(Sortable.create(boardArea, {
    animation: 200, handle: '.column-header', ghostClass: 'sortable-ghost',
    onEnd() {
      const b = getActiveBoard();
      if (!b) return;
      const newOrder = [...boardArea.querySelectorAll('.column[data-id]')].map(el => el.dataset.id);
      b.columns = newOrder.map(id => b.columns.find(c => c.id === id)).filter(Boolean);
      save();
    }
  }));
  applyFilters();

}

/* ============================================================
   BUILD COLUMN ELEMENT
   ============================================================ */

function buildColumnEl(board, col) {
  const colEl = document.createElement('div');
  colEl.className = 'column';
  colEl.dataset.id = col.id;

  colEl.innerHTML = `
    <div class="column-accent" style="background:${col.color};box-shadow:0 0 8px ${hexToRgba(col.color,0.4)}"></div>
    <div class="column-header">
      <div class="column-title-wrap">
        <span class="column-title" style="color:${col.color}" contenteditable="false">${escHtml(col.name)}</span>
        <span class="column-count">${col.cards.length}</span>
      </div>
      <div class="column-actions">
        <button class="icon-btn col-color-btn" title="Color">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/></svg>
        </button>
        <button class="icon-btn col-rename-btn" title="Rename">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn col-delete-btn" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>
    <div class="column-cards" data-col-id="${col.id}"></div>
    <div class="column-footer">
      <button class="add-card-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add card
      </button>
    </div>
  `;

  const cardsContainer = colEl.querySelector('.column-cards');
  col.cards.forEach(card => cardsContainer.appendChild(buildCardEl(card)));

  // Rename column
  const titleEl = colEl.querySelector('.column-title');
  colEl.querySelector('.col-rename-btn').addEventListener('click', () => startRenameColumn(board, col, titleEl));
  titleEl.addEventListener('dblclick', () => startRenameColumn(board, col, titleEl));

  // Color picker
  colEl.querySelector('.col-color-btn').addEventListener('click', e => showColumnColorPicker(e, board, col, colEl));

  // Delete column
  colEl.querySelector('.col-delete-btn').addEventListener('click', async () => {
    const ok = await showConfirm('Delete Column', `Delete "${col.name}" and all ${col.cards.length} card(s)?`);
    if (!ok) return;
    board.columns = board.columns.filter(c => c.id !== col.id);
    save();
    renderBoard();
    showToast('Column deleted.', 'success');
  });

  // Add card
  colEl.querySelector('.add-card-btn').addEventListener('click', () => showQuickAdd(colEl, board, col));

  return colEl;
}

function updateColumnCounts() {
  const board = getActiveBoard();
  if (!board) return;
  board.columns.forEach(col => {
    const el = boardArea.querySelector(`.column[data-id="${col.id}"] .column-count`);
    if (el) el.textContent = col.cards.length;
  });
}

/* ============================================================
   COLUMN RENAME
   ============================================================ */

function startRenameColumn(board, col, titleEl) {
  const oldName = col.name;
  titleEl.contentEditable = 'true';
  titleEl.focus();
  const range = document.createRange();
  range.selectNodeContents(titleEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  function done() {
    titleEl.contentEditable = 'false';
    const newName = titleEl.textContent.trim() || oldName;
    col.name = newName;
    titleEl.textContent = newName;
    save();
  }
  titleEl.addEventListener('blur', done, { once: true });
  titleEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
    if (e.key === 'Escape') { titleEl.textContent = oldName; titleEl.blur(); }
  });
}

/* ============================================================
   COLUMN COLOR PICKER
   ============================================================ */

let colColorPickerEl = null;

function showColumnColorPicker(event, board, col, colEl) {
  removeColumnColorPicker();
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  colColorPickerEl = document.createElement('div');
  colColorPickerEl.className = 'label-filter-dropdown';
  colColorPickerEl.style.cssText = `position:fixed;top:${rect.bottom+6}px;left:${rect.left}px;z-index:500;flex-direction:row;flex-wrap:wrap;gap:8px;padding:10px;min-width:auto;display:flex;`;
  COL_ACCENT_COLORS.forEach(c => {
    const sw = document.createElement('button');
    sw.style.cssText = `width:22px;height:22px;border-radius:50%;background:${c};border:2px solid ${c===col.color?'white':'transparent'};cursor:pointer;transition:transform 0.1s;box-shadow:0 0 7px ${hexToRgba(c,0.5)};`;
    sw.addEventListener('mouseenter', () => sw.style.transform='scale(1.2)');
    sw.addEventListener('mouseleave', () => sw.style.transform='');
    sw.addEventListener('click', () => {
      col.color = c;
      save();
      colEl.querySelector('.column-accent').style.cssText = `background:${c};box-shadow:0 0 8px ${hexToRgba(c,0.4)}`;
      colEl.querySelector('.column-title').style.color = c;
      removeColumnColorPicker();
    });
    colColorPickerEl.appendChild(sw);
  });
  document.body.appendChild(colColorPickerEl);
  setTimeout(() => document.addEventListener('click', removeColumnColorPicker, { once: true }), 0);
}

function removeColumnColorPicker() { colColorPickerEl?.remove(); colColorPickerEl = null; }

/* ============================================================
   QUICK ADD CARD
   ============================================================ */

let activeQuickAdd = null;

function showQuickAdd(colEl, board, col) {
  if (activeQuickAdd) activeQuickAdd.remove();
  const wrap = document.createElement('div');
  wrap.className = 'quick-add-wrap';
  wrap.innerHTML = `
    <textarea class="quick-add-input" placeholder="Card titleâ€¦ (Enter to add)" rows="2" maxlength="200"></textarea>
    <div class="quick-add-actions">
      <button class="btn-primary btn-sm">Add</button>
      <button class="btn-ghost btn-sm">Cancel</button>
    </div>
  `;
  const cardsEl = colEl.querySelector('.column-cards');
  colEl.insertBefore(wrap, colEl.querySelector('.column-footer'));
  activeQuickAdd = wrap;
  const textarea = wrap.querySelector('.quick-add-input');
  textarea.focus();
  function doAdd() {
    const title = textarea.value.trim();
    if (title) {
      const card = createCard(title);
      col.cards.push(card);
      save();
      cardsEl.appendChild(buildCardEl(card));
      updateColumnCounts();
      applyFilters();
    }
    wrap.remove(); activeQuickAdd = null;
  }
  function doCancel() { wrap.remove(); activeQuickAdd = null; }
  const [addBtn, cancelBtn] = wrap.querySelectorAll('button');
  addBtn.addEventListener('click', doAdd);
  cancelBtn.addEventListener('click', doCancel);
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAdd(); }
    if (e.key === 'Escape') doCancel();
  });
}

/* ============================================================
   BUILD CARD ELEMENT
   ============================================================ */

function buildCardEl(card) {
  const cardEl = document.createElement('div');
  
  cardEl.className = 'task-card';
  if (card.completed) {
    cardEl.classList.add('task-card-completed');
  }
  cardEl.dataset.id = card.id;

  if (card.color) {
    cardEl.style.borderLeft = `3px solid ${card.color}`;
  }

  const tags = getAllTags();
  
  const tagsHtml = card.labels?.length
    ? card.labels.map(lId => {
        const def = tags.find(t => t.id === lId);
        if (!def) return '';
        return `<span class="label-chip" style="color:${def.color};border-color:${def.color};background:${hexToRgba(def.color,0.12)}">${escHtml(def.name)}</span>`;
      }).join('')
    : '';

  const doneBtnHtml = `
    <button class="task-done-btn ${card.completed ? 'completed' : ''}" title="Mark as Done">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
    </button>
  `;

  const headerHtml = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
      <div class="task-card-labels" style="flex:1;">${tagsHtml}</div>
      <div style="display:flex; gap:6px; align-items:center;">
        ${doneBtnHtml}
      </div>
    </div>
  `;

  const imageHtml = card.images?.length
    ? `<img class="task-card-image" src="${card.images[0]}" alt="Attachment" loading="lazy" />`
    : '';

  const metaItems = [];
  if (card.links?.length)    metaItems.push(`<span class="task-card-meta-item"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>${card.links.length}</span>`);
  if (card.images?.length>1) metaItems.push(`<span class="task-card-meta-item"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>${card.images.length}</span>`);

  cardEl.innerHTML = `
    ${card.color ? `<div class="task-card-accent" style="background:${card.color};box-shadow:0 0 6px ${hexToRgba(card.color,0.5)}"></div>` : ''}
    <div class="task-card-content">
      ${imageHtml}
      ${headerHtml}
      <div class="task-card-title">${escHtml(card.title)}</div>
      ${card.description ? `<div class="task-card-desc">${escHtml(card.description)}</div>` : ''}
    </div>
    ${metaItems.length ? `<div class="task-card-footer"><div class="task-card-meta">${metaItems.join('')}</div></div>` : ''}
  `;
  let clickTimer = null;
  cardEl.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    
    if (e.detail === 1) {
      clickTimer = setTimeout(() => {
        openTaskDialog(card.id);
      }, 200);
    } else if (e.detail === 2) {
      clearTimeout(clickTimer);
      card.completed = !card.completed;
      save();
      renderBoard();
      renderProjectProgress();
    }
  });
  
  const doneBtn = cardEl.querySelector('.task-done-btn');
  if (doneBtn) {
    doneBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      card.completed = !card.completed;
      save();
      renderBoard();
      renderProjectProgress();
    });
  }
  
  return cardEl;
}

/* ============================================================
   TASK DIALOG
   ============================================================ */

let dialogCardId = null;
let dialogDraft  = null;

function openTaskDialog(cardId) {
  const board = getActiveBoard();
  if (!board) return;
  const found = findCard(board, cardId);
  if (!found) return;
  const { card } = found;
  dialogCardId = cardId;
  dialogDraft  = JSON.parse(JSON.stringify(card));

  dialogTaskTitle.value = card.title;
  dialogColorBar.style.background = card.color || 'transparent';
  dialogDesc.value = card.description || '';

  renderDialogLabelPicker();
  renderDialogColorPicker();
  renderDialogLinks();
  renderDialogImages();
  switchDialogTab('details');
  taskDialogOverlay.style.display = 'flex';
  setTimeout(() => dialogTaskTitle.focus(), 50);
}

function closeTaskDialog() {
  taskDialogOverlay.style.display = 'none';
  dialogCardId = null;
  dialogDraft  = null;
}

dialogCloseBtn.addEventListener('click', closeTaskDialog);
cancelTaskBtn.addEventListener('click', closeTaskDialog);
taskDialogOverlay.addEventListener('click', e => { if (e.target === taskDialogOverlay) closeTaskDialog(); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (lightboxOverlay.style.display !== 'none')    { lightboxOverlay.style.display = 'none'; return; }
    if (inputModalOverlay.style.display !== 'none')  { closeInputModal(null); return; }
    if (taskDialogOverlay.style.display !== 'none')  { closeTaskDialog(); return; }
    if (confirmOverlay.style.display !== 'none')     { confirmOverlay.style.display = 'none'; confirmResolve?.(false); return; }
  }
});

/* ---- Tabs ---- */
function switchDialogTab(tabId) {
  dialogTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  tabPanels.forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
}
dialogTabs.forEach(tab => tab.addEventListener('click', () => switchDialogTab(tab.dataset.tab)));

dialogTaskTitle.addEventListener('input', () => { if (dialogDraft) dialogDraft.title = dialogTaskTitle.value; });
dialogDesc.addEventListener('input',      () => { if (dialogDraft) dialogDraft.description = dialogDesc.value; });

/* ---- Label picker (uses ALL tags incl. custom) ---- */
function renderDialogLabelPicker() {
  labelPicker.innerHTML = '';
  getAllTags().forEach(def => {
    const btn = document.createElement('button');
    const selected = dialogDraft.labels.includes(def.id);
    btn.className = 'label-toggle' + (selected ? ' selected' : '');
    btn.style.color = def.color;
    btn.style.borderColor = def.color;
    if (selected) btn.style.background = hexToRgba(def.color, 0.12);
    btn.innerHTML = `${selected ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ''} ${escHtml(def.name)}`;
    btn.addEventListener('click', () => {
      const idx = dialogDraft.labels.indexOf(def.id);
      if (idx !== -1) dialogDraft.labels.splice(idx, 1);
      else dialogDraft.labels.push(def.id);
      renderDialogLabelPicker();
    });
    labelPicker.appendChild(btn);
  });
}

/* ---- Color picker ---- */
function renderDialogColorPicker() {
  cardColorPicker.innerHTML = '';
  // "none" swatch
  const none = document.createElement('button');
  none.className = 'color-swatch' + (!dialogDraft.color ? ' selected' : '');
  none.style.cssText = 'background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.2)';
  none.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  none.title = 'No color';
  none.addEventListener('click', () => { dialogDraft.color = null; dialogColorBar.style.background = 'transparent'; renderDialogColorPicker(); });
  cardColorPicker.appendChild(none);
  NEON_COLORS.forEach(c => {
    const sw = document.createElement('button');
    sw.className = 'color-swatch' + (dialogDraft.color === c.value ? ' selected' : '');
    sw.style.background = c.value;
    sw.style.boxShadow = `0 0 8px ${hexToRgba(c.value, 0.4)}`;
    sw.title = c.name;
    sw.addEventListener('click', () => { dialogDraft.color = c.value; dialogColorBar.style.background = c.value; renderDialogColorPicker(); });
    cardColorPicker.appendChild(sw);
  });
}

/* ---- Links ---- */
function renderDialogLinks() {
  linksList.innerHTML = '';
  (dialogDraft.links || []).forEach((link, idx) => {
    const item = document.createElement('div');
    item.className = 'link-item';
    item.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-muted);flex-shrink:0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      <div class="link-item-info">
        <a class="link-item-title" href="${escHtml(link.url)}" target="_blank" rel="noopener">${escHtml(link.title||link.url)}</a>
        <span class="link-item-url">${escHtml(link.url)}</span>
      </div>
      <button class="link-item-delete" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    `;
    item.querySelector('.link-item-delete').addEventListener('click', () => { dialogDraft.links.splice(idx, 1); renderDialogLinks(); });
    linksList.appendChild(item);
  });
}

addLinkBtn.addEventListener('click', () => {
  const url = linkUrlInput.value.trim();
  if (!url) { showToast('Enter a URL first.', 'warning'); return; }
  if (!dialogDraft.links) dialogDraft.links = [];
  dialogDraft.links.push({ title: linkTitleInput.value.trim() || url, url });
  linkTitleInput.value = '';
  linkUrlInput.value = '';
  renderDialogLinks();
});
linkUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') addLinkBtn.click(); });

/* ---- Images ---- */
function renderDialogImages() {
  imagesGrid.innerHTML = '';
  const totalBytes = (dialogDraft.images||[]).reduce((s,img) => s + img.length*0.75, 0);
  imageNote.textContent = dialogDraft.images?.length ? `${dialogDraft.images.length} image(s) ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ~${formatBytes(totalBytes)}` : '';
  (dialogDraft.images||[]).forEach((imgData, idx) => {
    const item = document.createElement('div');
    item.className = 'image-item';
    item.innerHTML = `
      <img src="${imgData}" alt="Attachment ${idx+1}" loading="lazy" />
      <div class="image-item-overlay">
        <button class="image-item-btn view"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h6v6M14 10l6.1-6.1M9 21H3v-6M10 14l-6.1 6.1"/></svg></button>
        <button class="image-item-btn delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    `;
    item.querySelector('.view').addEventListener('click', e => { e.stopPropagation(); openLightbox(imgData); });
    item.querySelector('.delete').addEventListener('click', e => { e.stopPropagation(); dialogDraft.images.splice(idx,1); renderDialogImages(); });
    item.querySelector('img').addEventListener('click', () => openLightbox(imgData));
    imagesGrid.appendChild(item);
  });
}

function processImageFiles(files) {
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_IMAGE_BYTES) showToast(`"${file.name}" is large (${formatBytes(file.size)}) ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â may use significant storage.`, 'warning', 5000);
    const reader = new FileReader();
    reader.onload = e => { if (!dialogDraft.images) dialogDraft.images=[]; dialogDraft.images.push(e.target.result); renderDialogImages(); };
    reader.readAsDataURL(file);
  });
}

imageUploadBtn.addEventListener('click', () => imageFileInput.click());
imageUploadArea.addEventListener('click', e => { if (e.target !== imageUploadBtn) imageFileInput.click(); });
imageFileInput.addEventListener('change', () => { processImageFiles(imageFileInput.files); imageFileInput.value=''; });
imageUploadArea.addEventListener('dragover', e => { e.preventDefault(); imageUploadArea.classList.add('drag-over'); });
imageUploadArea.addEventListener('dragleave', () => imageUploadArea.classList.remove('drag-over'));
imageUploadArea.addEventListener('drop', e => { e.preventDefault(); imageUploadArea.classList.remove('drag-over'); processImageFiles(e.dataTransfer.files); });

document.addEventListener('paste', e => {
  if (taskDialogOverlay.style.display === 'none') return;
  const imageItems = Array.from(e.clipboardData?.items||[]).filter(i => i.type.startsWith('image/'));
  if (imageItems.length) { switchDialogTab('images'); imageItems.forEach(i => processImageFiles([i.getAsFile()])); }
});

/* ---- Save & Delete ---- */
saveTaskBtn.addEventListener('click', () => {
  if (!dialogDraft) return;
  const title = dialogTaskTitle.value.trim();
  if (!title) { showToast('Title is required.', 'warning'); return; }
  dialogDraft.title = title;
  const board = getActiveBoard();
  if (!board) return;
  const found = findCard(board, dialogCardId);
  if (!found) return;
  Object.assign(found.card, dialogDraft);
  save();
  const cardEl = boardArea.querySelector(`.task-card[data-id="${dialogCardId}"]`);
  if (cardEl) cardEl.replaceWith(buildCardEl(found.card));
  applyFilters();
  updateColumnCounts();
  closeTaskDialog();
  showToast('Card saved!', 'success');
});

deleteTaskBtn.addEventListener('click', async () => {
  const ok = await showConfirm('Delete Card', 'Delete this card? This cannot be undone.');
  if (!ok) return;
  const board = getActiveBoard();
  if (!board) return;
  const found = findCard(board, dialogCardId);
  if (!found) return;
  found.col.cards.splice(found.idx, 1);
  save();
  boardArea.querySelector(`.task-card[data-id="${dialogCardId}"]`)?.remove();
  updateColumnCounts();
  applyFilters();
  closeTaskDialog();
  showToast('Card deleted.', 'success');
});

/* ============================================================
   EXPORT / IMPORT
   ============================================================ */

exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `kanbanflow-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported!', 'success');
});

importFile.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported.boards)) throw new Error('Invalid format');
    const ok = await showConfirm('Import Boards', `Merge ${imported.boards.length} board(s) into your current data?`);
    if (!ok) { importFile.value=''; return; }
    imported.boards.forEach(b => {
      b.id = uid();
      b.columns?.forEach(col => { col.id = uid(); col.cards?.forEach(card => { card.id = uid(); }); });
      state.projects.push({ id: uid(), name: b.name, type: 'short', boards: [b] });
    });
    // Merge custom tags too
    (imported.customTags||[]).forEach(tag => {
      if (!getAllTags().find(t => t.name.toLowerCase() === tag.name.toLowerCase())) {
        tag.id = uid();
        state.customTags.push(tag);
      }
    });
    save();
    renderAll();
    showToast(`Imported ${imported.boards.length} board(s)!`, 'success');
  } catch { showToast('Import failed ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â invalid JSON.', 'error'); }
  importFile.value = '';
});

/* ============================================================
   RESPONSIVE
   ============================================================ */

window.addEventListener('resize', debounce(() => {
  if (window.innerWidth > 700 && sidebarCollapsed) {
    sidebarCollapsed = false;
    sidebar.classList.remove('collapsed');
  }
}, 200));

/* ============================================================
   AI GENERATION
   ============================================================ */

aiBoardBtn.addEventListener('click', () => {
  aiPromptField.value = '';
  if (aiModalApiKey) aiModalApiKey.value = state.aiApiKey || '';
  aiModalOverlay.style.display = 'flex';
  setTimeout(() => aiPromptField.focus(), 50);
});

aiModalCancel.addEventListener('click', () => {
  aiModalOverlay.style.display = 'none';
});

aiModalOverlay.addEventListener('click', e => {
  if (e.target === aiModalOverlay) aiModalOverlay.style.display = 'none';
});

aiModalConfirm.addEventListener('click', () => {
  const prompt = aiPromptField.value.trim();
  const key = aiModalApiKey ? aiModalApiKey.value.trim() : state.aiApiKey;

  if (!key) {
    if (aiModalApiKey) {
      aiModalApiKey.focus();
      aiModalApiKey.classList.add('shake');
      setTimeout(() => aiModalApiKey.classList.remove('shake'), 400);
    }
    showToast('API Key is required to use AI', 'warning');
    return;
  }

  if (!prompt) {
    aiPromptField.focus();
    aiPromptField.classList.add('shake');
    setTimeout(() => aiPromptField.classList.remove('shake'), 400);
    return;
  }
  
  if (state.aiApiKey !== key) {
    state.aiApiKey = key;
    save();
    if (aiApiKeyInput) aiApiKeyInput.value = key;
  }

  aiModalOverlay.style.display = 'none';
  const isLongTerm = aiLongTermCheckbox ? aiLongTermCheckbox.checked : false;
  generateBoardWithAI(prompt, isLongTerm);
});

let isAIGenerating = false;
let aiAbortController = null;

const aiCancelGenBtn = document.getElementById('ai-cancel-generation-btn');
if (aiCancelGenBtn) {
  aiCancelGenBtn.addEventListener('click', () => {
    if (aiAbortController) aiAbortController.abort();
    isAIGenerating = false;
      stopAIAnimation();
      aiLoadingOverlay.style.display = 'none';
    showToast('AI Generation Cancelled.', 'info');
  });
}
const aiRetryCancelBtn = document.getElementById('ai-retry-cancel-btn');
if (aiRetryCancelBtn) {
  aiRetryCancelBtn.addEventListener('click', () => {
    if (aiAbortController) aiAbortController.abort();
    isAIGenerating = false;
    document.getElementById('ai-retry-widget').style.display = 'none';
    showToast('AI Retry Cancelled.', 'info');
  });
}

function syncStreamedData(parsedData, isLongTerm, targetBoardIndex = null) {
  let boardsData = isLongTerm && parsedData.boards ? parsedData.boards : [parsedData];
  const activeProj = getActiveProject();
  if (!activeProj) return;

  if (parsedData.projectName && activeProj.name !== parsedData.projectName) {
     activeProj.name = parsedData.projectName;
     renderSidebar();
     updateBoardTitle();
  }

  const customTagsObj = {}; 
  getAllTags().forEach(t => customTagsObj[t.name.toLowerCase()] = t);

  boardsData.forEach((boardData, bIdx) => {
    let actualIndex = targetBoardIndex !== null ? targetBoardIndex : bIdx;
    let board = activeProj.boards[actualIndex];
    
    if (!board) {
      board = createBoard(boardData.boardName || `Generating...`);
      board.columns = [];
      activeProj.boards.push(board);
      renderSidebar();
      if (!state.activeBoardId) {
        state.activeBoardId = board.id;
        renderAll();
      }
    } else if (boardData.boardName && board.name !== boardData.boardName) {
      board.name = boardData.boardName;
      renderSidebar();
      updateBoardTitle();
    }

    (boardData.columns || []).forEach((colData, cIdx) => {
      let col = board.columns.find(c => c.name === colData.name);
      if (!col && colData.name) {
        col = createColumn(colData.name, board.columns.length);
        board.columns.push(col);
        if (board.id === state.activeBoardId) {
           const colEl = buildColumnEl(board, col);
           colEl.style.animation = 'popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
           boardArea.appendChild(colEl);
        }
      }
      if (!col) return;

            (colData.tasks || []).forEach(taskData => {
        if (typeof taskData.title !== 'string' || taskData.title.trim().length === 0) return;
        
        let card = col.cards.find(c => c.title === taskData.title);
        
        const updateTags = (targetCard) => {
          let tagsToProcess = taskData.tags;
          if (!tagsToProcess || !Array.isArray(tagsToProcess) || tagsToProcess.length === 0) {
            if (targetCard.labels.length === 0) {
              tagsToProcess = [{ name: "Task", color: "#00e5ff" }];
            } else {
              tagsToProcess = [];
            }
          }
          
          tagsToProcess.forEach(tagData => {
            let tName = tagData.name?.trim();
            if(!tName) return;
            let tColor = tagData.color || NEON_COLORS[Math.floor(Math.random()*NEON_COLORS.length)].value;
            let existingTag = customTagsObj[tName.toLowerCase()];
            if (!existingTag) {
              existingTag = { id: uid(), name: tName, color: tColor, builtin: false };
              customTagsObj[tName.toLowerCase()] = existingTag;
              state.customTags.push(existingTag);
            }
            if (!targetCard.labels.includes(existingTag.id)) {
              targetCard.labels.push(existingTag.id);
            }
          });
        };

        if (!card) {
          card = createCard(taskData.title);
          card.description = taskData.description || '';
          updateTags(card);
          
          col.cards.push(card);
          if (board.id === state.activeBoardId) {
            const colEl = document.querySelector(`.column[data-id="${col.id}"]`);
            if (colEl) {
              const cardsContainer = colEl.querySelector('.column-cards');
              const cardEl = buildCardEl(card);
              cardEl.style.animation = 'slideDown 0.3s ease forwards';
              cardsContainer.appendChild(cardEl);
              const countEl = colEl.querySelector('.column-count');
              if (countEl) countEl.textContent = col.cards.length;
            }
          }
        } else {
          let updated = false;
          if (taskData.description && card.description !== taskData.description) {
            card.description = taskData.description;
            updated = true;
          }
          
          const oldLabelsCount = card.labels.length;
          updateTags(card);
          if (card.labels.length !== oldLabelsCount) {
            updated = true;
          }

          if (updated && board.id === state.activeBoardId) {
            const existingCardEl = document.querySelector(`.task-card[data-id="${card.id}"]`);
            if (existingCardEl) {
              const newCardEl = buildCardEl(card);
              existingCardEl.replaceWith(newCardEl);
            }
          }
        }
      });
    });
  });
  save();
}



let aiTypingTimer, aiPhaseTimer;

function startAIAnimation() {
  const typedEl    = document.getElementById("typed");
  const progFill   = document.getElementById("prog-fill");
  const progLabel  = document.getElementById("prog-label");
  const progPct    = document.getElementById("prog-pct");
  const chipsRow   = document.getElementById("chips");
  const dots       = [0,1,2,3,4].map(i => document.getElementById("sd" + i));
  
  if (!typedEl) return;

  clearTimeout(aiTypingTimer);
  clearTimeout(aiPhaseTimer);
  if(chipsRow) chipsRow.innerHTML = "";
  
  const dashWords = [];
  state.projects.forEach(p => {
    if (p.name) dashWords.push(p.name);
    if (p.boards) p.boards.forEach(b => {
      if (b.name) dashWords.push(b.name);
    });
  });
  getAllTags().forEach(t => { if (t.name) dashWords.push(t.name); });
  
  const defaultWords = [
    "context retrieved", "reasoning complete", "draft ready", "review done", 
    "generating", "analyzing", "compiling", "fetching data", "synchronizing", 
    "parsing data", "structuring board", "applying tags", "processing"
  ];
  
  const originalWordPool = dashWords.length > 0 ? dashWords : defaultWords;
  let wordPool = [...originalWordPool];

  const aiPhases = [
    { text: "Reading your request",      pct: 10, label: "Parsing input…",    hasChip: false, step: 0 },
    { text: "Retrieving context",        pct: 28, label: "Gathering context…", hasChip: true,  step: 1 },
    { text: "Reasoning through ideas",   pct: 46, label: "Thinking…",          hasChip: true,  step: 2 },
    { text: "Drafting the response",     pct: 64, label: "Drafting…",          hasChip: true,  step: 3 },
    { text: "Polishing output",          pct: 82, label: "Polishing…",         hasChip: true,  step: 4 },
    { text: "Almost there…",             pct: 96, label: "Finalizing…",        hasChip: false, step: 4 },
  ];

  function typeText(text, cb) {
    clearTimeout(aiTypingTimer);
    if(typedEl) typedEl.textContent = "";
    let i = 0;
    (function step() {
      if(typedEl) typedEl.textContent = text.slice(0, ++i);
      if (i < text.length) aiTypingTimer = setTimeout(step, 36);
      else if (cb) cb();
    })();
  }

  function addChip(chipText) {
    if (!chipText || !chipsRow) return;
    const el = document.createElement("div");
    el.className = "chip";
    el.textContent = chipText;
    chipsRow.appendChild(el);
    if (chipsRow.children.length > 4) {
      chipsRow.removeChild(chipsRow.firstChild);
    }
  }

  function updateDots(active) {
    dots.forEach((d, i) => {
      if(!d) return;
      d.classList.remove("active", "done");
      if (i < active) d.classList.add("done");
      else if (i === active) d.classList.add("active");
    });
  }

  function runPhase(idx) {
    if (idx >= aiPhases.length) { 
      idx = 0; 
      // User specifically requested NO clearing of bubbles (indefinite accumulation)
      // if(chipsRow) chipsRow.innerHTML = ""; 
    }
    
    const p = aiPhases[idx];
    
    let chipText = null;
    if (p.hasChip) {
      if (!window.usedAIWords) window.usedAIWords = new Set();
      
      let availableLive = (window.liveAIWords || []).filter(w => !window.usedAIWords.has(w));
      let currentPool = availableLive.length > 0 ? availableLive : wordPool.filter(w => !window.usedAIWords.has(w));
      
      if (currentPool.length === 0) {
          window.usedAIWords.clear();
          currentPool = (window.liveAIWords && window.liveAIWords.length > 0) ? window.liveAIWords : originalWordPool;
      }
      
      const r = Math.floor(Math.random() * currentPool.length);
      const chosenWord = currentPool[r];
      window.usedAIWords.add(chosenWord);
      chipText = "✓ " + chosenWord;
    }
    
    typeText(p.text, () => addChip(chipText));
    
    if (progFill) progFill.style.width = p.pct + "%";
    if (progLabel) progLabel.textContent = p.label;
    if (progPct) progPct.textContent   = p.pct + "%";
    updateDots(p.step);
    
    const delay = idx === aiPhases.length - 1 ? 2200 : 1700 + Math.random() * 700;
    aiPhaseTimer = setTimeout(() => runPhase(idx + 1), delay);
  }

  runPhase(0);
}

function stopAIAnimation() {
  clearTimeout(aiTypingTimer);
  clearTimeout(aiPhaseTimer);
}

async function generateBoardWithAI(prompt, isLongTerm, attempt = 1) {
  if (attempt === 1) {
    if (isAIGenerating) {
      showToast('AI Generation already in progress...', 'warning');
      return;
    }
    isAIGenerating = true;
    window.liveAIWords = [];
    window.usedAIWords = new Set();
    aiLoadingOverlay.style.display = 'flex';
    
    startAIAnimation();
  } else {
    document.getElementById('ai-retry-widget').style.display = 'flex';
  }
  
  try {
    const modelsResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${state.aiApiKey}`);
    if (!modelsResp.ok) throw new Error('Invalid API Key or network error.');
    const modelsData = await modelsResp.json();
    const validModels = modelsData.models.filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"));
    if (validModels.length === 0) throw new Error('No supported models found.');
    let selectedModel = validModels.find(m => m.name.includes('flash')) || validModels.find(m => m.name.includes('pro')) || validModels[0];
    const modelName = selectedModel.name;

    let systemInstruction = "";
    if (isLongTerm) {
      systemInstruction = `You are a world-class expert project manager and domain specialist. Given a long-term task spanning weeks or months, you must generate a highly robust, factually accurate, and detailed sequential timeline broken down into weekly boards. Generate all boards fully and completely from start to finish in a single comprehensive output.
Do NOT provide generic or vague steps. Use actual methodologies, technical tools, specific metrics, and real-world strategies. Include daily recurring tasks where appropriate.
CRITICAL: You MUST assign at least one relevant tag to EVERY task. Provide a factual and informative description (1-2 sentences) outlining the specific actions required.
Return ONLY raw JSON without markdown formatting or code blocks.
Schema:
{ "projectName": "string (Catchy 3-word title)", "boards": [ { "boardName": "string (e.g. 'Week 1: Fundamentals')", "columns": [ { "name": "string (e.g. 'Day 1')", "tasks": [ { "title": "string", "description": "string (1-2 informative sentences)", "tags": [ { "name": "string (REQUIRED)", "color": "#hex" } ] } ] } ] } ] }

Task: ` + prompt;
    } else {
      systemInstruction = `You are a world-class expert project manager and domain specialist. Given a task, you must generate a highly robust, factually accurate, and detailed Kanban board.
Do NOT provide generic or vague steps. Use actual methodologies, technical tools, specific metrics, and real-world strategies.
CRITICAL: You MUST assign at least one relevant tag to EVERY task. Provide a factual and informative description (1-2 sentences) outlining the specific actions required.
Return ONLY raw JSON without markdown formatting or code blocks.
Schema:
{ "boardName": "string", "columns": [ { "name": "string (e.g. 'To Do', 'In Progress', 'Review')", "tasks": [ { "title": "string", "description": "string (1-2 informative sentences)", "tags": [ { "name": "string (REQUIRED)", "color": "#hex" } ] } ] } ] }

Task: ` + prompt;
    }


    // Prepare initial empty project to stream into
    const projName = (prompt.split(' ').slice(0, 4).join(' ') + '...').replace(/\n/g, '');
    const proj = { id: uid(), name: projName, type: isLongTerm ? 'long' : 'short', boards: [] };
    state.projects.push(proj);
    state.activeProjectId = proj.id;
    state.activeBoardId = null;
    save();
    renderAll();

    // Adjust modal for streaming
    aiLoadingOverlay.style.backgroundColor = 'rgba(10, 14, 23, 0.6)';
    const overlayModal = aiLoadingOverlay.firstElementChild;
    if (overlayModal) {
      overlayModal.style.transform = 'scale(0.9) translateY(-25vh)';
      overlayModal.style.transition = 'all 0.4s ease';
      overlayModal.style.boxShadow = '0 0 40px rgba(0, 229, 255, 0.2)';
    }

    aiAbortController = new AbortController();

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${modelName}:streamGenerateContent?alt=sse&key=${state.aiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: aiAbortController.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemInstruction }] }]
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let rawText = '';
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.replace('data: ', '').trim();
          if (!dataStr) continue;
          try {
            const dataObj = JSON.parse(dataStr);
            const textPart = dataObj.candidates?.[0]?.content?.parts?.[0]?.text || '';
            rawText += textPart;
            
            if (typeof JSONRepair !== 'undefined') {
              try {
                let toParse = rawText.replace(/\x60\x60\x60json/gi, '').replace(/\x60\x60\x60/g, '').trim();
                const repaired = JSONRepair.jsonrepair(toParse);
                const parsed = JSON.parse(repaired);
                
                let liveWords = [];
                if (parsed.boards) {
                   parsed.boards.forEach(b => {
                      if (b.name) liveWords.push(b.name);
                      if (b.columns) b.columns.forEach(c => {
                         if (c.name) liveWords.push(c.name);
                         if (c.tasks) c.tasks.forEach(card => {
                            if (card.title) liveWords.push(card.title);
                            if (card.tags) card.tags.forEach(l => liveWords.push(l.name || l));
                         });
                         // fallback to older schema keys if they appear
                         if (c.cards) c.cards.forEach(card => {
                            if (card.title) liveWords.push(card.title);
                            if (card.labels) card.labels.forEach(l => liveWords.push(l.name || l));
                         });
                      });
                   });
                } else {
                    if (parsed.projectName) liveWords.push(parsed.projectName);
                    if (parsed.columns) parsed.columns.forEach(c => {
                       if (c.name) liveWords.push(c.name);
                       if (c.tasks) c.tasks.forEach(card => {
                           if (card.title) liveWords.push(card.title);
                           if (card.tags) card.tags.forEach(l => liveWords.push(l.name || l));
                       });
                       if (c.cards) c.cards.forEach(card => {
                           if (card.title) liveWords.push(card.title);
                           if (card.labels) card.labels.forEach(l => liveWords.push(l.name || l));
                       });
                    });
                }
                
                if (liveWords.length > 0) {
                   const filtered = liveWords.filter(w => {
                       if (!w || typeof w !== 'string') return false;
                       const trim = w.trim();
                       if (trim.length < 3) return false;
                       if (/^(day|week|month|year|phase|step)\b/i.test(trim)) return false;
                       return true;
                   });
                   window.liveAIWords = [...new Set(filtered)];
                }
                
                syncStreamedData(parsed, isLongTerm);
              } catch(e) {
                // Ignore incomplete parse errors
              }
            }
          } catch(e) {
             console.error("Chunk parse error", e);
          }
        }
      }
    }
    
    let finalToParse = rawText.replace(/\x60\x60\x60json/gi, '').replace(/\x60\x60\x60/g, '').trim();
    let finalResult;
    try {
      if (typeof JSONRepair !== 'undefined') {
        const repaired = JSONRepair.jsonrepair(finalToParse);
        finalResult = JSON.parse(repaired);
      } else {
        finalResult = JSON.parse(finalToParse);
      }
      syncStreamedData(finalResult, isLongTerm);
    } catch(e) {
      console.error("Final parse failed", e);
    }

    isAIGenerating = false;
    stopAIAnimation();
    aiLoadingOverlay.style.display = 'none';
    aiLoadingOverlay.style.backgroundColor = '';
    if (overlayModal) {
      overlayModal.style.transform = '';
      overlayModal.style.boxShadow = '';
    }
    
    save();
    renderAll();
    
    showToast('AI Board Generated successfully!', 'success');

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('AI Generation aborted by user.');
      isAIGenerating = false;
      return;
    }
    console.error(`AI Generation Error (Attempt ${attempt}):`, err);
    if (attempt === 1) aiLoadingOverlay.style.display = 'none';
    
    // Stop animation explicitly so we can retry properly if needed
    stopAIAnimation();
    isAIGenerating = false;
    
    // If it's a bad request, do not retry, just fail and tell the user!
    if (err.message.includes('HTTP 400')) {
      showToast('API Error: Bad Request. Check your prompt or API key.', 'error', 8000);
      return;
    }

    if (attempt < 10) {
      document.getElementById('ai-retry-widget').style.display = 'flex';
      showToast('Network error, retrying in 60s...', 'error', 4000);
      setTimeout(() => {
         document.getElementById('ai-retry-widget').style.display = 'none';
         generateBoardWithAI(prompt, isLongTerm, attempt + 1);
      }, 60000);
    } else {
      document.getElementById('ai-retry-widget').style.display = 'none';
      showToast('Failed to connect after 10 minutes.', 'error', 6000);
    }
  }
}

async function init() {
  await openDB();
  await loadState();

  if (state.projects.length === 0) {
    try {
      const response = await fetch('kanbanflow-2026-06-25.json');
      if (response.ok) {
        const data = await response.json();
        state.projects = data.projects || [];
        state.customTags = data.customTags || [];
        if (state.projects.length > 0) {
          state.activeProjectId = state.projects[0].id;
          state.activeBoardId = null;
        }
        save();
      } else {
        console.warn('Failed to load kanbanflow-2026-06-25.json');
      }
    } catch (e) {
      console.error('Error fetching default kanbanflow JSON:', e);
    }
  } else if (state.projects.length > 0) {
    if (!getActiveProject()) {
      state.activeProjectId = state.projects[0].id;
      if (state.projects[0].type === 'short') {
        state.activeBoardId = state.projects[0].boards[0].id;
      } else {
        state.activeBoardId = null;
      }
    }
  }

  renderAll();
}

init().catch(console.error);

