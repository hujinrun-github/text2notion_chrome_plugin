/**
 * background.js
 * Chrome Extension Service Worker — Manifest V3
 *
 * 职责：
 * 1. onInstalled → 注册右键菜单
 * 2. contextMenus.onClicked → 向内容脚本发送 processSelectedText 消息
 * 3. runtime.onMessage → 处理以下消息类型：
 *    - fetchDatabases    获取 Notion Database 列表
 *    - saveToNotion      保存选中文本到 Notion
 *    - updateNotionPage  更新 Notion 页面属性
 */

import {
  STORAGE_KEY_TOKEN,
  STORAGE_KEY_DATABASES,
  STORAGE_KEY_AUTO_CREATE_FIELDS,
  CONTEXT_MENU_ID,
  PRESET_MAPPINGS,
} from './utils/config.js';

import { fetchDatabases, createPage, updatePage, buildProperties, ensureDatabaseProperties, getDatabaseSchema, getDatabaseTags } from './utils/notion-api.js';

// ─────────────────────────────────────────────────────────────
// 右键菜单注册
// ─────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: '保存到 Notion',
    contexts: ['selection'],
  });
});

// ─────────────────────────────────────────────────────────────
// 右键菜单点击
// ─────────────────────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;

  chrome.tabs.sendMessage(
    tab.id,
    {
      type: 'processSelectedText',
      selectionText: info.selectionText,
      pageUrl: info.pageUrl,
      pageTitle: tab.title,
    },
    () => {
      // 消费 lastError，避免 "Unchecked runtime.lastError" 控制台警告。
      // chrome:// 等受限页面无法注入 content script，属于正常情况，静默忽略。
      void chrome.runtime.lastError;
    }
  );
});

// ─────────────────────────────────────────────────────────────
// 消息路由
// ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'fetchDatabases':
      handleFetchDatabases(sendResponse).catch(err =>
        sendResponse({ error: err.message })
      );
      return true;

    case 'saveToNotion':
      handleSaveToNotion(message, sendResponse).catch(err =>
        sendResponse({ success: false, error: err.message })
      );
      return true;

    case 'updateNotionPage':
      handleUpdateNotionPage(message, sendResponse).catch(err =>
        sendResponse({ success: false, error: err.message })
      );
      return true;

    case 'fetchDatabaseTags':
      handleFetchDatabaseTags(message, sendResponse).catch(err =>
        sendResponse({ tags: [], error: err.message })
      );
      return true;

    default:
      return false;
  }
});

// ─────────────────────────────────────────────────────────────
// Handler: fetchDatabases
// ─────────────────────────────────────────────────────────────
async function handleFetchDatabases(sendResponse) {
  try {
    const storage = await chrome.storage.local.get(STORAGE_KEY_TOKEN);
    const token = storage[STORAGE_KEY_TOKEN];

    if (!token) {
      sendResponse({ error: '未登录，请先连接 Notion' });
      return;
    }

    const databases = await fetchDatabases(token);
    await chrome.storage.local.set({ [STORAGE_KEY_DATABASES]: databases });
    sendResponse({ databases });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────
// Handler: saveToNotion
// ─────────────────────────────────────────────────────────────
async function handleSaveToNotion(message, sendResponse) {
  const { databaseId, selectedText, pageUrl, pageTitle } = message;

  try {
    const storage = await chrome.storage.local.get([
      STORAGE_KEY_TOKEN,
      STORAGE_KEY_DATABASES,
      STORAGE_KEY_AUTO_CREATE_FIELDS,
    ]);
    const token = storage[STORAGE_KEY_TOKEN];

    if (!token) {
      sendResponse({ success: false, error: '未登录，请先连接 Notion' });
      return;
    }

    // 解析字段映射
    const databases = storage[STORAGE_KEY_DATABASES] || [];
    const dbConfig = databases.find(db => db.id === databaseId);
    const template = dbConfig?.mappingTemplate || 'preset-a';
    let fieldMapping;

    if (template === 'custom' && dbConfig?.customMapping) {
      // 自定义映射：只取 enabled 的字段
      fieldMapping = {};
      for (const [key, cfg] of Object.entries(dbConfig.customMapping)) {
        if (cfg.enabled && cfg.field) {
          fieldMapping[key] = cfg.field;
        }
      }
    } else {
      fieldMapping = PRESET_MAPPINGS[template] || PRESET_MAPPINGS['preset-a'];
    }

    const autoCreateFields = storage[STORAGE_KEY_AUTO_CREATE_FIELDS] || false;

    const fields = {
      title: pageTitle || pageUrl || '未命名',
      content: selectedText,
      sourceUrl: pageUrl,
      capturedAt: new Date().toISOString(),
      tags: message.tags || [],
      notes: message.notes || '',
    };

    const page = await createPage(token, databaseId, fields, {
      fieldMapping,
      autoCreateFields,
    });

    const lastSaved = {
      pageId: page.id,
      pageUrl: page.url,
      databaseId,
      savedAt: Date.now(),
      sourceUrl: pageUrl,
      sourceTitle: pageTitle,
    };

    await chrome.storage.local.set({ lastSaved });
    sendResponse({ success: true, pageId: page.id, pageUrl: page.url });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────
// Handler: updateNotionPage
// ─────────────────────────────────────────────────────────────
async function handleUpdateNotionPage(message, sendResponse) {
  const { pageId, fields } = message;

  try {
    const storage = await chrome.storage.local.get([
      STORAGE_KEY_TOKEN,
      STORAGE_KEY_DATABASES,
      STORAGE_KEY_AUTO_CREATE_FIELDS,
      'lastSaved',
    ]);
    const token = storage[STORAGE_KEY_TOKEN];

    if (!token) {
      sendResponse({ success: false, error: '未登录，请先连接 Notion' });
      return;
    }

    // 从 lastSaved 中获取 databaseId，再查找对应的映射配置
    const databaseId = storage.lastSaved?.databaseId;
    const databases = storage[STORAGE_KEY_DATABASES] || [];
    const dbConfig = databases.find(db => db.id === databaseId);
    const template = dbConfig?.mappingTemplate || 'preset-a';
    const autoCreateFields = storage[STORAGE_KEY_AUTO_CREATE_FIELDS] || false;

    let fieldMapping;
    if (template === 'custom' && dbConfig?.customMapping) {
      fieldMapping = {};
      for (const [key, cfg] of Object.entries(dbConfig.customMapping)) {
        if (cfg.enabled && cfg.field) {
          fieldMapping[key] = cfg.field;
        }
      }
    } else {
      fieldMapping = PRESET_MAPPINGS[template] || PRESET_MAPPINGS['preset-a'];
    }

    // 查询数据库 schema，确定哪些字段存在
    let schema = null;
    if (databaseId) {
      schema = await getDatabaseSchema(token, databaseId);

      // 如果开启了自动创建，先确保字段存在
      if (autoCreateFields && schema) {
        try {
          await ensureDatabaseProperties(token, databaseId, fieldMapping, schema);
          // 创建后重新获取 schema
          schema = await getDatabaseSchema(token, databaseId);
        } catch (e) {
          // 创建字段失败不阻断更新
        }
      }
    }

    // 用 buildProperties 将 { tags, notes } 转为 Notion 格式
    let properties = buildProperties(fields, fieldMapping);

    // 过滤掉数据库中不存在的字段，避免 Notion 静默忽略
    if (schema) {
      const existingNames = new Set(Object.keys(schema));
      const filtered = {};
      for (const [propName, propValue] of Object.entries(properties)) {
        if (existingNames.has(propName)) {
          filtered[propName] = propValue;
        }
      }
      properties = filtered;
    }

    if (Object.keys(properties).length === 0) {
      sendResponse({
        success: false,
        error: '数据库中没有对应的字段（如 Tags、Notes），请在设置中勾选「自动创建缺失字段」或手动在 Notion 中添加',
      });
      return;
    }

    await updatePage(token, pageId, properties);
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────
// Helper: 根据 databaseId 解析字段映射
// ─────────────────────────────────────────────────────────────
function resolveFieldMapping(databases, databaseId) {
  const dbConfig = databases.find(db => db.id === databaseId);
  const template = dbConfig?.mappingTemplate || 'preset-a';
  if (template === 'custom' && dbConfig?.customMapping) {
    const mapping = {};
    for (const [key, cfg] of Object.entries(dbConfig.customMapping)) {
      if (cfg.enabled && cfg.field) {
        mapping[key] = cfg.field;
      }
    }
    return mapping;
  }
  return PRESET_MAPPINGS[template] || PRESET_MAPPINGS['preset-a'];
}

// ─────────────────────────────────────────────────────────────
// Handler: fetchDatabaseTags
// ─────────────────────────────────────────────────────────────
async function handleFetchDatabaseTags(message, sendResponse) {
  const { databaseId } = message;

  try {
    const storage = await chrome.storage.local.get([
      STORAGE_KEY_TOKEN,
      STORAGE_KEY_DATABASES,
    ]);
    const token = storage[STORAGE_KEY_TOKEN];

    if (!token) {
      sendResponse({ tags: [], error: '未登录' });
      return;
    }

    const databases = storage[STORAGE_KEY_DATABASES] || [];
    const fieldMapping = resolveFieldMapping(databases, databaseId);
    const tagsPropertyName = fieldMapping.tags || 'Tags';

    const tags = await getDatabaseTags(token, databaseId, tagsPropertyName);
    sendResponse({ tags });
  } catch (err) {
    sendResponse({ tags: [], error: err.message });
  }
}
