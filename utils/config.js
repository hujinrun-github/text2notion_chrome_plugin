/**
 * utils/config.js
 * 全局常量配置
 */

/** Notion API 版本 */
export const NOTION_VERSION = '2022-06-28';

/** Notion API 基础 URL */
export const NOTION_API_BASE = 'https://api.notion.com/v1';

/** chrome.storage.local 中存储 token 的 key */
export const STORAGE_KEY_TOKEN = 'notionAccessToken';

/** chrome.storage.local 中存储数据库列表的 key */
export const STORAGE_KEY_DATABASES = 'notionDatabases';

/** chrome.storage.local 中存储默认数据库 ID 的 key */
export const STORAGE_KEY_DEFAULT_DB = 'notionDefaultDatabase';

/** chrome.storage.local 中存储字段映射的 key */
export const STORAGE_KEY_FIELD_MAP = 'notionFieldMap';

/** 右键菜单项 ID */
export const CONTEXT_MENU_ID = 'save-to-notion';

/** chrome.storage.local 中存储"自动创建缺失字段"开关的 key */
export const STORAGE_KEY_AUTO_CREATE_FIELDS = 'notionAutoCreateFields';

/**
 * 预设字段映射模板
 * key = 插件数据字段名，value = Notion 属性名
 */
export const PRESET_MAPPINGS = {
  'preset-a': { title: 'Title', content: 'Content', sourceUrl: 'Source URL', capturedAt: 'Captured At', tags: 'Tags', notes: 'Notes' },
  'preset-b': { title: 'Name', content: 'Description', sourceUrl: 'Reference', capturedAt: 'Date', tags: 'Category', notes: 'Remark' },
  'preset-c': { title: 'Idea', content: 'Quote', sourceUrl: 'From', capturedAt: 'Collected At', tags: 'Theme', notes: 'Thoughts' },
};
