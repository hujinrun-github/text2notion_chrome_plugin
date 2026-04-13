/**
 * scripts/content.js
 * Chrome Extension Content Script — Manifest V3
 *
 * 职责：
 * 1. 监听来自 background.js 的 processSelectedText 消息
 * 2. 注入 Toast UI（Phase A 初始保存 → Phase B 保存中 → Phase C 成功 → Phase D 编辑详情）
 * 3. 处理保存、更新、关闭等用户交互
 */

// ─────────────────────────────────────────────────────────────
// 消息监听入口
// ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type !== 'processSelectedText') return;

  const { selectionText = '', pageUrl = '', pageTitle = '' } = message;

  // 防重复：移除已有 toast
  const existing = document.getElementById('notion-clipper-toast');
  if (existing) removeToast(existing, true /* immediate */);

  injectToast({ selectionText, pageUrl, pageTitle });
});

// ─────────────────────────────────────────────────────────────
// 安全发送消息（插件更新/重载后 context 会失效）
// ─────────────────────────────────────────────────────────────
async function safeSendMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err) {
    if (err.message?.includes('Extension context invalidated')) {
      return { success: false, error: '插件已更新，请刷新页面后重试' };
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// 移除 Toast（带退出动画）
// ─────────────────────────────────────────────────────────────
function removeToast(toast, immediate = false) {
  if (!toast) return;
  if (immediate) {
    toast.remove();
    return;
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    toast.remove();
    return;
  }
  toast.classList.add('toast-out');
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

// ─────────────────────────────────────────────────────────────
// 公共：创建 tag 输入组件
// 返回 { addTag, collectTags, tagsRow, tagInput, setSuggestions }
// ─────────────────────────────────────────────────────────────
function createTagWidget() {
  const tagsRow = document.createElement('div');
  tagsRow.className = 'nc-tags-row';
  tagsRow.setAttribute('data-testid', 'nc-tags-row');

  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.className = 'nc-tag-input';
  tagInput.setAttribute('data-testid', 'nc-tag-input');
  tagInput.setAttribute('data-action', 'tag-input');
  tagInput.placeholder = '输入标签，按 Enter 或逗号确认';
  tagsRow.appendChild(tagInput);

  // suggestions 容器
  const suggestionsRow = document.createElement('div');
  suggestionsRow.className = 'nc-tag-suggestions';
  suggestionsRow.setAttribute('data-testid', 'nc-tag-suggestions');

  function addTag(value) {
    const trimmed = value.trim();
    if (!trimmed) return;
    tagInput.value = '';

    // 防重复
    const existing = collectTags();
    if (existing.includes(trimmed)) return;

    const pill = document.createElement('span');
    pill.className = 'nc-tag nc-tag-pill';
    pill.setAttribute('data-testid', 'nc-tag-pill');
    pill.textContent = trimmed;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'nc-tag-remove';
    removeBtn.setAttribute('data-action', 'remove-tag');
    removeBtn.setAttribute('aria-label', `移除标签 ${trimmed}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => pill.remove());

    pill.appendChild(removeBtn);
    tagsRow.insertBefore(pill, tagInput);
  }

  function collectTags() {
    const pills = tagsRow.querySelectorAll('.nc-tag-pill');
    return Array.from(pills).map((p) => {
      const text = p.childNodes[0]?.textContent || p.textContent.replace('×', '').trim();
      return text.trim();
    }).filter(Boolean);
  }

  function flushInput() {
    if (tagInput.value.trim()) {
      addTag(tagInput.value);
    }
  }

  function setSuggestions(tagNames) {
    suggestionsRow.innerHTML = '';
    if (!tagNames || tagNames.length === 0) return;

    tagNames.forEach((name) => {
      const chip = document.createElement('button');
      chip.className = 'nc-tag-suggestion';
      chip.type = 'button';
      chip.textContent = name;
      chip.addEventListener('click', () => addTag(name));
      suggestionsRow.appendChild(chip);
    });
  }

  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(tagInput.value);
    } else if (e.key === ',') {
      e.preventDefault();
      addTag(tagInput.value);
    }
  });

  return { addTag, collectTags, flushInput, tagsRow, tagInput, suggestionsRow, setSuggestions };
}

// ─────────────────────────────────────────────────────────────
// 注入 Toast — Phase A（初始保存界面）
// ─────────────────────────────────────────────────────────────
async function injectToast({ selectionText, pageUrl, pageTitle }) {
  // ── 读取存储数据 ──
  const storage = await chrome.storage.local.get([
    'notionDatabases',
    'notionDefaultDatabase',
  ]);
  const databases = storage.notionDatabases || [];
  const defaultDb = storage.notionDefaultDatabase || '';

  // ── 构建容器 ──
  const toast = buildToastContainer();
  const {
    liveRegion, saveBtn, cancelBtn, select,
    contentTextarea, tagWidget, notesInput,
  } = renderPhaseA(toast, { selectionText, databases, defaultDb });

  document.body.appendChild(toast);

  // ── 并行获取 tag suggestions ──
  if (select.value) {
    safeSendMessage({ type: 'fetchDatabaseTags', databaseId: select.value })
      .then(res => {
        if (res?.tags?.length) tagWidget.setSuggestions(res.tags);
      });
  }
  // 切换数据库时重新拉取
  select.addEventListener('change', () => {
    tagWidget.setSuggestions([]);
    if (select.value) {
      safeSendMessage({ type: 'fetchDatabaseTags', databaseId: select.value })
        .then(res => {
          if (res?.tags?.length) tagWidget.setSuggestions(res.tags);
        });
    }
  });

  // ── 保存事件 ──
  saveBtn.addEventListener('click', async () => {
    const databaseId = select.value;

    // 收集 tags（含输入框残留）
    tagWidget.flushInput();
    const tags = tagWidget.collectTags();
    const notes = notesInput.value;
    const editedContent = contentTextarea.value;

    // Phase B：保存中
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.innerHTML = '<span class="nc-spinner"></span> 保存中…';
    liveRegion.textContent = '';

    const response = await safeSendMessage({
      type: 'saveToNotion',
      databaseId,
      selectedText: editedContent,
      pageUrl,
      pageTitle,
      tags,
      notes,
    });

    if (response && response.success) {
      // Phase C：成功
      renderPhaseC(toast, response.pageId, response.pageUrl);
    } else {
      // 失败：恢复 Phase A，并显示可见的错误信息
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      saveBtn.textContent = '保存';
      const errMsg = (response && response.error) || '保存失败，请重试';
      liveRegion.textContent = errMsg;

      const oldErr = toast.querySelector('.nc-error-msg');
      if (oldErr) oldErr.remove();
      const errEl = document.createElement('p');
      errEl.className = 'nc-error-msg';
      errEl.textContent = errMsg;
      if (errMsg.includes('未登录')) {
        const settingsLink = document.createElement('a');
        settingsLink.href = chrome.runtime.getURL('options/options.html');
        settingsLink.target = '_blank';
        settingsLink.rel = 'noopener noreferrer';
        settingsLink.style.cssText = 'color:inherit;text-decoration:underline;cursor:pointer;';
        settingsLink.textContent = ' → 点此连接 Notion';
        errEl.appendChild(settingsLink);
      }
      toast.querySelector('.nc-toast-body').appendChild(errEl);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// 构建 Toast 容器（含 Header）
// ─────────────────────────────────────────────────────────────
function buildToastContainer() {
  const toast = document.createElement('div');
  toast.id = 'notion-clipper-toast';
  toast.setAttribute('role', 'dialog');
  toast.setAttribute('aria-label', '保存到 Notion');
  return toast;
}

// ─────────────────────────────────────────────────────────────
// Phase A：渲染初始保存界面
// ─────────────────────────────────────────────────────────────
function renderPhaseA(toast, { selectionText, databases, defaultDb }) {
  // ── Header ──
  const header = document.createElement('div');
  header.className = 'nc-toast-header';

  const title = document.createElement('span');
  title.className = 'nc-toast-title';
  title.textContent = '保存到 Notion';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'nc-toast-close nc-close-btn';
  closeBtn.setAttribute('data-action', 'close');
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => removeToast(toast));

  header.append(title, closeBtn);

  // ── Body ──
  const body = document.createElement('div');
  body.className = 'nc-toast-body';

  // 可编辑内容
  const contentLabel = document.createElement('label');
  contentLabel.className = 'nc-field-label';
  contentLabel.textContent = '内容';

  const contentTextarea = document.createElement('textarea');
  contentTextarea.className = 'nc-content-textarea';
  contentTextarea.setAttribute('data-testid', 'nc-content-textarea');
  contentTextarea.value = selectionText;
  contentTextarea.rows = 3;
  body.append(contentLabel, contentTextarea);

  // 数据库选择
  const dbLabel = document.createElement('label');
  dbLabel.className = 'nc-field-label';
  dbLabel.textContent = '数据库';

  const selectWrapper = document.createElement('div');
  selectWrapper.className = 'nc-select-wrapper';

  const select = document.createElement('select');
  select.className = 'nc-select';
  select.setAttribute('data-testid', 'nc-db-select');

  databases.forEach((db) => {
    const opt = document.createElement('option');
    opt.value = db.id;
    opt.textContent = db.name || db.title?.[0]?.plain_text || db.id;
    if (db.id === defaultDb) opt.selected = true;
    select.appendChild(opt);
  });
  if (defaultDb && databases.some((d) => d.id === defaultDb)) {
    select.value = defaultDb;
  }

  selectWrapper.appendChild(select);
  body.append(dbLabel, selectWrapper);

  // 标签
  const tagsLabel = document.createElement('label');
  tagsLabel.className = 'nc-field-label';
  tagsLabel.textContent = '标签';

  const tagWidget = createTagWidget();
  body.append(tagsLabel, tagWidget.tagsRow, tagWidget.suggestionsRow);

  // 备注
  const notesLabel = document.createElement('label');
  notesLabel.className = 'nc-field-label';
  notesLabel.textContent = '备注';

  const notesInput = document.createElement('textarea');
  notesInput.className = 'nc-notes-input';
  notesInput.setAttribute('data-testid', 'nc-notes-input');
  notesInput.placeholder = '添加备注…';
  notesInput.rows = 2;
  body.append(notesLabel, notesInput);

  // 操作按钮
  const actions = document.createElement('div');
  actions.className = 'nc-toast-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'nc-btn nc-btn-ghost';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', () => removeToast(toast));

  const saveBtn = document.createElement('button');
  saveBtn.className = 'nc-btn nc-btn-primary nc-save-btn';
  saveBtn.setAttribute('data-action', 'save');
  saveBtn.setAttribute('data-testid', 'nc-save-btn');
  saveBtn.textContent = '保存';
  if (databases.length === 0) {
    saveBtn.disabled = true;
  }

  actions.append(cancelBtn, saveBtn);
  body.appendChild(actions);

  // aria-live 错误区
  const liveRegion = document.createElement('div');
  liveRegion.className = 'nc-live-region';
  liveRegion.setAttribute('role', 'alert');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('data-testid', 'nc-live-region');
  body.appendChild(liveRegion);

  toast.append(header, body);

  return { liveRegion, saveBtn, cancelBtn, select, contentTextarea, tagWidget, notesInput };
}

// ─────────────────────────────────────────────────────────────
// Phase C：成功界面
// ─────────────────────────────────────────────────────────────
function renderPhaseC(toast, pageId, pageUrl) {
  const oldBody = toast.querySelector('.nc-toast-body');
  if (oldBody) oldBody.remove();

  const successBody = document.createElement('div');
  successBody.className = 'nc-toast-success-body nc-success';
  successBody.setAttribute('data-phase', 'success');
  successBody.setAttribute('data-testid', 'nc-success');

  // 成功行
  const successRow = document.createElement('div');
  successRow.className = 'nc-success-row';

  const successIcon = document.createElement('span');
  successIcon.className = 'nc-success-icon';
  successIcon.textContent = '✓';

  const successText = document.createElement('span');
  successText.className = 'nc-success-text';
  successText.textContent = '已保存到 Notion';

  successRow.append(successIcon, successText);
  successBody.appendChild(successRow);

  // 操作行
  const successActions = document.createElement('div');
  successActions.className = 'nc-success-actions';

  const viewLink = document.createElement('a');
  viewLink.href = pageUrl;
  viewLink.target = '_blank';
  viewLink.rel = 'noopener noreferrer';
  viewLink.className = 'nc-btn nc-btn-ghost';
  viewLink.textContent = '在 Notion 中查看';
  successActions.appendChild(viewLink);

  const editToggleBtn = document.createElement('button');
  editToggleBtn.className = 'nc-btn nc-btn-ghost nc-edit-toggle';
  editToggleBtn.setAttribute('data-action', 'toggle-edit');
  editToggleBtn.setAttribute('data-testid', 'nc-edit-toggle');
  editToggleBtn.setAttribute('aria-expanded', 'false');
  editToggleBtn.textContent = '编辑详情';
  successActions.appendChild(editToggleBtn);

  successBody.appendChild(successActions);

  // Phase D 编辑面板（初始隐藏）
  const editPanel = buildEditPanel(toast, pageId);
  editPanel.hidden = true;
  successBody.appendChild(editPanel);

  // aria-live
  const liveRegion = document.createElement('div');
  liveRegion.className = 'nc-live-region';
  liveRegion.setAttribute('role', 'alert');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('data-testid', 'nc-live-region');
  successBody.appendChild(liveRegion);

  toast.appendChild(successBody);

  // 展开/收起 + 首次展开时拉取 tag suggestions
  let tagsFetched = false;
  editToggleBtn.addEventListener('click', () => {
    const expanded = editToggleBtn.getAttribute('aria-expanded') === 'true';
    editToggleBtn.setAttribute('aria-expanded', String(!expanded));
    editPanel.hidden = expanded;

    // 首次展开时拉取已有 tags
    if (!expanded && !tagsFetched) {
      tagsFetched = true;
      const lastSavedStr = editPanel.getAttribute('data-database-id');
      if (lastSavedStr) {
        safeSendMessage({ type: 'fetchDatabaseTags', databaseId: lastSavedStr })
          .then(res => {
            if (res?.tags?.length) {
              const widget = editPanel._tagWidget;
              if (widget) widget.setSuggestions(res.tags);
            }
          });
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Phase D：编辑详情面板
// ─────────────────────────────────────────────────────────────
function buildEditPanel(toast, pageId) {
  const panel = document.createElement('div');
  panel.className = 'nc-edit-panel';
  panel.setAttribute('data-testid', 'nc-edit-panel');

  // 从 lastSaved 获取 databaseId（用于拉取 tag suggestions）
  chrome.storage.local.get('lastSaved').then(({ lastSaved }) => {
    if (lastSaved?.databaseId) {
      panel.setAttribute('data-database-id', lastSaved.databaseId);
    }
  });

  // 标签区
  const tagsLabel = document.createElement('label');
  tagsLabel.className = 'nc-field-label';
  tagsLabel.textContent = '标签';

  const tagWidget = createTagWidget();
  panel._tagWidget = tagWidget; // 保存引用，供 Phase C 展开时使用

  // 备注
  const notesLabel = document.createElement('label');
  notesLabel.className = 'nc-field-label';
  notesLabel.textContent = '备注';

  const notesInput = document.createElement('textarea');
  notesInput.className = 'nc-notes-input';
  notesInput.setAttribute('data-testid', 'nc-notes-input');
  notesInput.setAttribute('data-action', 'notes');
  notesInput.placeholder = '添加备注…';
  notesInput.rows = 3;

  // 更新按钮
  const panelActions = document.createElement('div');
  panelActions.className = 'nc-toast-actions';

  const updateBtn = document.createElement('button');
  updateBtn.className = 'nc-btn nc-btn-primary nc-update-btn';
  updateBtn.setAttribute('data-action', 'update');
  updateBtn.setAttribute('data-testid', 'nc-update-btn');
  updateBtn.textContent = '更新';
  panelActions.appendChild(updateBtn);

  panel.append(
    tagsLabel, tagWidget.tagsRow, tagWidget.suggestionsRow,
    notesLabel, notesInput, panelActions
  );

  updateBtn.addEventListener('click', async () => {
    updateBtn.disabled = true;
    updateBtn.textContent = '更新中…';

    tagWidget.flushInput();
    const tags = tagWidget.collectTags();
    const notes = notesInput.value;

    const liveRegion = toast.querySelector('.nc-live-region[role="alert"]');
    if (liveRegion) liveRegion.textContent = '';

    const response = await safeSendMessage({
      type: 'updateNotionPage',
      pageId,
      fields: { tags, notes },
    });

    if (response && response.success) {
      updateBtn.textContent = '已更新 ✓';
      if (liveRegion) liveRegion.textContent = '已更新';
    } else {
      updateBtn.disabled = false;
      updateBtn.textContent = '更新';
      const errMsg = (response && response.error) || '更新失败';
      if (liveRegion) liveRegion.textContent = errMsg;
      const errEl = document.createElement('p');
      errEl.style.color = 'red';
      errEl.style.fontSize = '12px';
      errEl.textContent = errMsg;
      panel.appendChild(errEl);
    }
  });

  return panel;
}
