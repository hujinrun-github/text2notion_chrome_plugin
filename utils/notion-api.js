/**
 * utils/notion-api.js
 * Notion REST API 封装
 */
import { NOTION_API_BASE, NOTION_VERSION } from './config.js';

/**
 * 字段类型映射表：根据 fields 的 key 推断 Notion property 类型
 */
const FIELD_TYPES = {
  title: 'title',
  content: 'rich_text',
  notes: 'rich_text',
  sourceUrl: 'url',
  capturedAt: 'date',
  tags: 'multi_select',
};

/**
 * FIELD_TYPES 对应的 Notion property schema（用于 PATCH /databases 创建新字段）
 * title 类型不能创建（每个数据库已有且仅有一个 title 字段）
 */
const FIELD_SCHEMA = {
  rich_text:     { rich_text: {} },
  url:           { url: {} },
  date:          { date: {} },
  multi_select:  { multi_select: {} },
};

/**
 * 将 fields 对象按 fieldMapping 转换为 Notion properties 格式
 * @param {object} fields       - { title, content, sourceUrl, capturedAt, tags, notes, ... }
 * @param {object} fieldMapping - { fieldKey: 'NotionPropertyName', ... }
 * @returns {object}            - Notion properties 对象
 */
export function buildProperties(fields, fieldMapping) {
  const properties = {};

  for (const [key, notionPropName] of Object.entries(fieldMapping)) {
    const value = fields[key];

    // 跳过：字段未传入 / 空字符串 / 空数组
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;

    const type = FIELD_TYPES[key] ?? 'rich_text';

    switch (type) {
      case 'title':
        properties[notionPropName] = {
          title: [{ text: { content: String(value) } }],
        };
        break;

      case 'rich_text':
        properties[notionPropName] = {
          rich_text: [{ type: 'text', text: { content: String(value) } }],
        };
        break;

      case 'url':
        properties[notionPropName] = { url: String(value) };
        break;

      case 'date':
        properties[notionPropName] = { date: { start: String(value) } };
        break;

      case 'multi_select':
        properties[notionPropName] = {
          multi_select: (Array.isArray(value) ? value : [value]).map((v) => ({ name: v })),
        };
        break;

      default:
        properties[notionPropName] = {
          rich_text: [{ type: 'text', text: { content: String(value) } }],
        };
    }
  }

  return properties;
}

/**
 * 构造通用请求头
 * @param {string} token
 * @returns {object}
 */
function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
  };
}

/**
 * 检查 Response，非 2xx 时抛出错误
 * @param {Response} res
 */
async function checkResponse(res) {
  if (!res.ok) {
    let msg = `Notion API error: ${res.status}`;
    try {
      const data = await res.json();
      if (data.message) msg += ` — ${data.message}`;
    } catch (_) {}
    throw new Error(msg);
  }
  return res;
}

/**
 * 确保数据库中存在 fieldMapping 中指定的所有属性。
 * 缺失的属性通过 PATCH /databases/{id} 自动创建。
 * title 类型字段跳过（不能通过 API 创建）。
 *
 * @param {string} token
 * @param {string} databaseId
 * @param {object} fieldMapping  { fieldKey: 'NotionPropertyName', ... }
 * @param {object} existingSchema  数据库的 properties 对象（来自 GET /databases）
 */
export async function ensureDatabaseProperties(token, databaseId, fieldMapping, existingSchema) {
  const existingNames = new Set(Object.keys(existingSchema || {}));
  const newProperties = {};

  for (const [key, notionPropName] of Object.entries(fieldMapping)) {
    if (existingNames.has(notionPropName)) continue;

    const type = FIELD_TYPES[key] ?? 'rich_text';
    // title 字段不能创建，跳过
    if (type === 'title') continue;

    const schema = FIELD_SCHEMA[type];
    if (schema) {
      newProperties[notionPropName] = schema;
    }
  }

  if (Object.keys(newProperties).length === 0) return;

  const res = await fetch(`${NOTION_API_BASE}/databases/${databaseId}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ properties: newProperties }),
  });
  await checkResponse(res);
}

/**
 * 获取数据库 schema（属性列表）
 * @param {string} token
 * @param {string} databaseId
 * @returns {Promise<object|null>} 数据库的 properties 对象，失败返回 null
 */
export async function getDatabaseSchema(token, databaseId) {
  try {
    const res = await fetch(`${NOTION_API_BASE}/databases/${databaseId}`, {
      headers: headers(token),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.properties || null;
  } catch (_) {
    return null;
  }
}

/**
 * 获取数据库中指定 multi_select/select 属性的已有选项列表
 * @param {string} token
 * @param {string} databaseId
 * @param {string} tagsPropertyName  Notion 中 tags 属性的名称（如 "Tags"）
 * @returns {Promise<string[]>}  选项名称数组
 */
export async function getDatabaseTags(token, databaseId, tagsPropertyName) {
  const schema = await getDatabaseSchema(token, databaseId);
  if (!schema) return [];
  const prop = schema[tagsPropertyName];
  if (!prop || (prop.type !== 'multi_select' && prop.type !== 'select')) return [];
  return (prop.multi_select?.options || prop.select?.options || []).map(o => o.name);
}

/**
 * 获取工作区内所有 Database 列表
 * @param {string} token  access_token
 * @returns {Promise<Array>}  Notion Database 对象数组
 */
export async function fetchDatabases(token) {
  const res = await fetch(`${NOTION_API_BASE}/search`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      filter: { value: 'database', property: 'object' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
    }),
  });
  await checkResponse(res);
  const data = await res.json();
  return data.results.map(db => ({
    id: db.id,
    name: db.title?.[0]?.plain_text || '未命名数据库',
    icon: db.icon?.emoji || db.icon?.external?.url || '📄',
  }));
}

/**
 * 在指定 Database 中创建新页面
 * @param {string} token        access_token
 * @param {string} databaseId   目标 Database ID
 * @param {object} fields       { title, content, sourceUrl, capturedAt, tags, notes }
 * @param {object} [options]    可选配置
 * @param {object} [options.fieldMapping]      字段映射 { fieldKey: 'NotionPropertyName' }
 * @param {boolean} [options.autoCreateFields] 是否自动创建数据库中缺失的字段
 * @returns {Promise<object>}   新建的 Notion Page 对象
 */
export async function createPage(token, databaseId, fields, options = {}) {
  const { fieldMapping, autoCreateFields = false, contentBlocks } = options;
  const { title = '', content = '' } = fields;

  // Notion rich_text 单条最大 2000 字符
  const safeContent = content.length > 2000 ? content.slice(0, 2000) : content;

  // 动态获取数据库 schema（title 属性名 + 已有字段列表）
  let titlePropName = 'Name';
  let dbSchema = null;
  try {
    const dbRes = await fetch(`${NOTION_API_BASE}/databases/${databaseId}`, {
      headers: headers(token),
    });
    if (dbRes.ok) {
      const dbData = await dbRes.json();
      dbSchema = dbData.properties || {};
      titlePropName = Object.entries(dbSchema).find(
        ([, v]) => v.type === 'title'
      )?.[0] ?? 'Name';
    }
  } catch (_) {
    // 忽略，使用默认值
  }

  // 构造 properties
  let properties;

  if (fieldMapping) {
    // 如果开启了自动创建，先补齐缺失字段
    if (autoCreateFields && dbSchema) {
      try {
        await ensureDatabaseProperties(token, databaseId, fieldMapping, dbSchema);
      } catch (e) {
        console.error('[createPage] ensureDatabaseProperties failed:', e.message);
        // 创建字段失败不阻断保存
      }
    }

    // 过滤 fieldMapping：只保留数据库中已有的字段
    // autoCreate 开启时，需要重新获取 schema（因为刚创建了新字段）
    let effectiveMapping = { ...fieldMapping };
    if (dbSchema) {
      let currentSchema = dbSchema;
      if (autoCreateFields) {
        // 重新获取 schema，确保包含刚创建的字段
        try {
          const refreshRes = await fetch(`${NOTION_API_BASE}/databases/${databaseId}`, {
            headers: headers(token),
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            currentSchema = refreshData.properties || dbSchema;
          }
        } catch (_) {}
      }
      const existingNames = new Set(Object.keys(currentSchema));
      effectiveMapping = {};
      for (const [key, propName] of Object.entries(fieldMapping)) {
        if (existingNames.has(propName) || FIELD_TYPES[key] === 'title') {
          effectiveMapping[key] = propName;
        }
      }
    }

    // title 字段使用动态获取的属性名
    if (effectiveMapping.title) {
      effectiveMapping.title = titlePropName;
    }

    const fieldsWithSafeContent = { ...fields, content: safeContent };
    properties = buildProperties(fieldsWithSafeContent, effectiveMapping);
  } else {
    // 无映射：只写 title
    properties = {
      [titlePropName]: {
        title: [{ text: { content: title } }],
      },
    };
  }

  // 使用 contentBlocks（富文本 blocks），或回退到纯文本段落
  // Notion API 单次最多 100 个 children，超出部分需后续追加
  const allBlocks = contentBlocks || [
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: safeContent } }],
      },
    },
  ];
  const firstBatch = allBlocks.slice(0, 100);
  const remaining = allBlocks.slice(100);

  const body = {
    parent: { database_id: databaseId },
    properties,
    children: firstBatch,
  };

  const res = await fetch(`${NOTION_API_BASE}/pages`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  await checkResponse(res);
  const page = await res.json();

  // 如果有超过 100 个 block，分批追加
  if (remaining.length > 0) {
    for (let i = 0; i < remaining.length; i += 100) {
      const batch = remaining.slice(i, i + 100);
      await appendBlocks(token, page.id, batch);
    }
  }

  return page;
}

/**
 * 更新已有页面的属性
 * @param {string} token    access_token
 * @param {string} pageId   目标页面 ID
 * @param {object} updates  要更新的 properties（Notion API 格式）
 * @returns {Promise<object>}
 */
export async function updatePage(token, pageId, updates) {
  const res = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ properties: updates }),
  });
  await checkResponse(res);
  return res.json();
}

/**
 * 获取数据库中的页面列表（最近编辑的前 50 个）
 * @param {string} token
 * @param {string} databaseId
 * @returns {Promise<Array<{id: string, title: string}>>}
 */
export async function fetchDatabasePages(token, databaseId) {
  const res = await fetch(`${NOTION_API_BASE}/databases/${databaseId}/query`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: 50,
    }),
  });
  await checkResponse(res);
  const data = await res.json();
  return data.results.map(page => {
    // 找到 title 属性
    const titleProp = Object.values(page.properties || {}).find(p => p.type === 'title');
    const title = titleProp?.title?.[0]?.plain_text || '未命名';
    return { id: page.id, title, url: page.url };
  });
}

/**
 * 追加 blocks 到已有页面末尾
 * @param {string} token
 * @param {string} pageId
 * @param {object[]} blocks  Notion block 数组
 * @returns {Promise<object>}
 */
export async function appendBlocks(token, pageId, blocks) {
  const res = await fetch(`${NOTION_API_BASE}/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ children: blocks }),
  });
  await checkResponse(res);
  return res.json();
}
