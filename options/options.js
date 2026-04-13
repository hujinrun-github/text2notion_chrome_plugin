// ===== DOM 引用 =====
const accountUnauthenticated = document.getElementById('account-unauthenticated');
const accountAuthenticated = document.getElementById('account-authenticated');
const accountIcon = document.getElementById('account-icon');
const accountWorkspace = document.getElementById('account-workspace');
const tokenInput = document.getElementById('token-input');
const btnSaveToken = document.getElementById('btn-save-token');
const tokenStatus = document.getElementById('token-status');
const btnDisconnect = document.getElementById('btn-disconnect');
const accountStatusBar = document.getElementById('token-status');

const dbList = document.getElementById('db-list');
const dbEmpty = document.getElementById('db-empty');
const btnRefreshDbs = document.getElementById('btn-refresh-dbs');
const inputDbId = document.getElementById('input-db-id');
const btnAddDb = document.getElementById('btn-add-db');
const dbStatusBar = document.getElementById('db-status');
const chkAutoCreateFields = document.getElementById('chk-auto-create-fields');

const selectMappingDb = document.getElementById('select-mapping-db');
const mappingConfig = document.getElementById('mapping-config');
const customMapping = document.getElementById('custom-mapping');
const mappingTbody = document.getElementById('mapping-tbody');
const btnSaveMapping = document.getElementById('btn-save-mapping');
const mappingStatusBar = document.getElementById('mapping-status');

const FIELD_LABELS = [
  { key: 'title',      label: '网页标题' },
  { key: 'content',    label: '选中内容' },
  { key: 'sourceUrl',  label: '来源 URL' },
  { key: 'capturedAt', label: '截取时间' },
  { key: 'tags',       label: '标签' },
  { key: 'notes',      label: '备注' },
];

const PRESET_DEFAULTS = {
  'preset-a': { title: 'Title', content: 'Content', sourceUrl: 'Source URL', capturedAt: 'Captured At', tags: 'Tags', notes: 'Notes' },
  'preset-b': { title: 'Name',  content: 'Description', sourceUrl: 'Reference', capturedAt: 'Date', tags: 'Category', notes: 'Remark' },
  'preset-c': { title: 'Idea',  content: 'Quote', sourceUrl: 'From', capturedAt: 'Collected At', tags: 'Theme', notes: 'Thoughts' },
};

// ===== 工具函数 =====
function showStatus(bar, msg, type = '') {
  bar.textContent = msg;
  bar.className = 'status-bar' + (type ? ` ${type}` : '');
  bar.hidden = false;
  if (type === 'success') {
    setTimeout(() => { bar.hidden = true; }, 3000);
  }
}

/** 从原始 Notion API 对象或手动添加的对象中提取可读名称 */
function getDbName(db) {
  return db.name || db.title?.[0]?.plain_text || db.id;
}

// ===== 初始化 =====
async function init() {
  const {
    notionAccessToken,
    notionDatabases = [],
    notionDefaultDatabase = '',
    notionAutoCreateFields = false,
  } = await chrome.storage.local.get([
    'notionAccessToken',
    'notionDatabases',
    'notionDefaultDatabase',
    'notionAutoCreateFields',
  ]);

  const databases = notionDatabases.map(db => ({
    ...db,
    name: getDbName(db),
    icon: db.icon || '',
  }));

  renderAccountSection(notionAccessToken);
  renderDatabaseSection(databases, notionDefaultDatabase);

  // 自动创建字段 checkbox
  chkAutoCreateFields.checked = notionAutoCreateFields;
  renderMappingSection(databases);

  // 导航高亮（基于 hash）
  const updateNav = () => {
    const hash = location.hash || '#account';
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('href') === hash);
      el.setAttribute('aria-current', el.getAttribute('href') === hash ? 'page' : '');
    });
  };
  window.addEventListener('hashchange', updateNav);
  updateNav();
}

// ===== 账号 =====
function renderAccountSection(token) {
  if (token) {
    accountAuthenticated.hidden = false;
    accountUnauthenticated.hidden = true;
    accountWorkspace.textContent = '✓ Token 已连接';
    accountIcon.src = '../images/icon-48.png';
    accountIcon.alt = 'Connected';
  } else {
    accountUnauthenticated.hidden = false;
    accountAuthenticated.hidden = true;
  }
}

// Token 保存事件处理
btnSaveToken.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showStatus(tokenStatus, '请输入 Token', 'error');
    tokenInput.focus();
    return;
  }

  btnSaveToken.disabled = true;
  btnSaveToken.textContent = '保存中…';
  showStatus(tokenStatus, '正在验证 Token…');

  try {
    // 临时保存 token 以测试有效性
    await chrome.storage.local.set({ notionAccessToken: token });
    
    // 尝试获取数据库列表来验证 token
    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'fetchDatabases' }, resolve);
    });

    if (result?.error) {
      // Token 无效，移除它
      await chrome.storage.local.remove('notionAccessToken');
      throw new Error(result.error);
    }

    // Token 有效 - 保持保存状态
    showStatus(tokenStatus, '✓ Token 保存成功', 'success');
    tokenInput.value = '';
    init();
  } catch (err) {
    await chrome.storage.local.remove('notionAccessToken');
    showStatus(tokenStatus, '✗ Token 验证失败：' + err.message, 'error');
    btnSaveToken.disabled = false;
    btnSaveToken.textContent = '保存';
  }
});

// 断开连接事件
btnDisconnect.addEventListener('click', async () => {
  if (!confirm('确定要断开与 Notion 的连接吗？')) return;
  await chrome.storage.local.remove([
    'notionAccessToken',
    'notionDatabases',
    'notionDefaultDatabase',
    'lastSaved',
  ]);
  renderAccountSection(null);
  renderDatabaseSection([], '');
  renderMappingSection([]);
  showStatus(tokenStatus, '已断开连接');
});

// ===== 数据库 =====

// 自动创建字段 checkbox
chkAutoCreateFields.addEventListener('change', async () => {
  await chrome.storage.local.set({ notionAutoCreateFields: chkAutoCreateFields.checked });
  showStatus(dbStatusBar, chkAutoCreateFields.checked ? '✓ 已开启自动创建字段' : '已关闭自动创建字段', 'success');
});

function renderDatabaseSection(databases, defaultDatabaseId) {
  dbList.innerHTML = '';

  if (!databases.length) {
    dbEmpty.hidden = false;
    dbList.hidden = true;
    return;
  }

  dbEmpty.hidden = true;
  dbList.hidden = false;

  databases.forEach(db => {
    const item = document.createElement('div');
    item.className = 'db-item';
    item.setAttribute('role', 'listitem');

    const radioId = `db-radio-${db.id}`;
    const isDefault = defaultDatabaseId === db.id;

    item.innerHTML = `
      <span class="db-item-icon" aria-hidden="true">${db.icon || '📄'}</span>
      <span class="db-item-name">${db.name}</span>
      <input
        type="radio"
        name="default-database"
        id="${radioId}"
        value="${db.id}"
        class="db-item-radio"
        ${isDefault ? 'checked' : ''}
        aria-label="设置「${db.name}」为默认数据库"
      />
      <button class="db-item-delete" data-id="${db.id}" aria-label="删除数据库「${db.name}」">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    dbList.appendChild(item);
  });

  // 设置默认数据库
  dbList.addEventListener('change', async (e) => {
    if (e.target.name === 'default-database') {
      await chrome.storage.local.set({ notionDefaultDatabase: e.target.value });
      showStatus(dbStatusBar, '✓ 已更新默认数据库', 'success');
    }
  });

  // 删除数据库
  dbList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.db-item-delete');
    if (!btn) return;
    const id = btn.dataset.id;
    const { notionDatabases = [] } = await chrome.storage.local.get('notionDatabases');
    const updated = notionDatabases.filter(d => d.id !== id);
    await chrome.storage.local.set({ notionDatabases: updated });
    const { notionDefaultDatabase = '' } = await chrome.storage.local.get('notionDefaultDatabase');
    const updatedFormatted = updated.map(db => ({ ...db, name: getDbName(db), icon: db.icon || '' }));
    renderDatabaseSection(updatedFormatted, notionDefaultDatabase);
    renderMappingSection(updatedFormatted);
    showStatus(dbStatusBar, '已删除', 'success');
  });
}

btnRefreshDbs.addEventListener('click', async () => {
  btnRefreshDbs.disabled = true;
  btnRefreshDbs.textContent = '同步中…';
  showStatus(dbStatusBar, '正在从 Notion 拉取数据库列表…');
  chrome.runtime.sendMessage({ type: 'fetchDatabases' }, async (result) => {
    btnRefreshDbs.disabled = false;
    btnRefreshDbs.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M2 7a5 5 0 018.66-2.5M12 7a5 5 0 01-8.66 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        <path d="M10.5 2.5L10.66 4.5 8.66 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      同步`;
    if (result?.databases) {
      const { notionDefaultDatabase = '' } = await chrome.storage.local.get('notionDefaultDatabase');
      const formatted = result.databases.map(db => ({ ...db, name: getDbName(db), icon: db.icon || '' }));
      renderDatabaseSection(formatted, notionDefaultDatabase);
      renderMappingSection(formatted);
      if (result.databases.length === 0) {
        showStatus(dbStatusBar, '未找到可用数据库。请先在 Notion 中打开目标数据库，点击右上角「…」→「连接」→ 找到本插件并添加，再点击同步。', 'error');
      } else {
        showStatus(dbStatusBar, `✓ 已同步 ${result.databases.length} 个数据库`, 'success');
      }
    } else {
      showStatus(dbStatusBar, result?.error || '同步失败，请检查是否已连接账号', 'error');
    }
  });
});

btnAddDb.addEventListener('click', async () => {
  const id = inputDbId.value.trim().replace(/-/g, '');
  if (!id || id.length < 32) {
    showStatus(dbStatusBar, '请输入有效的 Database ID（32 位字符）', 'error');
    inputDbId.focus();
    return;
  }
  const {
    notionDatabases = [],
    notionDefaultDatabase = '',
  } = await chrome.storage.local.get(['notionDatabases', 'notionDefaultDatabase']);
  if (notionDatabases.find(d => d.id === id)) {
    showStatus(dbStatusBar, '该数据库已存在', 'error');
    return;
  }
  const updated = [...notionDatabases, { id, name: id.slice(0, 8) + '…', icon: '📄' }];
  await chrome.storage.local.set({ notionDatabases: updated });
  inputDbId.value = '';
  renderDatabaseSection(updated, notionDefaultDatabase);
  renderMappingSection(updated);
  showStatus(dbStatusBar, '✓ 已添加，建议点击「同步」获取数据库名称', 'success');
});

// ===== 字段映射 =====
function renderMappingSection(databases) {
  selectMappingDb.innerHTML = databases.length
    ? databases.map(db => `<option value="${db.id}">${db.icon || ''} ${db.name}</option>`).join('')
    : '<option value="">— 请先添加数据库 —</option>';

  if (databases.length) {
    mappingConfig.hidden = false;
    loadMappingConfig(databases[0].id);
  } else {
    mappingConfig.hidden = true;
  }
}

async function loadMappingConfig(dbId) {
  const { notionDatabases = [] } = await chrome.storage.local.get('notionDatabases');
  const db = notionDatabases.find(d => d.id === dbId);
  const template = db?.mappingTemplate || 'preset-a';
  const custom = db?.customMapping || {};

  document.querySelectorAll('input[name="template"]').forEach(radio => {
    radio.checked = radio.value === template;
  });

  customMapping.hidden = template !== 'custom';

  if (template === 'custom') {
    renderCustomMappingTable(custom);
  }
}

function renderCustomMappingTable(customMap) {
  mappingTbody.innerHTML = FIELD_LABELS.map(({ key, label }) => {
    const fieldValue = customMap[key]?.field || '';
    const enabled = customMap[key]?.enabled !== false;
    return `
      <tr>
        <td class="mapping-field-name">${label}</td>
        <td>
          <input
            type="text"
            name="mapping-field-${key}"
            value="${fieldValue}"
            placeholder="Notion 字段名…"
            autocomplete="off"
            spellcheck="false"
            aria-label="${label} 对应的 Notion 字段名"
          />
        </td>
        <td>
          <input
            type="checkbox"
            name="mapping-enabled-${key}"
            ${enabled ? 'checked' : ''}
            aria-label="启用${label}字段"
          />
        </td>
      </tr>
    `;
  }).join('');
}

selectMappingDb.addEventListener('change', () => {
  loadMappingConfig(selectMappingDb.value);
});

document.querySelectorAll('input[name="template"]').forEach(radio => {
  radio.addEventListener('change', () => {
    customMapping.hidden = radio.value !== 'custom';
    if (radio.value === 'custom') {
      renderCustomMappingTable({});
    }
  });
});

btnSaveMapping.addEventListener('click', async () => {
  const dbId = selectMappingDb.value;
  if (!dbId) return;

  const template = document.querySelector('input[name="template"]:checked')?.value || 'preset-a';
  let customMap = null;

  if (template === 'custom') {
    customMap = {};
    FIELD_LABELS.forEach(({ key }) => {
      const field = document.querySelector(`input[name="mapping-field-${key}"]`)?.value.trim() || '';
      const enabled = document.querySelector(`input[name="mapping-enabled-${key}"]`)?.checked !== false;
      customMap[key] = { field, enabled };
    });
  }

  const { notionDatabases = [] } = await chrome.storage.local.get('notionDatabases');
  const updated = notionDatabases.map(db =>
    db.id === dbId ? { ...db, mappingTemplate: template, customMapping: customMap } : db
  );
  await chrome.storage.local.set({ notionDatabases: updated });
  showStatus(mappingStatusBar, '✓ 映射已保存', 'success');
});

// ===== 启动 =====
init().catch(err => console.error('Options init error:', err));
