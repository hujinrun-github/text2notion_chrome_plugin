# Notion Web Clipper - 核心功能设计文档

## 概述

一个 Chrome 扩展插件，允许用户在任意网页选中一段文字后，通过右键菜单一键将内容保存到指定的 Notion Database 中，并自动附带来源 URL、网页标题、截取时间等元数据。

---

## 一、项目结构

```
notion-clipper/
├── manifest.json
├── background.js                       # 注册右键菜单 & 消息路由 & 调用 Notion API
├── scripts/
│   └── content.js                      # 注入 Toast 组件 & 处理交互
├── content/
│   └── toast.css                       # Toast 样式
├── options/
│   ├── options.html                    # 设置页：Token 输入 & 数据库管理 & 字段映射
│   ├── options.js
│   └── options.css
├── popup/
│   ├── popup.html                      # 点击扩展图标的快捷面板
│   ├── popup.css
│   └── popup.js
├── utils/
│   ├── config.js                       # 统一维护常量配置
│   └── notion-api.js                   # 封装 Notion API 调用
└── images/
    ├── icon-16.png
    ├── icon-32.png
    ├── icon-48.png
    └── icon-128.png
```

---

## 二、manifest.json 核心配置

```json
{
  "manifest_version": 3,
  "name": "Notion Web Clipper",
  "version": "1.0",
  "description": "选中文字，右键保存到 Notion Database",
  "permissions": [
    "storage",
    "contextMenus",
    "activeTab",
    "scripting",
    "tabs"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "css": ["content/toast.css"],
      "js": ["scripts/content.js"],
      "run_at": "document_idle"
    }
  ],
  "options_ui": {
    "page": "options/options.html",
    "open_in_tab": true
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": "images/icon-16.png"
  }
}
```

---

## 三、认证方式：Internal Integration Token（手动配置）

> **方案变更说明（2026-04-13）**：原方案使用 OAuth + Cloudflare Worker 中转，但 `workers.dev` 域名在国内网络环境下被屏蔽，导致 token 换取始终失败。现改为用户手动输入 Internal Integration Token，所有 API 请求直接发到 `api.notion.com`（国内可正常访问），不再依赖任何中转服务。

### 3.1 用户配置步骤

```
1. 访问 https://www.notion.so/profile/integrations
2. 点击「新建集成」(New Integration)
3. 选择关联的工作区，类型选「内部集成」(Internal)
4. 勾选权限：Read content、Insert content、Update content
5. 创建后复制 API Token（以 ntn_ 开头）
6. 在 Notion 中打开目标数据库，点击右上角「…」→「连接」→ 选择刚创建的集成
7. 在插件设置页粘贴 Token 并保存
```

### 3.2 Token 验证流程

```
用户在 Options 页粘贴 Token → 点击「保存」
        ↓
临时写入 chrome.storage.local
        ↓
发送 fetchDatabases 消息给 background
        ↓
background 用 Token 调用 Notion API（POST /v1/search）
        ↓
成功 → Token 有效，保留存储，刷新页面
失败 → Token 无效，从 storage 中移除，显示错误
```

### 本地存储结构（chrome.storage.local）

```js
{
  notionAccessToken: "ntn_xxx",          // Internal Integration Token
  notionDatabases: [
    { id: "db-id-1", name: "阅读收藏", icon: "📚" },
    { id: "db-id-2", name: "工作笔记", icon: "💼" }
  ],
  notionDefaultDatabase: "db-id-1",      // 默认数据库 ID
  lastSaved: {
    pageId: "page-xxx",
    pageUrl: "https://notion.so/page-xxx",
    savedAt: 1712000000000,
    sourceUrl: "https://example.com",
    sourceTitle: "Example Page"
  }
}
```

---

## 四、核心交互流程

### 4.1 右键菜单触发流程

```
用户选中文字 → 右键 → "📋 保存到 Notion"
        ↓
background service-worker 捕获事件
        ↓
向 content.js 发送消息（携带 selectionText + tabUrl + tabTitle）
        ↓
content.js 弹出 Toast（含数据库选择器）
        ↓
用户选择目标数据库（默认上次使用的）→ 点击"保存"
        ↓
background 调用 Notion API 创建 Page
        ↓
Toast 更新为 "✅ 已保存到 [DB名称]  [在 Notion 中查看] [编辑]"
```

### 4.2 Toast 组件交互设计

**第一阶段：选择数据库并保存**

```
┌─────────────────────────────────────────────┐
│  📋 保存到 Notion                          ✕ │
│  ─────────────────────────────────────────  │
│  "选中的文字预览，超出截断..."               │
│                                             │
│  目标数据库: [ 📚 阅读收藏         ▾ ]      │
│                                             │
│              [取消]  [保存]                 │
└─────────────────────────────────────────────┘
```

**第二阶段：保存成功反馈**

```
┌─────────────────────────────────────────────┐
│  ✅ 已保存到「阅读收藏」                   ✕ │
│  [🔗 在 Notion 中查看]  [✏️ 编辑详情]       │
└─────────────────────────────────────────────┘
```

**第三阶段：点击「编辑详情」展开补充信息**

```
┌─────────────────────────────────────────────┐
│  ✅ 已保存  [🔗 查看]                      ✕ │
│  ─────────────────────────────────────────  │
│  🏷️ 标签:  [+ 添加标签]  [技术] [阅读]      │
│  📝 备注:  [输入备注...]                    │
│                                   [更新]    │
└─────────────────────────────────────────────┘
```

---

## 五、字段映射策略

### 5.1 设计思路

插件内置若干**预设映射模板**，覆盖常见使用场景，开箱即用。  
若预设不满足需求，用户可在 Options 页切换为**自定义映射**，手动配置每个数据字段对应 Notion Database 中的哪个字段名。

---

### 5.2 内置预设模板

插件提供以下 3 种预设，用户在 Options 页一键选择：

#### 模板 A：标准阅读收藏（默认）

适合：书签收藏、文章摘录、稍后阅读

| 插件数据字段 | 映射到 Notion 字段名 | Notion 类型 |
|------------|------------------|------------|
| 网页标题 | `Title` | title |
| 选中内容 | `Content` | rich_text |
| 来源 URL | `Source URL` | url |
| 截取时间 | `Captured At` | date |
| 标签 | `Tags` | multi_select |
| 备注 | `Notes` | rich_text |

#### 模板 B：工作笔记

适合：会议记录、工作摘要、任务灵感

| 插件数据字段 | 映射到 Notion 字段名 | Notion 类型 |
|------------|------------------|------------|
| 网页标题 | `Name` | title |
| 选中内容 | `Description` | rich_text |
| 来源 URL | `Reference` | url |
| 截取时间 | `Date` | date |
| 标签 | `Category` | multi_select |
| 备注 | `Remark` | rich_text |

#### 模板 C：灵感/素材库

适合：设计灵感、创意收集、写作素材

| 插件数据字段 | 映射到 Notion 字段名 | Notion 类型 |
|------------|------------------|------------|
| 网页标题 | `Idea` | title |
| 选中内容 | `Quote` | rich_text |
| 来源 URL | `From` | url |
| 截取时间 | `Collected At` | date |
| 标签 | `Theme` | multi_select |
| 备注 | `Thoughts` | rich_text |

---

### 5.3 自定义映射

当用户选择「自定义」模式时，Options 页会从所选 Notion Database 自动拉取所有字段列表，提供下拉选择映射关系：

```
Options 页 - 字段映射配置
┌────────────────────────────────────────────────────┐
│  映射模板:  [● 标准阅读收藏] [工作笔记] [灵感库] [自定义] │
│  ────────────────────────────────────────────────  │
│  （自定义模式下显示以下配置项）                       │
│                                                    │
│  网页标题  →  [ Title (title)            ▾ ]       │
│  选中内容  →  [ Content (rich_text)      ▾ ]       │
│  来源 URL  →  [ Source URL (url)         ▾ ]       │
│  截取时间  →  [ Captured At (date)       ▾ ]       │
│  标签      →  [ Tags (multi_select)      ▾ ]  ⬜启用│
│  备注      →  [ Notes (rich_text)        ▾ ]  ⬜启用│
│                                                    │
│  下拉选项来自所选 Database 的实际字段，自动过滤类型兼容的字段  │
│                                          [保存]    │
└────────────────────────────────────────────────────┘
```

**字段类型兼容规则：**

| 插件数据字段 | 允许映射的 Notion 字段类型 |
|------------|------------------------|
| 网页标题 | `title` |
| 选中内容 | `rich_text` |
| 来源 URL | `url`、`rich_text` |
| 截取时间 | `date`、`created_time` |
| 标签 | `multi_select`、`select` |
| 备注 | `rich_text` |

---

### 5.4 映射配置的存储结构

```js
// chrome.storage.local 中每个 database 独立保存一份映射配置
{
  databases: [
    {
      id: "db-id-1",
      name: "阅读收藏",
      icon: "📚",
      mappingTemplate: "preset-a",       // preset-a / preset-b / preset-c / custom
      customMapping: null                 // 仅 mappingTemplate === 'custom' 时有值
    },
    {
      id: "db-id-2",
      name: "工作笔记",
      icon: "💼",
      mappingTemplate: "custom",
      customMapping: {
        title:      { field: "任务名称", enabled: true },
        content:    { field: "详情",    enabled: true },
        sourceUrl:  { field: "链接",    enabled: true },
        capturedAt: { field: "记录时间", enabled: true },
        tags:       { field: "分类",    enabled: true },
        notes:      { field: "备注",    enabled: false }  // 该字段不启用
      }
    }
  ]
}
```

---

### 5.5 Notion Database 字段参考

使用预设模板 A（默认）时，用户的 Notion Database 需包含以下字段：

| 字段名 | Notion 类型 | 说明 | 是否必须 |
|--------|------------|------|---------|
| `Title` | title | 网页标题（自动填入） | ✅ |
| `Content` | rich_text | 选中的文字内容 | ✅ |
| `Source URL` | url | 来源页面链接 | ✅ |
| `Captured At` | date | 截取时间（自动） | ✅ |
| `Tags` | multi_select | 自定义标签 | ⬜ 可选 |
| `Notes` | rich_text | 用户备注 | ⬜ 可选 |

---

## 六、Notion API 封装（utils/notion-api.js）

### 创建页面（Database 新增一行）

```js
/**
 * 在指定 Notion Database 中创建一条记录
 * @param {string} databaseId - 目标数据库 ID
 * @param {string} token - OAuth access_token
 * @param {object} data - 页面数据
 */
async function createNotionPage({ databaseId, token, data }) {
  const { selectedText, sourceUrl, pageTitle, capturedAt, tags, notes } = data;

  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        "Title": {
          title: [{ text: { content: pageTitle } }]
        },
        "Content": {
          rich_text: [{ text: { content: selectedText } }]
        },
        "Source URL": {
          url: sourceUrl
        },
        "Captured At": {
          date: { start: capturedAt }
        },
        "Tags": {
          multi_select: tags.map(t => ({ name: t }))
        },
        "Notes": {
          rich_text: [{ text: { content: notes || '' } }]
        }
      }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || '保存失败');
  }

  return response.json(); // 返回新创建的 page 对象，包含 page.url
}

/**
 * 更新已有页面的 Tags 和 Notes（编辑详情功能）
 * @param {string} pageId - 页面 ID
 * @param {string} token - OAuth access_token
 * @param {object} updates - 更新字段
 */
async function updateNotionPage({ pageId, token, updates }) {
  const { tags, notes } = updates;

  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      properties: {
        "Tags": {
          multi_select: tags.map(t => ({ name: t }))
        },
        "Notes": {
          rich_text: [{ text: { content: notes || '' } }]
        }
      }
    })
  });

  return response.json();
}

/**
 * 获取用户有权访问的所有 Database 列表
 * @param {string} token - OAuth access_token
 */
async function fetchDatabases(token) {
  const response = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      filter: { value: 'database', property: 'object' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' }
    })
  });

  const data = await response.json();
  return data.results.map(db => ({
    id: db.id,
    name: db.title?.[0]?.plain_text || '未命名数据库',
    icon: db.icon?.emoji || '📄'
  }));
}
```

---

## 七、Options 设置页功能清单

| 模块 | 功能描述 |
|------|---------|
| **账号管理** | 手动输入 Internal Integration Token / 断开连接，Token 保存时自动验证（调用 fetchDatabases） |
| **数据库管理** | 从 Notion 拉取数据库列表、手动添加数据库 ID、设置默认数据库、删除已配置的数据库 |
| **字段映射** | 为每个数据库独立配置映射模板（预设 A/B/C 或自定义），自定义模式下支持逐字段映射和启用/禁用 |
| **元数据开关** | 分别开关：自动附带来源 URL / 网页标题 / 截取时间 |
| **预设标签** | 配置常用标签列表，导入时支持快速点选 |

---

## 八、UI 设计规范

### 8.1 文件结构

```
extension/
├── popup/
│   ├── popup.html          # 点击扩展图标的 Popup 面板
│   ├── popup.css           # Popup 样式
│   └── popup.js            # Popup 逻辑
├── options/
│   ├── options.html        # 设置页（账号 / 数据库 / 字段映射）
│   ├── options.css         # 设置页样式
│   └── options.js          # 设置页逻辑
└── content/
    └── toast.css           # 右键菜单触发的 Toast 组件样式
```

---

### 8.2 Popup 面板

宽度固定 **280px**，两种状态：

#### 未登录状态

```
┌─────────────────────────────┐
│  [icon] Notion Clipper      │
│                             │
│  将网页内容一键保存到         │
│  Notion Database            │
│                             │
│  [      连接 Notion       ] │
└─────────────────────────────┘
```

#### 已登录状态

```
┌─────────────────────────────┐
│  [icon] Notion Clipper  [⚙] │
│ ─────────────────────────── │
│  默认数据库                  │
│  [ 📚 阅读收藏          ▾ ] │
│ ─────────────────────────── │
│  上次保存                    │
│  Go 语言性能优化实战 ↗       │
└─────────────────────────────┘
```

**设计要点：**
- 数据库下拉切换自动持久化到 `chrome.storage.local`
- 点击「⚙」跳转 Options 页并关闭 Popup
- 上次保存链接在新标签页打开（`target="_blank" rel="noopener noreferrer"`）

---

### 8.3 Options 设置页

左侧固定侧边栏（200px）+ 右侧主内容区，三个 section 通过锚点导航：

#### 账号（#account）

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  账号                                                │
│                                                      │
│  （未连接时）                                         │
│  ┌──────────────────────────────────────────────┐   │
│  │  Notion API Token                             │   │
│  │  [ntn_***                        ] [保存]     │   │
│  │  获取方法：前往 Notion Integrations…           │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  （已连接时）                                         │
│  ┌──────────────────────────────────────────────┐   │
│  │  [icon 40px]  ✓ Token 已连接                  │   │
│  │               ● 已连接        [断开连接]      │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

未连接时显示 Token 输入框，用户粘贴后点击「保存」自动验证。

#### 数据库（#databases）

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  数据库                              [↻ 同步]        │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  📚 阅读收藏                    ○        ✕   │   │
│  │  💼 工作笔记                    ●（默认）✕   │   │
│  │  💡 灵感素材库                  ○        ✕   │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  手动添加 Database ID                                │
│  [xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…] [添加]          │
└──────────────────────────────────────────────────────┘
```

- 单选按钮设置默认数据库，立即持久化
- 点击「✕」删除数据库（无需确认弹窗，操作可逆）
- 点击「同步」从 Notion API 拉取最新数据库列表

#### 字段映射（#mapping）

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  字段映射                                            │
│  为每个数据库独立配置字段映射模板。                    │
│                                                      │
│  选择数据库: [ 📚 阅读收藏                      ▾ ] │
│                                                      │
│  映射模板:                                           │
│  [📚 标准阅读收藏] [💼 工作笔记] [💡 灵感库] [自定义]│
│                                                      │
│  （自定义时展示）                                     │
│  ┌────────────────┬──────────────────┬──────┐       │
│  │ 插件字段       │ Notion 字段名    │ 启用 │       │
│  ├────────────────┼──────────────────┼──────┤       │
│  │ 网页标题       │ [Title        ]  │  ☑  │       │
│  │ 选中内容       │ [Content      ]  │  ☑  │       │
│  │ 来源 URL       │ [Source URL   ]  │  ☑  │       │
│  │ 截取时间       │ [Captured At  ]  │  ☑  │       │
│  │ 标签           │ [Tags         ]  │  ☑  │       │
│  │ 备注           │ [Notes        ]  │  ☐  │       │
│  └────────────────┴──────────────────┴──────┘       │
│                                                      │
│                              [保存映射]              │
└──────────────────────────────────────────────────────┘
```

---

### 8.4 Toast 组件（右键菜单触发）

固定定位于页面右下角（`bottom: 24px; right: 24px`），宽度 320px。

#### 阶段一：选择数据库并保存

```
┌──────────────────────────────────────┐
│  📋 保存到 Notion               [✕] │
│ ──────────────────────────────────── │
│  "选中的文字预览，最多两行，超出…"   │
│                                      │
│  目标数据库                          │
│  [ 📚 阅读收藏               ▾ ]    │
│                                      │
│                      [取消] [保存]   │
└──────────────────────────────────────┘
```

#### 阶段二：保存中

```
┌──────────────────────────────────────┐
│  📋 保存到 Notion               [✕] │
│ ──────────────────────────────────── │
│                      [取消] [⟳ 保存中…]│
└──────────────────────────────────────┘
```

#### 阶段三：保存成功

```
┌──────────────────────────────────────┐
│  ✅ 已保存到「阅读收藏」         [✕] │
│ ──────────────────────────────────── │
│  [🔗 在 Notion 中查看] [✏️ 编辑详情] │
└──────────────────────────────────────┘
```

#### 阶段四：展开编辑详情

```
┌──────────────────────────────────────┐
│  ✅ 已保存                      [✕] │
│  [🔗 查看]  [✏️ 收起]               │
│ ──────────────────────────────────── │
│  🏷 标签                             │
│  [技术 ✕] [阅读 ✕] [+ 输入标签…]   │
│                                      │
│  📝 备注                             │
│  [输入备注…                       ]  │
│                                      │
│                          [更新]      │
└──────────────────────────────────────┘
```

---

### 8.5 设计规范（Web Interface Guidelines 合规）

| 规范项 | 实现方式 |
|--------|---------|
| **无障碍** | 所有按钮有 `aria-label`；异步更新区域使用 `aria-live="polite"`；表单控件有 `<label>` 或 `aria-label` |
| **焦点状态** | 使用 `:focus-visible` + `box-shadow` ring，不使用 `outline: none` |
| **暗色模式** | CSS 变量 + `@media (prefers-color-scheme: dark)`；`html` 设置 `color-scheme: light dark` |
| **减少动效** | `@media (prefers-reduced-motion: reduce)` 禁用所有动画 |
| **文字截断** | 使用 `text-overflow: ellipsis` + `min-width: 0`，防止 flex 布局溢出 |
| **跳过导航** | Options 页包含 `.skip-link` 跳至主内容 |
| **语义 HTML** | 操作用 `<button>`，导航用 `<a>`，表格数据用 `<table>` |
| **动画属性** | 仅 `transform` / `opacity`，不使用 `transition: all` |
| **响应式** | Options 页 ≤600px 时侧边栏折叠为顶部导航栏 |
| **空状态** | 数据库列表为空时显示引导文案，不渲染破碎 UI |

---

## 九、待确认事项

目前所有核心设计已确认，暂无待决事项。

---

---

## 十、已知 Bug 修复记录

### Bug Fix 1：createPage title 属性名硬编码（2026-04-12）

**问题：** `utils/notion-api.js` 的 `createPage` 函数将 title 属性名硬编码为 `"Name"`。当用户的 Notion Database 使用不同的 title 字段名（如 `"Title"`、`"标题"` 等）时，Notion API 返回 400 错误，导致保存失败。

**修复：** 在创建页面前先请求 `GET /databases/{id}` 接口，动态查找该数据库中 `type === 'title'` 的属性名，将其作为 key 写入 properties。若接口异常则回退到 `"Name"`。

**影响文件：** `utils/notion-api.js` → `createPage()`

---

### Bug Fix 2：prefers-reduced-motion 导致 Toast 无法关闭（2026-04-12）

**问题：** `scripts/content.js` 的 `removeToast` 函数依赖 `animationend` 事件来移除 DOM 节点。当操作系统开启了"减少动画"（`prefers-reduced-motion: reduce`）时，CSS 将 `animation` 重置为 `none`，导致 `animationend` 永远不触发，Toast 弹窗无法关闭。

**修复：** 在 `removeToast` 中增加 `window.matchMedia('(prefers-reduced-motion: reduce)').matches` 判断，若为 `true` 则直接调用 `toast.remove()`，跳过动画逻辑。

**影响文件：** `scripts/content.js` → `removeToast()`

---

### Bug Fix 3：保存失败时错误信息不可见 + GET /databases 阻断保存（2026-04-12）

**问题 A：** 保存失败时，错误信息只写入了 `.nc-live-region`（CSS 无障碍隐藏元素，宽高各 1px，视觉上完全不可见），导致用户看不到任何报错，只觉得"保存没反应"。

**修复：** 失败时额外渲染一个 `.nc-error-msg` `<p>` 元素追加到 `.nc-toast-body` 底部，配以红色文字样式，让错误信息直接可见。

**问题 B：** 上次 Bug Fix 1 引入的 `GET /databases/{id}` 预查询，一旦 Integration 权限不足或网络异常，会直接抛出异常并中断保存流程（比真正的保存请求更早失败）。

**修复：** 将该预查询改为 `try/catch` 容错模式：查询成功则使用动态属性名；查询失败则静默回退到 `"Name"`，不影响后续 `POST /pages` 保存请求。

**影响文件：**
- `scripts/content.js` → `injectToast()` 错误处理块
- `utils/notion-api.js` → `createPage()` 预查询逻辑
- `content/toast.css` → 新增 `.nc-error-msg` 样式

---

### Bug Fix 4：保存时一直转圈（消息回复通道丢失）（2026-04-12）

**问题：** `background.js` 的 `onMessage` 监听器中，`handleSaveToNotion` / `handleFetchDatabases` / `handleUpdateNotionPage` 均为 `async` 函数，但调用时未使用 `.catch()` 兜底。在 Manifest V3 中，Service Worker 会在空闲时被浏览器挂起，若异步 handler 的 Promise 未被妥善持有，`sendResponse` 的消息通道就会关闭。`content.js` 中的 `await chrome.runtime.sendMessage(...)` 因此永远等不到回复，导致 UI 停在"保存中…"转圈状态。

**修复：** 在每个 `async` handler 调用后追加 `.catch(err => sendResponse({...}))`，确保即使 handler 抛出未捕获的异常，也能向 content script 回复一个错误响应，恢复 UI 状态。

**影响文件：** `background.js` → `onMessage` 监听器

---

### Bug Fix 5：Unchecked runtime.lastError: The user did not approve access（2026-04-12）

**问题：** `chrome.tabs.sendMessage` 调用没有传回调函数。当目标页面为 `chrome://`、扩展页等受限页面（不允许注入 content script）时，Chrome 会将错误写入 `runtime.lastError`，若没有任何代码读取它，就会在控制台抛出 `Unchecked runtime.lastError` 警告。

**修复：** 为 `chrome.tabs.sendMessage` 加上回调，在回调中执行 `void chrome.runtime.lastError` 消费该错误。受限页面无法注入属于正常情况，静默忽略即可。

**影响文件：** `background.js` → `contextMenus.onClicked`

---

### Bug Fix 6：已登录但保存时仍显示"未登录，请先连接 Notion"（2026-04-12）

**根本原因：** OAuth token 兑换失败，`chrome.storage.local` 中从未写入有效的 `notionAccessToken`，导致每次保存时检查 token 都为空。

**失败链路（从现象倒推）：**
1. `handleSaveToNotion` 从 `chrome.storage.local` 读取 `notionAccessToken`，发现不存在，返回"未登录"错误。
2. `handleStartOAuth` 在 OAuth 成功后调用 `POST ${WORKER_URL}/token` 换取 token，这一步失败（或返回无 `access_token` 字段）。
3. Cloudflare Worker 的 `corsHeaders()` 函数返回 `'Access-Control-Allow-Methods': 'GET, OPTIONS'`，**缺少 `POST`**，导致浏览器的 CORS preflight 检查认为不允许 `POST` 方法，返回 CORS 错误，`fetch` 请求失败。

**修复 A — `oauth-worker/src/index.js`：** `corsHeaders()` 的 `Access-Control-Allow-Methods` 中加入 `POST`：
```js
// 修复前
'Access-Control-Allow-Methods': 'GET, OPTIONS',
// 修复后
'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
```

**修复 B — `background.js`：** 在 token 写入 storage 前增加空值校验。若 Worker 响应中 `access_token` 为 `undefined`（如 Notion 返回异常字段），阻止无效值被 JSON 序列化丢弃并静默写入，改为向用户报错：
```js
if (!data.access_token) {
  sendResponse({ success: false, error: '授权响应中未包含 access_token，请重新连接' });
  return;
}
```

**修复 C — `scripts/content.js`：** 当错误信息包含"未登录"关键词时，在可见错误提示下方追加一个"→ 点此连接 Notion"链接，直接跳转到设置页，减少用户摸索步骤。

**影响文件：**
- `oauth-worker/src/index.js` → `corsHeaders()`
- `background.js` → `handleStartOAuth()`
- `scripts/content.js` → `injectToast()` 错误处理块

---

*文档版本：v1.0 | 创建时间：2026-04-06 | 更新：2026-04-13 方案变更：OAuth → Internal Integration Token*

---

### 方案变更：OAuth → Internal Integration Token（2026-04-13）

**问题：** Cloudflare Workers 的 `workers.dev` 域名在中国大陆网络环境下被屏蔽（TLS 握手失败），导致 OAuth token 换取请求始终无法到达 Worker，`chrome.storage.local` 中永远没有有效的 `notionAccessToken`，保存时必然报"未登录"。

**方案变更：** 去掉整个 OAuth 流程和 Cloudflare Worker 依赖，改为用户手动创建 Notion Internal Integration，将 API Token 粘贴到设置页。所有 API 请求直接发到 `api.notion.com`（国内可正常访问）。

**删除的文件/模块：**
- `oauth-worker/` 整个目录（Cloudflare Worker 不再需要）
- `tests/background/oauth.test.js`（OAuth 测试不再需要）
- `utils/config.js` 中的 `CLIENT_ID`、`WORKER_URL`、`EXTENSION_REDIRECT_URI`、`NOTION_AUTH_URL`
- `manifest.json` 中的 `identity` 权限
- `background.js` 中的 `handleStartOAuth` 函数和 `startOAuth` 消息处理

**修改的文件：**
- `options/options.js`：OAuth 按钮 → Token 输入框 + 保存验证逻辑
- `popup/popup.html` / `popup.js`：简化 workspace 显示（固定为"Notion Clipper"）
- `tests/__mocks__/chrome.js`：删除 `chrome.identity` mock
- `tests/background/message-router.test.js`：删除 OAuth 相关 mock 常量

---

### Bug Fix 8：数据库列表显示 [object Object]（2026-04-13）

**问题：** 设置页和 Toast 的数据库列表中，名称和图标显示为 `[object Object]`。

**根本原因：** `utils/notion-api.js` 的 `fetchDatabases` 函数直接返回 Notion API 原始对象。原始数据中 `title` 是 `[{plain_text: "..."}]` 数组，`icon` 是 `{type: "emoji", emoji: "📚"}` 对象。渲染到 HTML 时对象被强制转为字符串即 `[object Object]`。

**修复：** 在 `fetchDatabases` 返回前统一格式化为 `{ id, name, icon }` 简单结构：
- `name` = `db.title?.[0]?.plain_text || '未命名数据库'`
- `icon` = `db.icon?.emoji || db.icon?.external?.url || '📄'`

**影响文件：** `utils/notion-api.js` → `fetchDatabases()`

---

### 功能增强：字段映射接入 + 自动创建缺失字段（2026-04-13）

**背景：** `createPage` 只写入 Title 和 Content（页面正文），没有使用字段映射模板。`buildProperties` 纯函数已就绪但未被调用。保存时不会自动填入 Source URL、Captured At 等元数据。

**改动：**
1. `utils/config.js`：新增 `STORAGE_KEY_AUTO_CREATE_FIELDS`、`PRESET_MAPPINGS` 预设映射表
2. `utils/notion-api.js`：
   - 新增 `ensureDatabaseProperties()` 函数，通过 `PATCH /databases/{id}` 自动创建缺失字段
   - `createPage()` 新增 `options` 参数（`fieldMapping`、`autoCreateFields`），接入 `buildProperties` 构造完整 properties
   - 保存时只写入数据库中已有的字段；如果开启了自动创建，先补齐缺失字段再写入
3. `background.js`：`handleSaveToNotion` 从 storage 读取映射模板和 autoCreateFields 设置，构造完整 fields（含 sourceUrl、capturedAt），传递给 `createPage`
4. `options/options.html` + `options.js`：数据库 section 增加「保存时自动创建数据库中缺失的字段」checkbox，默认不勾选

**影响文件：** `utils/config.js`、`utils/notion-api.js`、`background.js`、`options/options.html`、`options/options.js`

---

### 功能增强：Toast 保存体验改进（2026-04-13）

**改动：**
1. **保存前可编辑内容**：Phase A 的文字预览改为可编辑 textarea，用户可在保存前修改选中内容
2. **保存前可添加 tags 和 notes**：Phase A 新增标签输入和备注输入，保存时一并提交
3. **数据库已有标签建议**：Phase A 和 Phase D（编辑详情）都会从数据库拉取已有的 multi_select 选项，显示为可点击的建议标签
4. **公共 tag 组件**：提取 `createTagWidget()` 供 Phase A 和 Phase D 复用，支持 Enter/逗号添加、× 删除、防重复、suggestions

**新增 API：**
- `utils/notion-api.js` → `getDatabaseTags(token, databaseId, tagsPropertyName)`
- `background.js` → `handleFetchDatabaseTags` 消息处理 + `resolveFieldMapping` 辅助函数

**影响文件：** `utils/notion-api.js`、`background.js`、`scripts/content.js`、`content/toast.css`
