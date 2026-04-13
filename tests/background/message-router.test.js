/**
 * tests/background/message-router.test.js
 * TDD: background.js 消息路由（fetchDatabases、saveToNotion、updateNotionPage、右键菜单）测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/config.js', () => ({
  NOTION_VERSION: '2022-06-28',
  NOTION_API_BASE: 'https://api.notion.com/v1',
  STORAGE_KEY_TOKEN: 'notionAccessToken',
  STORAGE_KEY_DATABASES: 'notionDatabases',
  STORAGE_KEY_DEFAULT_DB: 'notionDefaultDatabase',
  STORAGE_KEY_FIELD_MAP: 'notionFieldMap',
  STORAGE_KEY_AUTO_CREATE_FIELDS: 'notionAutoCreateFields',
  CONTEXT_MENU_ID: 'save-to-notion',
  PRESET_MAPPINGS: {
    'preset-a': { title: 'Title', content: 'Content', sourceUrl: 'Source URL', capturedAt: 'Captured At', tags: 'Tags', notes: 'Notes' },
  },
}));

vi.mock('../../utils/notion-api.js', () => ({
  fetchDatabases: vi.fn(),
  createPage: vi.fn(),
  updatePage: vi.fn(),
  buildProperties: vi.fn().mockReturnValue({}),
  ensureDatabaseProperties: vi.fn().mockResolvedValue(undefined),
  getDatabaseSchema: vi.fn().mockResolvedValue(null),
}));

import * as notionApi from '../../utils/notion-api.js';

// background.js は side-effect で addListener を登録するため先にロードする
await import('../../background.js');

/**
 * chrome.runtime.onMessage に登録されたリスナーを呼び出す
 * sendResponse が呼ばれたら Promise が解決する
 */
function triggerMessage(message) {
  return new Promise((resolve) => {
    // _listeners は vi.clearAllMocks() の影響を受けない永続配列
    for (const fn of chrome.runtime.onMessage._listeners) {
      fn(message, {}, resolve);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// fetchDatabases 消息
// ─────────────────────────────────────────────────────────────
describe('消息：fetchDatabases', () => {
  it('从 storage 读取 access_token 后调用 fetchDatabases()', async () => {
    chrome.storage.local.get.mockResolvedValue({ notionAccessToken: 'tok-xyz' });
    notionApi.fetchDatabases.mockResolvedValue([{ id: 'db1', name: 'DB1', icon: '📄' }]);

    await triggerMessage({ type: 'fetchDatabases' });

    expect(notionApi.fetchDatabases).toHaveBeenCalledWith('tok-xyz');
  });

  it('将结果存入 chrome.storage.local 并回调 { databases }', async () => {
    const fakeDbs = [{ id: 'db1', name: 'DB1', icon: '📄' }];
    chrome.storage.local.get.mockResolvedValue({ notionAccessToken: 'tok-xyz' });
    notionApi.fetchDatabases.mockResolvedValue(fakeDbs);

    const response = await triggerMessage({ type: 'fetchDatabases' });

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ notionDatabases: fakeDbs })
    );
    expect(response).toMatchObject({ databases: fakeDbs });
  });

  it('storage 中无 access_token 时，回调 { error: "未登录" }', async () => {
    chrome.storage.local.get.mockResolvedValue({});

    const response = await triggerMessage({ type: 'fetchDatabases' });

    expect(response).toMatchObject({ error: expect.stringContaining('未登录') });
    expect(notionApi.fetchDatabases).not.toHaveBeenCalled();
  });

  it('notion-api 抛出异常时，回调 { error }', async () => {
    chrome.storage.local.get.mockResolvedValue({ notionAccessToken: 'tok-xyz' });
    notionApi.fetchDatabases.mockRejectedValue(new Error('Network error'));

    const response = await triggerMessage({ type: 'fetchDatabases' });

    expect(response).toMatchObject({ error: expect.stringContaining('Network error') });
  });
});

// ─────────────────────────────────────────────────────────────
// saveToNotion 消息
// ─────────────────────────────────────────────────────────────
describe('消息：saveToNotion', () => {
  const saveMsg = {
    type: 'saveToNotion',
    databaseId: 'db-test-id',
    selectedText: 'Hello World',
    pageUrl: 'https://example.com',
    pageTitle: 'Example Page',
  };

  it('调用 createPage 并传入正确参数', async () => {
    chrome.storage.local.get.mockResolvedValue({
      notionAccessToken: 'tok-save',
      notionDatabases: [],
      notionAutoCreateFields: false,
    });
    notionApi.createPage.mockResolvedValue({ id: 'page-new', url: 'https://notion.so/page-new' });

    await triggerMessage(saveMsg);

    expect(notionApi.createPage).toHaveBeenCalledWith(
      'tok-save',
      'db-test-id',
      expect.objectContaining({ content: 'Hello World' }),
      expect.objectContaining({ fieldMapping: expect.any(Object) })
    );
  });

  it('成功时将 lastSaved 存入 storage，回调 { success: true, pageId, pageUrl }', async () => {
    chrome.storage.local.get.mockResolvedValue({
      notionAccessToken: 'tok-save',
      notionDatabases: [],
      notionAutoCreateFields: false,
    });
    notionApi.createPage.mockResolvedValue({ id: 'page-new', url: 'https://notion.so/page-new' });

    const response = await triggerMessage(saveMsg);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastSaved: expect.any(Object) })
    );
    expect(response).toMatchObject({
      success: true,
      pageId: 'page-new',
      pageUrl: 'https://notion.so/page-new',
    });
  });

  it('storage 中无 access_token 时，回调 { success: false, error }', async () => {
    chrome.storage.local.get.mockResolvedValue({});

    const response = await triggerMessage(saveMsg);

    expect(response).toMatchObject({ success: false });
    expect(response.error).toBeTruthy();
  });

  it('notion-api 抛出异常时，回调 { success: false, error }', async () => {
    chrome.storage.local.get.mockResolvedValue({
      notionAccessToken: 'tok-save',
      notionDatabases: [],
      notionAutoCreateFields: false,
    });
    notionApi.createPage.mockRejectedValue(new Error('Notion API failed'));

    const response = await triggerMessage(saveMsg);

    expect(response).toMatchObject({ success: false });
    expect(response.error).toContain('Notion API failed');
  });
});

// ─────────────────────────────────────────────────────────────
// updateNotionPage 消息
// ─────────────────────────────────────────────────────────────
describe('消息：updateNotionPage', () => {
  const updateMsg = {
    type: 'updateNotionPage',
    pageId: 'page-exist-id',
    fields: { tags: ['tag1', 'tag2'], notes: 'My note' },
  };

  const updateStorageMock = {
    notionAccessToken: 'tok-upd',
    notionDatabases: [],
    notionAutoCreateFields: false,
    lastSaved: { databaseId: 'db-1' },
  };

  // getDatabaseSchema 返回包含 Tags/Notes 的 schema
  const fakeSchema = {
    Title: { type: 'title' },
    Tags: { type: 'multi_select' },
    Notes: { type: 'rich_text' },
  };

  it('调用 updatePage 并传入 pageId 和转换后的 properties', async () => {
    chrome.storage.local.get.mockResolvedValue(updateStorageMock);
    notionApi.getDatabaseSchema.mockResolvedValue(fakeSchema);
    notionApi.buildProperties.mockReturnValue({ Tags: { multi_select: [{ name: 'tag1' }] } });
    notionApi.updatePage.mockResolvedValue({ id: 'page-exist-id' });

    await triggerMessage(updateMsg);

    expect(notionApi.buildProperties).toHaveBeenCalled();
    expect(notionApi.updatePage).toHaveBeenCalledWith(
      'tok-upd',
      'page-exist-id',
      expect.any(Object)
    );
  });

  it('成功时回调 { success: true }', async () => {
    chrome.storage.local.get.mockResolvedValue(updateStorageMock);
    notionApi.getDatabaseSchema.mockResolvedValue(fakeSchema);
    notionApi.buildProperties.mockReturnValue({ Tags: { multi_select: [] } });
    notionApi.updatePage.mockResolvedValue({ id: 'page-exist-id' });

    const response = await triggerMessage(updateMsg);

    expect(response).toMatchObject({ success: true });
  });

  it('失败时回调 { success: false, error }', async () => {
    chrome.storage.local.get.mockResolvedValue(updateStorageMock);
    notionApi.getDatabaseSchema.mockResolvedValue(fakeSchema);
    notionApi.buildProperties.mockReturnValue({ Tags: { multi_select: [] } });
    notionApi.updatePage.mockRejectedValue(new Error('Update failed'));

    const response = await triggerMessage(updateMsg);

    expect(response).toMatchObject({ success: false });
    expect(response.error).toContain('Update failed');
  });
});

// ─────────────────────────────────────────────────────────────
// 右键菜单注册
// ─────────────────────────────────────────────────────────────
describe('右键菜单注册', () => {
  it('onInstalled 时调用 chrome.contextMenus.create，id 为 "save-to-notion"', () => {
    // _listeners は vi.clearAllMocks() の影響を受けない永続配列
    const listeners = chrome.runtime.onInstalled._listeners;
    expect(listeners.length).toBeGreaterThan(0);

    // Simulate onInstalled event
    listeners[0]({ reason: 'install' });

    expect(chrome.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'save-to-notion' })
    );
  });
});

// ─────────────────────────────────────────────────────────────
// 右键菜单点击
// ─────────────────────────────────────────────────────────────
describe('右键菜单点击', () => {
  it('向当前 tab 发送 processSelectedText 消息，携带 selectionText、pageUrl、pageTitle', () => {
    const fakeInfo = {
      menuItemId: 'save-to-notion',
      selectionText: 'Selected text here',
      pageUrl: 'https://example.com',
    };
    const fakeTab = { id: 42, title: 'Example Page' };

    // _listeners は vi.clearAllMocks() の影響を受けない永続配列
    const listeners = chrome.contextMenus.onClicked._listeners;
    expect(listeners.length).toBeGreaterThan(0);
    listeners[0](fakeInfo, fakeTab);

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: 'processSelectedText',
        selectionText: 'Selected text here',
        pageUrl: 'https://example.com',
        pageTitle: 'Example Page',
      }),
      expect.any(Function)
    );
  });
});
