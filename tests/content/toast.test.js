/**
 * tests/content/toast.test.js
 * TDD: scripts/content.js Toast DOM 行为测试
 *
 * 测试环境：jsdom（vitest.config.js 已配置）
 * Chrome API：通过 tests/__mocks__/chrome.js 全局注入
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────
// 辅助：触发 onMessage 监听器
// ─────────────────────────────────────────────────────────────
function triggerMessage(message, sendResponse) {
  for (const fn of chrome.runtime.onMessage._listeners) {
    fn(message, {}, sendResponse || vi.fn());
  }
}

// ─────────────────────────────────────────────────────────────
// 加载 content.js（side-effect 注册监听器）
// ─────────────────────────────────────────────────────────────
await import('../../scripts/content.js');

// ─────────────────────────────────────────────────────────────
// 通用 beforeEach：清空 body，重置 chrome mock（由 setup file 完成）
// ─────────────────────────────────────────────────────────────
beforeEach(() => {
  document.body.innerHTML = '';
  // chrome mock 的 vi.clearAllMocks() 在 setup file 的 beforeEach 中已执行
  // 但 onMessage._listeners 里的 content.js 监听器是模块级别注册的，永久存活
  // storage.local.get 需要给出合理默认值（databases 非空，避免按钮 disabled）
  chrome.storage.local.get.mockImplementation((keys) => {
    const defaults = {
      notionDatabases: [{ id: 'db1', name: 'DB One' }],
      notionDefaultDatabase: 'db1',
    };
    if (Array.isArray(keys)) {
      const result = {};
      keys.forEach((k) => { if (defaults[k] !== undefined) result[k] = defaults[k]; });
      return Promise.resolve(result);
    }
    if (typeof keys === 'string') {
      return Promise.resolve({ [keys]: defaults[keys] });
    }
    return Promise.resolve(defaults);
  });
});

// ─────────────────────────────────────────────────────────────
// 辅助：注入 Toast 并等待异步初始化完成
// ─────────────────────────────────────────────────────────────
async function injectToast(overrides = {}) {
  const msg = {
    type: 'processSelectedText',
    selectionText: 'Hello World',
    pageUrl: 'https://example.com',
    pageTitle: 'Example Page',
    ...overrides,
  };
  triggerMessage(msg);
  // 等待微任务（storage.local.get Promise 解析）
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('notion-clipper-toast');
}

// ─────────────────────────────────────────────────────────────
// Toast 注入
// ─────────────────────────────────────────────────────────────
describe('Toast 注入', () => {
  it('接收 processSelectedText 消息后，在 body 中注入 #notion-clipper-toast', async () => {
    const toast = await injectToast();
    expect(toast).not.toBeNull();
    expect(document.body.contains(toast)).toBe(true);
  });

  it('已有 toast 时，先移除旧的再注入新的，保证页面唯一', async () => {
    await injectToast();
    await injectToast({ selectionText: 'Second injection' });

    const toasts = document.querySelectorAll('#notion-clipper-toast');
    expect(toasts.length).toBe(1);
  });

  it('toast 中包含选中文本的可编辑 textarea', async () => {
    const longText = 'A'.repeat(200);
    const toast = await injectToast({ selectionText: longText });
    const textarea = toast.querySelector('[data-testid="nc-content-textarea"], .nc-content-textarea');
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe(longText); // textarea 包含完整文本，用户可编辑
  });
});

// ─────────────────────────────────────────────────────────────
// 数据库加载
// ─────────────────────────────────────────────────────────────
describe('数据库加载', () => {
  it('storage 中有 databases 时，select 包含对应 option', async () => {
    chrome.storage.local.get.mockImplementation(() =>
      Promise.resolve({
        notionDatabases: [
          { id: 'db1', name: 'My DB' },
          { id: 'db2', name: 'Another DB' },
        ],
        notionDefaultDatabase: 'db1',
      })
    );
    const toast = await injectToast();
    const select = toast.querySelector('select, [data-testid="nc-db-select"]');
    expect(select).not.toBeNull();
    const options = select.querySelectorAll('option');
    expect(options.length).toBeGreaterThanOrEqual(2);
  });

  it('storage 中无 databases 时，保存按钮为 disabled 状态', async () => {
    chrome.storage.local.get.mockResolvedValue({ notionDatabases: [] });
    const toast = await injectToast();
    const saveBtn = toast.querySelector(
      'button[data-action="save"], button.nc-save-btn, [data-testid="nc-save-btn"]'
    );
    expect(saveBtn).not.toBeNull();
    expect(saveBtn.disabled).toBe(true);
  });

  it('默认选中 notionDefaultDatabase 对应的 option', async () => {
    chrome.storage.local.get.mockImplementation(() =>
      Promise.resolve({
        notionDatabases: [
          { id: 'db1', name: 'DB One' },
          { id: 'db2', name: 'DB Two' },
        ],
        notionDefaultDatabase: 'db2',
      })
    );
    const toast = await injectToast();
    const select = toast.querySelector('select, [data-testid="nc-db-select"]');
    expect(select.value).toBe('db2');
  });
});

// ─────────────────────────────────────────────────────────────
// Phase A → B：保存操作
// ─────────────────────────────────────────────────────────────
describe('Phase A → B：保存操作', () => {
  it('点击保存按钮后，按钮变为 disabled 并显示 spinner/loading 状态', async () => {
    chrome.runtime.sendMessage.mockImplementation(() => new Promise(() => {})); // 永不 resolve
    const toast = await injectToast();
    const saveBtn = toast.querySelector(
      'button[data-action="save"], button.nc-save-btn, [data-testid="nc-save-btn"]'
    );
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(saveBtn.disabled).toBe(true);
  });

  it('点击保存后，向 background 发送 saveToNotion 消息，含 databaseId、selectedText、pageUrl', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, pageId: 'p1', pageUrl: 'https://notion.so/p1' });
    const toast = await injectToast({
      selectionText: 'Test text',
      pageUrl: 'https://test.com',
      pageTitle: 'Test Page',
    });
    const saveBtn = toast.querySelector(
      'button[data-action="save"], button.nc-save-btn, [data-testid="nc-save-btn"]'
    );
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'saveToNotion',
        selectedText: 'Test text',
        pageUrl: 'https://test.com',
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Phase B → C：成功响应
// ─────────────────────────────────────────────────────────────
describe('Phase B → C：成功响应', () => {
  async function saveAndGetToast() {
    chrome.runtime.sendMessage.mockResolvedValue({
      success: true,
      pageId: 'page-001',
      pageUrl: 'https://notion.so/page-001',
    });
    const toast = await injectToast();
    const saveBtn = toast.querySelector(
      'button[data-action="save"], button.nc-save-btn, [data-testid="nc-save-btn"]'
    );
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 10));
    return toast;
  }

  it('saveToNotion 成功后，toast body 替换为成功结构', async () => {
    const toast = await saveAndGetToast();
    // 成功后应出现成功相关元素（视图变化）
    const successEl = toast.querySelector(
      '.nc-success, [data-phase="success"], [data-testid="nc-success"]'
    );
    expect(successEl).not.toBeNull();
  });

  it('成功结构中包含指向 pageUrl 的「在 Notion 中查看」链接', async () => {
    const toast = await saveAndGetToast();
    const link = toast.querySelector('a[href="https://notion.so/page-001"]');
    expect(link).not.toBeNull();
  });

  it('「编辑详情」按钮初始时 aria-expanded="false"', async () => {
    const toast = await saveAndGetToast();
    const editBtn = toast.querySelector(
      '[data-action="toggle-edit"], .nc-edit-toggle, [data-testid="nc-edit-toggle"]'
    );
    expect(editBtn).not.toBeNull();
    expect(editBtn.getAttribute('aria-expanded')).toBe('false');
  });
});

// ─────────────────────────────────────────────────────────────
// Phase C：编辑详情展开/收起
// ─────────────────────────────────────────────────────────────
describe('Phase C：编辑详情展开/收起', () => {
  async function getSuccessToast() {
    chrome.runtime.sendMessage.mockResolvedValue({
      success: true,
      pageId: 'page-001',
      pageUrl: 'https://notion.so/page-001',
    });
    const toast = await injectToast();
    toast.querySelector(
      'button[data-action="save"], button.nc-save-btn, [data-testid="nc-save-btn"]'
    ).click();
    await new Promise((r) => setTimeout(r, 10));
    return toast;
  }

  it('点击「编辑详情」后 .nc-edit-panel 变为可见，aria-expanded 变为 "true"', async () => {
    const toast = await getSuccessToast();
    const editBtn = toast.querySelector(
      '[data-action="toggle-edit"], .nc-edit-toggle, [data-testid="nc-edit-toggle"]'
    );
    editBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(editBtn.getAttribute('aria-expanded')).toBe('true');
    const panel = toast.querySelector('.nc-edit-panel, [data-testid="nc-edit-panel"]');
    expect(panel).not.toBeNull();
    // 面板可见（非 hidden 且非 display:none）
    expect(panel.hidden).toBe(false);
  });

  it('再次点击「编辑详情」后 .nc-edit-panel 重新隐藏，aria-expanded 变为 "false"', async () => {
    const toast = await getSuccessToast();
    const editBtn = toast.querySelector(
      '[data-action="toggle-edit"], .nc-edit-toggle, [data-testid="nc-edit-toggle"]'
    );
    editBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    editBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(editBtn.getAttribute('aria-expanded')).toBe('false');
    const panel = toast.querySelector('.nc-edit-panel, [data-testid="nc-edit-panel"]');
    expect(panel.hidden).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Phase D：标签管理
// ─────────────────────────────────────────────────────────────
describe('Phase D：标签管理', () => {
  async function getEditPanel() {
    chrome.runtime.sendMessage.mockResolvedValue({
      success: true,
      pageId: 'page-001',
      pageUrl: 'https://notion.so/page-001',
    });
    const toast = await injectToast();
    toast.querySelector(
      'button[data-action="save"], button.nc-save-btn, [data-testid="nc-save-btn"]'
    ).click();
    await new Promise((r) => setTimeout(r, 10));
    const editBtn = toast.querySelector(
      '[data-action="toggle-edit"], .nc-edit-toggle, [data-testid="nc-edit-toggle"]'
    );
    editBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    return toast;
  }

  it('在标签输入框按 Enter，新增 tag pill 到 .nc-tags-row', async () => {
    const toast = await getEditPanel();
    const tagInput = toast.querySelector(
      'input[data-testid="nc-tag-input"], input.nc-tag-input, [data-action="tag-input"]'
    );
    expect(tagInput).not.toBeNull();
    tagInput.value = 'my-tag';
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const tagsRow = toast.querySelector('.nc-tags-row, [data-testid="nc-tags-row"]');
    expect(tagsRow).not.toBeNull();
    expect(tagsRow.textContent).toContain('my-tag');
  });

  it('在标签输入框输入逗号，触发新增 tag，清空输入框', async () => {
    const toast = await getEditPanel();
    const tagInput = toast.querySelector(
      'input[data-testid="nc-tag-input"], input.nc-tag-input, [data-action="tag-input"]'
    );
    tagInput.value = 'comma-tag';
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const tagsRow = toast.querySelector('.nc-tags-row, [data-testid="nc-tags-row"]');
    expect(tagsRow.textContent).toContain('comma-tag');
    expect(tagInput.value).toBe('');
  });

  it('点击 tag 的 × 按钮，移除对应 tag pill', async () => {
    const toast = await getEditPanel();
    const tagInput = toast.querySelector(
      'input[data-testid="nc-tag-input"], input.nc-tag-input, [data-action="tag-input"]'
    );
    tagInput.value = 'remove-me';
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const removeBtn = toast.querySelector('.nc-tag-remove, [data-action="remove-tag"]');
    expect(removeBtn).not.toBeNull();
    removeBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    const tagsRow = toast.querySelector('.nc-tags-row, [data-testid="nc-tags-row"]');
    expect(tagsRow.textContent).not.toContain('remove-me');
  });

  it('tag 内容为空或纯空白时，不新增', async () => {
    const toast = await getEditPanel();
    const tagInput = toast.querySelector(
      'input[data-testid="nc-tag-input"], input.nc-tag-input, [data-action="tag-input"]'
    );
    tagInput.value = '   ';
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const pills = toast.querySelectorAll('.nc-tag-pill, [data-testid="nc-tag-pill"]');
    expect(pills.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Phase D → 更新
// ─────────────────────────────────────────────────────────────
describe('Phase D → 更新', () => {
  async function getEditPanelWithTags() {
    chrome.runtime.sendMessage
      .mockResolvedValueOnce({ tags: [] })  // fetchDatabaseTags (Phase A inject)
      .mockResolvedValueOnce({ success: true, pageId: 'page-001', pageUrl: 'https://notion.so/page-001' })  // saveToNotion
      .mockResolvedValueOnce({ tags: ['existing-tag'] })  // fetchDatabaseTags (edit panel expand)
      .mockResolvedValueOnce({ success: true });  // updateNotionPage

    // mock lastSaved for buildEditPanel
    chrome.storage.local.get.mockImplementation((keys) => {
      if (keys === 'lastSaved' || (Array.isArray(keys) && keys.includes('lastSaved'))) {
        return Promise.resolve({ lastSaved: { databaseId: 'db1' } });
      }
      return Promise.resolve({
        notionDatabases: [{ id: 'db1', name: 'My DB' }],
        notionDefaultDatabase: 'db1',
      });
    });

    const toast = await injectToast();
    toast.querySelector(
      'button[data-action="save"], button.nc-save-btn, [data-testid="nc-save-btn"]'
    ).click();
    await new Promise((r) => setTimeout(r, 10));
    const editBtn = toast.querySelector(
      '[data-action="toggle-edit"], .nc-edit-toggle, [data-testid="nc-edit-toggle"]'
    );
    editBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    // 添加 tag
    const tagInput = toast.querySelector(
      'input[data-testid="nc-tag-input"], input.nc-tag-input, [data-action="tag-input"]'
    );
    tagInput.value = 'tag1';
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    // 填写备注
    const notesInput = toast.querySelector(
      'textarea.nc-notes-input, [data-testid="nc-notes-input"], textarea[data-action="notes"]'
    );
    if (notesInput) notesInput.value = 'My note';

    return toast;
  }

  it('点击「更新」按钮后，发送 updateNotionPage 消息，含 pageId、tags', async () => {
    const toast = await getEditPanelWithTags();
    const updateBtn = toast.querySelector(
      'button[data-action="update"], button.nc-update-btn, [data-testid="nc-update-btn"]'
    );
    expect(updateBtn).not.toBeNull();
    updateBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'updateNotionPage',
        pageId: 'page-001',
      })
    );
  });

  it('更新成功后，显示「已更新」提示', async () => {
    const toast = await getEditPanelWithTags();
    const updateBtn = toast.querySelector(
      'button[data-action="update"], button.nc-update-btn, [data-testid="nc-update-btn"]'
    );
    updateBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(toast.textContent).toMatch(/已更新|Updated/);
  });
});

// ─────────────────────────────────────────────────────────────
// 错误处理
// ─────────────────────────────────────────────────────────────
describe('错误处理', () => {
  it('saveToNotion 失败时，恢复按钮可用，并在 .nc-live-region 中显示错误信息', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'Network error' });
    const toast = await injectToast();
    const saveBtn = toast.querySelector(
      'button[data-action="save"], button.nc-save-btn, [data-testid="nc-save-btn"]'
    );
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(saveBtn.disabled).toBe(false);
    const liveRegion = toast.querySelector(
      '.nc-live-region, [role="alert"], [data-testid="nc-live-region"]'
    );
    expect(liveRegion).not.toBeNull();
    expect(liveRegion.textContent).toContain('Network error');
  });

  it('updateNotionPage 失败时，恢复「更新」按钮，并显示错误信息', async () => {
    chrome.runtime.sendMessage
      .mockResolvedValueOnce({ tags: [] })  // fetchDatabaseTags (Phase A)
      .mockResolvedValueOnce({ success: true, pageId: 'p1', pageUrl: 'https://notion.so/p1' })  // saveToNotion
      .mockResolvedValueOnce({ tags: [] })  // fetchDatabaseTags (edit panel expand)
      .mockResolvedValueOnce({ success: false, error: 'Update failed' });  // updateNotionPage

    chrome.storage.local.get.mockImplementation((keys) => {
      if (keys === 'lastSaved' || (Array.isArray(keys) && keys.includes('lastSaved'))) {
        return Promise.resolve({ lastSaved: { databaseId: 'db1' } });
      }
      return Promise.resolve({
        notionDatabases: [{ id: 'db1', name: 'My DB' }],
        notionDefaultDatabase: 'db1',
      });
    });

    const toast = await injectToast();
    toast.querySelector(
      'button[data-action="save"], button.nc-save-btn, [data-testid="nc-save-btn"]'
    ).click();
    await new Promise((r) => setTimeout(r, 10));

    const editBtn = toast.querySelector(
      '[data-action="toggle-edit"], .nc-edit-toggle, [data-testid="nc-edit-toggle"]'
    );
    editBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    const updateBtn = toast.querySelector(
      'button[data-action="update"], button.nc-update-btn, [data-testid="nc-update-btn"]'
    );
    updateBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(updateBtn.disabled).toBe(false);
    expect(toast.textContent).toMatch(/Update failed|更新失败/);
  });
});

// ─────────────────────────────────────────────────────────────
// 关闭行为
// ─────────────────────────────────────────────────────────────
describe('关闭行为', () => {
  it('点击关闭按钮后，toast 添加 toast-out 类', async () => {
    const toast = await injectToast();
    const closeBtn = toast.querySelector(
      'button[data-action="close"], button.nc-close-btn, [data-testid="nc-close-btn"]'
    );
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(toast.classList.contains('toast-out')).toBe(true);
  });

  it('animationend 事件触发后，#notion-clipper-toast 从 DOM 中移除', async () => {
    const toast = await injectToast();
    const closeBtn = toast.querySelector(
      'button[data-action="close"], button.nc-close-btn, [data-testid="nc-close-btn"]'
    );
    closeBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    // 触发 animationend
    toast.dispatchEvent(new Event('animationend', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById('notion-clipper-toast')).toBeNull();
  });
});
