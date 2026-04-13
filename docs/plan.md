# Notion Web Clipper — 执行计划

> 文档版本：v1.0 | 日期：2026-04-06

---

## 一、当前状态

### 已完成

| 文件 | 说明 |
|------|------|
| `popup/popup.html` / `.css` / `.js` | Popup 面板（未登录 / 已登录两态） |
| `options/options.html` / `.css` / `.js` | 设置页（账号 / 数据库 / 字段映射） |
| `content/toast.css` | Toast 组件样式 |
| `docs/001-core-function.md` | 核心功能设计文档（含 UI 线框图、OAuth 流程、字段映射策略） |

### 待实现

| 文件 | 说明 |
|------|------|
| `manifest.json` | 需按设计文档更新（添加 `identity`、`options_ui`、正确路径） |
| `utils/config.js` | 统一维护 `client_id`、Worker URL 等常量 |
| `utils/notion-api.js` | 封装 Notion REST API 调用 |
| `background.js` | 重写：OAuth 流程、右键菜单、消息路由、调用 Notion API |
| `scripts/content.js` | 重写：注入 Toast DOM + 完整交互逻辑 |
| `oauth-worker/src/index.js` | Cloudflare Worker OAuth 中转逻辑 |
| `oauth-worker/wrangler.toml` | Cloudflare 部署配置 |

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension                     │
│                                                         │
│  popup/          options/          content/             │
│  ├ popup.html    ├ options.html    └ content.js  ←─┐   │
│  ├ popup.css     ├ options.css       (Toast DOM)   │   │
│  └ popup.js      ├ options.css                     │   │
│                  └ options.js                      │   │
│                                                    │   │
│  utils/                                            │   │
│  ├ config.js     ← CLIENT_ID、Worker URL 常量      │   │
│  └ notion-api.js ← fetch 封装                      │   │
│                                                    │   │
│  background.js (Service Worker)  ──────────────────┘   │
│  ├ OAuth 流程（chrome.identity.launchWebAuthFlow）       │
│  ├ 右键菜单注册 & 点击事件                               │
│  ├ 消息路由（startOAuth / fetchDatabases / saveToNotion）│
│  └ 调用 utils/notion-api.js                             │
└─────────────────────────────────────────────────────────┘
                          │ OAuth callback
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Cloudflare Worker（OAuth 中转）              │
│                                                         │
│  GET /callback?code=xxx                                 │
│    → 用 CLIENT_SECRET 换取 access_token                 │
│    → 302 重定向回 Extension（URL fragment 携带 token）   │
└─────────────────────────────────────────────────────────┘
                          │ access_token
                          ▼
                   Notion REST API
```

---

## 三、执行阶段

### Phase 0 — 前置准备（线下操作，约 30 分钟）

> 此阶段为一次性手动配置，不涉及代码。

1. 在 [Notion Integrations](https://www.notion.so/my-integrations) 创建 OAuth Integration
   - 获取 `client_id` 和 `client_secret`
   - Redirect URI 暂填占位符，部署 Worker 后更新
2. 注册 [Cloudflare 账号](https://dash.cloudflare.com/sign-up)（免费）
3. 本地安装 Node.js 和 Wrangler CLI（`npm install -g wrangler`）

---

### Phase 1 — Cloudflare Worker 部署（约 20 分钟）

> 目标：OAuth 中转服务上线，获得 Worker URL。

- 创建 `oauth-worker/` 目录结构
- 编写 `src/index.js`（代码已在设计文档 3.3 节）
- 编写 `wrangler.toml`（配置已在设计文档 3.4 节）
- `wrangler login` → `wrangler secret put CLIENT_SECRET` → `wrangler deploy`
- 将 Worker URL 回填：Notion 后台 Redirect URI、`wrangler.toml`、`manifest.json`

**里程碑**：`https://notion-oauth.<subdomain>.workers.dev/callback` 能正常响应。

---

### Phase 2 — 扩展基础设施（约 1 小时）

> 目标：插件能加载，OAuth 登录流程跑通。

- 更新 `manifest.json`（添加 `identity` 权限、`options_ui`、修正文件路径）
- 新建 `utils/config.js`（`CLIENT_ID`、`WORKER_URL`、`EXTENSION_REDIRECT_URI`）
- 新建 `utils/notion-api.js`（`createPage`、`updatePage`、`fetchDatabases`）
- 重写 `background.js`
  - `onInstalled`：注册右键菜单
  - 消息监听：`startOAuth` → `chrome.identity.launchWebAuthFlow` → 解析 token → 存储
  - 消息监听：`fetchDatabases` → 调用 `notion-api.js`
  - 消息监听：`saveToNotion` → 调用 `notion-api.js`

**里程碑**：Options 页点击「连接 Notion」能完成 OAuth，token 存入 storage。

---

### Phase 3 — Content Script & Toast（约 1.5 小时）

> 目标：右键菜单触发 → Toast 弹出 → 保存 → 成功反馈。

- 重写 `scripts/content.js`
  - 监听 `processSelectedText` 消息
  - 动态注入 Toast DOM（4 个阶段的 HTML 结构）
  - 绑定事件：关闭、数据库选择、保存、编辑详情展开/收起、标签管理、备注输入、更新
  - 与 background 通信（`saveToNotion` / `updateNotionPage`）
- 确认 `content/toast.css` 已通过 `manifest.json` 注入

**里程碑**：选中文字 → 右键 → Toast 弹出 → 保存到 Notion → 成功提示。

---

### Phase 4 — Popup & Options 联调（约 1 小时）

> 目标：Popup 和 Options 各功能与 background 通信正常。

- Popup：验证登录状态读取、数据库下拉切换、上次保存显示
- Options 账号模块：OAuth 登录/断开完整流程联调
- Options 数据库模块：同步（`fetchDatabases` message）、手动添加、单选默认、删除
- Options 字段映射：模板切换、自定义映射保存

**里程碑**：所有 UI 交互功能可用，数据正确持久化。

---

### Phase 5 — 端到端测试（约 1 小时）

> 目标：主流程在真实环境无错误运行。

- 全流程测试：首次安装 → OAuth → 添加数据库 → 右键保存 → 查看 Notion
- 边界场景：网络错误、token 过期、Database 字段不匹配
- 样式检查：浅色 / 深色模式、各种网页（深色背景、`z-index` 冲突）
- 插件 popup：未登录 / 已登录 / 数据库为空各状态

---

### Phase 6 — 打包发布（约 30 分钟）

> 目标：输出可提交 Chrome Web Store 的 zip 包。

- 清理无用文件（`css/style.css`、旧 `scripts/content.js` 备份等）
- 补全图标（确认 16 / 32 / 48 / 128px 四套）
- 打包：`zip -r notion-clipper.zip . --exclude '*.git*' --exclude 'oauth-worker/*' --exclude 'docs/*' --exclude 'node_modules/*'`
- （可选）提交 Chrome Web Store Developer Dashboard

---

## 四、依赖关系

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3
                                  └──→ Phase 4
                         Phase 3 + Phase 4 ──→ Phase 5 ──→ Phase 6
```

Phase 1（Worker URL）是 Phase 2（config.js）的前置条件。  
Phase 2（background.js）是 Phase 3 和 Phase 4 的前置条件。

---

## 五、技术风险

| 风险 | 等级 | 应对 |
|------|------|------|
| `chrome.identity` 在 MV3 中的兼容性 | 中 | 确认 `identity` permission 写入 manifest；测试 `launchWebAuthFlow` 返回 URL 格式 |
| Content Script 与页面 CSS 冲突（Toast 样式被覆盖） | 中 | 使用高 `z-index`（2147483647）；所有 Toast 样式加 `#notion-clipper-toast` 命名空间前缀 |
| Notion API `rich_text` 内容超过 2000 字符限制 | 低 | 在 `createPage` 前截断，保留前 2000 字符并提示 |
| Cloudflare Worker 冷启动延迟 | 低 | 免费套餐冷启动 < 200ms，对 OAuth 场景无感 |
