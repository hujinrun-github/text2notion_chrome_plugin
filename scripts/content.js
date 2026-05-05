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

  const { selectionText: msgText = '', pageUrl = '', pageTitle = '', mediaType, srcUrl } = message;

  // 从当前页面获取选区 HTML（比 info.selectionText 丰富）
  const captured = captureSelectionHtml(pageUrl);
  // 如果 DOM 获取成功则用 HTML，否则回退到消息中的纯文本
  let selectionHtml = captured.html || '';
  let selectionText = captured.text || msgText;

  // 如果右键点击的是图片，且选区中没有该图片，追加到 HTML 中
  if (mediaType === 'image' && srcUrl) {
    if (!selectionHtml.includes(srcUrl)) {
      const imgTag = `<img src="${srcUrl.replace(/"/g, '&quot;')}" />`;
      selectionHtml = selectionHtml ? selectionHtml + imgTag : imgTag;
    }
    // 如果没有选中文字，用图片 URL 作为文本
    if (!selectionText) {
      selectionText = srcUrl;
    }
  }

  // 防重复：移除已有 toast
  const existing = document.getElementById('notion-clipper-toast');
  if (existing) removeToast(existing, true /* immediate */);

  injectToast({ selectionText, selectionHtml, pageUrl, pageTitle });
});

// ─────────────────────────────────────────────────────────────
// 获取选区 HTML + 图片 data URL 兜底
// ─────────────────────────────────────────────────────────────
function captureSelectionHtml(pageUrl) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { html: '', text: '' };
  }

  const range = selection.getRangeAt(0);
  const fragment = range.cloneContents();

  // 主动收集选区范围内的图片（cloneContents 可能因 DOM 层级嵌套而遗漏图片）
  collectImagesInRange(range, fragment, pageUrl);

  // 解析相对路径为绝对路径
  const images = fragment.querySelectorAll('img');
  for (const img of images) {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) continue;
    try {
      img.setAttribute('src', new URL(src, pageUrl).href);
    } catch (_) {}
  }

  // 链接也做相对路径解析
  const links = fragment.querySelectorAll('a[href]');
  for (const a of links) {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#') || href.startsWith('mailto:')) continue;
    try {
      a.setAttribute('href', new URL(href, pageUrl).href);
    } catch (_) {}
  }

  const div = document.createElement('div');
  div.appendChild(fragment);

  return {
    html: div.innerHTML,
    text: selection.toString(),
  };
}

/**
 * 扫描选区 range 覆盖的 DOM 区域，找到所有 <img>，
 * 如果 cloneContents 的 fragment 中没有包含它们，就追加进去。
 * 同时处理 data-original / data-src 等懒加载属性。
 */
function collectImagesInRange(range, fragment, pageUrl) {
  // 找到选区的公共祖先，在其中搜索所有 img
  const ancestor = range.commonAncestorContainer;
  const container = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement;
  if (!container) return;

  const allImgs = container.querySelectorAll('img');
  // fragment 中已有的图片 src 集合
  const existingSrcs = new Set();
  fragment.querySelectorAll('img').forEach(img => {
    existingSrcs.add(img.getAttribute('src') || '');
    existingSrcs.add(img.getAttribute('data-original') || '');
  });

  for (const img of allImgs) {
    // 检查图片是否在选区范围内
    if (!isNodeInRange(img, range)) continue;

    // 获取真正的图片 URL（处理懒加载属性）
    const realSrc = img.getAttribute('data-original')
      || img.getAttribute('data-src')
      || img.getAttribute('data-actualsrc')
      || img.src
      || img.getAttribute('src')
      || '';

    if (!realSrc) continue;

    // 如果 fragment 中已经有这张图片，跳过
    if (existingSrcs.has(realSrc) || existingSrcs.has(img.src)) continue;

    // 解析为绝对路径
    let absoluteSrc = realSrc;
    if (!realSrc.startsWith('http') && !realSrc.startsWith('data:')) {
      try { absoluteSrc = new URL(realSrc, pageUrl).href; } catch (_) {}
    }

    // 创建 img 元素追加到 fragment
    const newImg = document.createElement('img');
    newImg.setAttribute('src', absoluteSrc);
    if (img.alt) newImg.setAttribute('alt', img.alt);
    fragment.appendChild(newImg);
    existingSrcs.add(absoluteSrc);
  }
}

/**
 * 判断一个节点是否在 range 的选区范围内
 */
function isNodeInRange(node, range) {
  try {
    const nodeRange = document.createRange();
    nodeRange.selectNode(node);
    // 节点的起点在选区终点之前，且节点的终点在选区起点之后 → 有交集
    return (
      range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0 &&
      range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0
    );
  } catch (_) {
    return false;
  }
}

/**
 * 将 HTML 字符串中的外链图片转为 data URL（绕过防盗链）
 * 在保存前调用，限制单张图片最大 5MB，超时 5 秒
 * @param {string} html
 * @returns {Promise<string>} 替换后的 HTML
 */
async function convertImagesToDataUrl(html) {
  if (!html) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const images = doc.querySelectorAll('img[src]');

  const MAX_SIZE = 5 * 1024 * 1024; // 5MB
  const TIMEOUT = 5000; // 5 秒

  const promises = Array.from(images).map(async (img) => {
    const src = img.getAttribute('src') || '';
    // 跳过已经是 data URL 的
    if (!src || src.startsWith('data:')) return;
    // 只处理 http(s) 链接
    if (!src.startsWith('http://') && !src.startsWith('https://')) return;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT);

      const resp = await fetch(src, {
        signal: controller.signal,
        credentials: 'include', // 携带 cookie，绕过防盗链
      });
      clearTimeout(timer);

      if (!resp.ok) return;

      const blob = await resp.blob();
      // 跳过过大的图片
      if (blob.size > MAX_SIZE) return;

      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });

      if (dataUrl) {
        img.setAttribute('src', dataUrl);
      }
    } catch (_) {
      // 网络错误、超时、CORS 等，保留原始 URL
    }
  });

  await Promise.all(promises);

  return doc.body.innerHTML;
}

/**
 * 在页面中找到与克隆 img 对应的原始元素
 */
function findOriginalImg(clonedImg, src) {
  const allImgs = document.querySelectorAll('img');
  for (const img of allImgs) {
    if (img.src === src || img.getAttribute('src') === src) {
      return img;
    }
  }
  return null;
}

/**
 * 将 img 元素转为 data URL（仅同域图片有效，跨域 canvas 会被 taint）
 */
function imgToDataUrl(img) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (_) {
    // 跨域图片会 taint canvas，静默失败
    return null;
  }
}

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
async function injectToast({ selectionText, selectionHtml, pageUrl, pageTitle }) {
  // ── 读取存储数据 ──
  const storage = await chrome.storage.local.get([
    'notionDatabases',
    'notionDefaultDatabase',
    'notionSaveMode',
  ]);
  const databases = storage.notionDatabases || [];
  const defaultDb = storage.notionDefaultDatabase || '';
  const savedMode = storage.notionSaveMode || 'create';

  // ── 构建容器 ──
  const toast = buildToastContainer();
  const {
    liveRegion, saveBtn, cancelBtn, select,
    contentTextarea, tagWidget, notesInput, titleInput,
    modeRadios, createSection, appendSection, pageSelect,
  } = renderPhaseA(toast, { selectionText, databases, defaultDb, savedMode, pageTitle });

  document.body.appendChild(toast);

  // ── 模式切换 ──
  let currentMode = savedMode;
  // 初始化 UI 状态（如果 savedMode 不是默认的 create）
  if (savedMode !== 'create') {
    createSection.hidden = true;
    appendSection.hidden = false;
    saveBtn.textContent = '追加';
    if (select.value) {
      loadDatabasePages(select.value, pageSelect);
    }
  }
  modeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      currentMode = radio.value;
      createSection.hidden = currentMode !== 'create';
      appendSection.hidden = currentMode !== 'append';
      saveBtn.textContent = currentMode === 'create' ? '保存' : '追加';

      // 记住用户选择
      chrome.storage.local.set({ notionSaveMode: currentMode });

      // 追加模式：加载页面列表
      if (currentMode === 'append' && select.value) {
        loadDatabasePages(select.value, pageSelect);
      }
    });
  });

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
      // 追加模式下也刷新页面列表
      if (currentMode === 'append') {
        loadDatabasePages(select.value, pageSelect);
      }
    }
  });

  // ── 保存/追加事件 ──
  saveBtn.addEventListener('click', async () => {
    const databaseId = select.value;

    // Phase B：操作中
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.innerHTML = '<span class="nc-spinner"></span> ' + (currentMode === 'create' ? '保存中…' : '追加中…');
    liveRegion.textContent = '';

    let response;

    // 保存前将图片转为 data URL（绕过防盗链），再转为 Notion blocks
    let processedHtml = selectionHtml;
    if (processedHtml && processedHtml.trim()) {
      try {
        processedHtml = await convertImagesToDataUrl(processedHtml);
      } catch (_) {
        // 转换失败保留原始 HTML
      }
    }

    // 在 content script 中将 HTML 转为 Notion blocks（Service Worker 没有 DOMParser）
    let contentBlocks;
    if (processedHtml && processedHtml.trim()) {
      contentBlocks = htmlToBlocks(processedHtml, pageUrl);
    }

    if (currentMode === 'append') {
      // ── 追加模式 ──
      const targetPageId = pageSelect.value;
      if (!targetPageId) {
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        saveBtn.textContent = '追加';
        liveRegion.textContent = '请选择目标页面';
        return;
      }
      response = await safeSendMessage({
        type: 'appendToPage',
        pageId: targetPageId,
        selectedText: contentTextarea.value,
        contentBlocks,
        pageUrl,
      });
    } else {
      // ── 新建模式 ──
      tagWidget.flushInput();
      const tags = tagWidget.collectTags();
      const notes = notesInput.value;
      const editedContent = contentTextarea.value;

      response = await safeSendMessage({
        type: 'saveToNotion',
        databaseId,
        selectedText: editedContent,
        contentBlocks,
        pageUrl,
        pageTitle: titleInput.value || pageTitle,
        tags,
        notes,
      });
    }

    if (response && response.success) {
      const pageUrl = response.pageUrl || '';
      renderPhaseC(toast, response.pageId, pageUrl);
    } else {
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      saveBtn.textContent = currentMode === 'create' ? '保存' : '追加';
      const errMsg = (response && response.error) || '操作失败，请重试';
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

/**
 * 加载数据库中的页面列表到 select
 */
async function loadDatabasePages(databaseId, pageSelect) {
  pageSelect.innerHTML = '<option value="">加载中…</option>';
  pageSelect.disabled = true;

  const res = await safeSendMessage({ type: 'fetchDatabasePages', databaseId });

  pageSelect.innerHTML = '';
  pageSelect.disabled = false;

  if (res?.pages?.length) {
    res.pages.forEach(page => {
      const opt = document.createElement('option');
      opt.value = page.id;
      opt.textContent = page.title;
      pageSelect.appendChild(opt);
    });
  } else if (res?.error) {
    pageSelect.innerHTML = `<option value="">加载失败：${res.error}</option>`;
  } else {
    pageSelect.innerHTML = '<option value="">— 该数据库中无页面 —</option>';
  }
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
function renderPhaseA(toast, { selectionText, databases, defaultDb, savedMode, pageTitle }) {
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

  // 模式切换
  const modeGroup = document.createElement('div');
  modeGroup.className = 'nc-mode-group';

  const modeRadios = [];
  [{ value: 'create', label: '新建页面' }, { value: 'append', label: '追加到已有页面' }].forEach(({ value, label }) => {
    const radioLabel = document.createElement('label');
    radioLabel.className = 'nc-mode-radio';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'nc-mode';
    radio.value = value;
    radio.checked = value === (savedMode || 'create');
    modeRadios.push(radio);
    const span = document.createElement('span');
    span.textContent = label;
    radioLabel.append(radio, span);
    modeGroup.appendChild(radioLabel);
  });
  body.appendChild(modeGroup);

  // 数据库选择（两个模式共用）
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

  // ── 新建模式区域 ──
  const createSection = document.createElement('div');
  createSection.className = 'nc-create-section';
  createSection.setAttribute('data-testid', 'nc-create-section');

  // 标题（可编辑）
  const titleLabel = document.createElement('label');
  titleLabel.className = 'nc-field-label';
  titleLabel.textContent = '标题';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'nc-title-input';
  titleInput.setAttribute('data-testid', 'nc-title-input');
  titleInput.value = pageTitle || '';
  titleInput.placeholder = '输入标题…';
  createSection.append(titleLabel, titleInput);

  // 可编辑内容
  const contentLabel = document.createElement('label');
  contentLabel.className = 'nc-field-label';
  contentLabel.textContent = '内容';

  const contentTextarea = document.createElement('textarea');
  contentTextarea.className = 'nc-content-textarea';
  contentTextarea.setAttribute('data-testid', 'nc-content-textarea');
  contentTextarea.value = selectionText;
  contentTextarea.rows = 3;
  createSection.append(contentLabel, contentTextarea);

  // 标签
  const tagsLabel = document.createElement('label');
  tagsLabel.className = 'nc-field-label';
  tagsLabel.textContent = '标签';

  const tagWidget = createTagWidget();
  createSection.append(tagsLabel, tagWidget.tagsRow, tagWidget.suggestionsRow);

  // 备注
  const notesLabel = document.createElement('label');
  notesLabel.className = 'nc-field-label';
  notesLabel.textContent = '备注';

  const notesInput = document.createElement('textarea');
  notesInput.className = 'nc-notes-input';
  notesInput.setAttribute('data-testid', 'nc-notes-input');
  notesInput.placeholder = '添加备注…';
  notesInput.rows = 2;
  createSection.append(notesLabel, notesInput);

  body.appendChild(createSection);

  // ── 追加模式区域（初始隐藏）──
  const appendSection = document.createElement('div');
  appendSection.className = 'nc-append-section';
  appendSection.setAttribute('data-testid', 'nc-append-section');
  appendSection.hidden = true;

  const pageLabel = document.createElement('label');
  pageLabel.className = 'nc-field-label';
  pageLabel.textContent = '目标页面';

  const pageSelectWrapper = document.createElement('div');
  pageSelectWrapper.className = 'nc-select-wrapper';

  const pageSelect = document.createElement('select');
  pageSelect.className = 'nc-select';
  pageSelect.setAttribute('data-testid', 'nc-page-select');
  pageSelect.innerHTML = '<option value="">— 请先选择数据库 —</option>';

  pageSelectWrapper.appendChild(pageSelect);

  // 内容预览（追加模式下显示只读预览）
  const appendPreview = document.createElement('div');
  appendPreview.className = 'nc-toast-preview nc-preview';
  const previewText = selectionText.length > 200
    ? selectionText.slice(0, 200) + '…'
    : selectionText;
  appendPreview.textContent = previewText;

  appendSection.append(pageLabel, pageSelectWrapper, appendPreview);
  body.appendChild(appendSection);

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

  return {
    liveRegion, saveBtn, cancelBtn, select,
    contentTextarea, tagWidget, notesInput, titleInput,
    modeRadios, createSection, appendSection, pageSelect,
  };
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
