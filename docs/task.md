# Notion Web Clipper — 详细任务列表

> 文档版本：v1.1 | 日期：2026-04-06  
> 配套文档：`docs/plan.md`（执行阶段）、`docs/001-core-function.md`（设计规范）

---

## 如何使用本文档

- `[ ]` 表示未完成，`[x]` 表示已完成
- 每个任务后标注 **目标文件** 和 **验收标准**
- 按阶段顺序执行；同一阶段内可并行

---

## TDD 工作规范

本项目遵循 **Red → Green → Refactor** 三步循环：

```
🔴 Red    先写测试，描述期望行为 → 运行确认失败
🟢 Green  写最小实现，让测试通过 → 运行确认全绿
🔵 Refactor 整理代码结构 → 运行确认仍全绿
```

### 约定

| 规则 | 说明 |
|------|------|
| 测试先行 | 每个模块实现前，必须先有对应的 `.test.js` 文件 |
| 命名规范 | 测试文件与被测文件同名，后缀改为 `.test.js`；放在 `tests/` 目录下镜像结构 |
| 用例粒度 | 每个 `it()` 只测一个行为；用 `describe` 按功能分组 |
| 覆盖率目标 | `utils/`、`background.js`、`oauth-worker/` 行覆盖率 ≥ 80% |
| 不测实现细节 | 只测公开接口的输入输出，不 assert 内部变量 |
| 每次提交前 | `npm test` 必须全部通过，不允许带红色用例提交 |

### 目录结构

```
tests/
├── __mocks__/
│   ├── chrome.js          ← Chrome Extension API 全局 mock
│   └── fetch.js           ← 全局 fetch mock 工厂函数
├── worker/
│   └── callback.test.js   ← OAuth Worker 单元测试
├── utils/
│   └── notion-api.test.js ← Notion API 封装单元测试
├── background/
│   ├── oauth.test.js      ← background OAuth 消息处理测试
│   └── message-router.test.js ← background 其他消息路由测试
└── content/
    └── toast.test.js      ← Content Script / Toast DOM 测试
```

---

## Phase T — 测试环境搭建

> **前置条件**：Phase 0-3 本地工具已就绪（Node ≥ 18、npm）。  
> 此阶段在 Phase 1 实现前完成，后续所有测试均依赖此基础。

### PT-1 初始化 npm 项目与测试依赖 ✅

- [x] 项目根目录执行 `npm init -y`（若尚未有 `package.json`）
- [x] 安装开发依赖：
  ```bash
  npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/dom
  ```
- [x] `oauth-worker/` 目录内安装 Worker 测试依赖：
  ```bash
  cd oauth-worker && npm init -y
  npm install -D vitest @cloudflare/vitest-pool-workers wrangler
  ```

**目标文件**：根目录 `package.json`、`oauth-worker/package.json`

---

### PT-2 配置根项目 `vitest.config.js` ✅

- [x] 创建 `vitest.config.js`，内容：
  ```js
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    test: {
      environment: 'jsdom',          // content.js 测试需要 DOM
      globals: true,                 // describe / it / expect 全局可用
      setupFiles: ['tests/__mocks__/chrome.js'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['utils/**', 'background.js', 'scripts/**'],
        thresholds: { lines: 80 },
      },
    },
  });
  ```
- [x] `package.json` scripts 添加：
  ```json
  "scripts": {
    "test":          "vitest run",
    "test:watch":    "vitest",
    "test:coverage": "vitest run --coverage",
    "test:worker":   "cd oauth-worker && vitest run"
  }
  ```

**目标文件**：`vitest.config.js`、`package.json`

---

### PT-3 创建 Chrome API Mock（`tests/__mocks__/chrome.js`）✅

- [x] 创建 `tests/__mocks__/` 目录
- [x] 编写 `chrome.js`，mock 以下 API，所有函数均为可被 spy 的 `vi.fn()`：
  - `chrome.runtime.sendMessage`
  - `chrome.runtime.onMessage.addListener`
  - `chrome.runtime.id`（值：`'test-extension-id'`）
  - `chrome.runtime.openOptionsPage`
  - `chrome.storage.local.get` → 默认返回 `{}`
  - `chrome.storage.local.set`
  - `chrome.storage.local.remove`
  - `chrome.identity.launchWebAuthFlow`
  - `chrome.contextMenus.create`
  - `chrome.contextMenus.onClicked.addListener`
  - `chrome.tabs.sendMessage`
- [x] 在 `beforeEach` 钩子中自动重置所有 mock（`vi.clearAllMocks()`）

**目标文件**：`tests/__mocks__/chrome.js`

---

### PT-4 创建 fetch Mock 工厂（`tests/__mocks__/fetch.js`）✅

- [x] 编写 `makeFetchMock({ status, body })` 工厂函数：
  - 返回一个 `vi.fn()` 实现的 `fetch`，调用时 resolve 带指定 `status` 和 `json()` 的 Response
- [x] 编写 `makeFetchMockSequence([...responses])` 用于需要多次 fetch 的场景
- [x] 在各测试文件中按需 `import` 使用（不全局注入，避免污染）

**目标文件**：`tests/__mocks__/fetch.js`

---

### PT-5 配置 Worker 测试（`oauth-worker/vitest.config.js`）✅

- [x] 在 `oauth-worker/` 目录创建 `vitest.config.js`：
  ```js
  import { defineConfig } from 'vitest/config';
  import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

  export default defineWorkersConfig({
    test: {
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
        },
      },
    },
  });
  ```
- [x] 创建 `oauth-worker/tests/` 目录

**目标文件**：`oauth-worker/vitest.config.js`

**验收**：`npm test` 和 `npm run test:worker` 均能运行（此时无测试文件，输出 "no test files found"）。✅

---

## Phase 0 — 前置准备（线下操作）

### P0-1 创建 Notion OAuth Integration

- [ ] 访问 https://www.notion.so/my-integrations → 新建 Integration
- [ ] 类型选 **Public**，填写名称（如 `Notion Web Clipper`）
- [ ] 勾选权限：`Read content`、`Insert content`、`Update content`
- [ ] Redirect URI 暂填占位符 `https://placeholder.example.com/callback`（部署 Worker 后更新）
- [ ] 记录 `client_id` 和 `client_secret`（妥善保存，不要提交到 Git）

**验收**：Notion 后台 Integration 页面显示 `client_id` 和 `client_secret`。

---

### P0-2 注册 / 登录 Cloudflare

- [ ] 访问 https://dash.cloudflare.com/sign-up 完成注册
- [ ] 确认账号已激活（查收验证邮件）

**验收**：能登录 Cloudflare Dashboard。

---

### P0-3 本地环境准备

- [ ] 确认 Node.js ≥ 18 已安装（`node -v`）
- [ ] 全局安装 Wrangler：`npm install -g wrangler`
- [ ] 确认 Wrangler 版本：`wrangler -v`（应为 3.x）

**验收**：`wrangler -v` 正常输出版本号。

---

## Phase 1 — Cloudflare Worker 部署

> **TDD 顺序**：先写 Worker 测试（PT1-T1）→ 运行确认红色 → 实现 Worker（P1-2）→ 运行确认绿色 → 重构 → 部署（P1-4）。

---

### 🔴 P1-T1 先写 Worker 测试（Red）✅

**目标文件**：`oauth-worker/tests/callback.test.js`

- [x] 创建测试文件，按以下用例编写（此时运行应全部失败）：

  ```
  describe('GET /callback')
    it('缺少 code 参数时，返回 400 错误响应')
    it('携带 code 且 Notion 返回 access_token，应 302 重定向，fragment 含 access_token')
    it('302 重定向目标为 EXTENSION_REDIRECT_URI')
    it('Notion token 接口返回错误，应返回 HTML 错误页面（状态码 200，含"授权失败"文字）')
    it('请求头包含正确的 Authorization: Basic base64(client_id:client_secret)')

  describe('OPTIONS /callback')
    it('返回 200 及 CORS 允许头')

  describe('未知路径')
    it('返回 404')
  ```

- [x] 为 Notion token 接口调用 mock 全局 `fetch`
- [x] 运行 `npm run test:worker`，确认所有用例 **🔴 红色失败**

---

### P1-1 创建 Worker 项目结构 ✅

- [x] 创建目录：`mkdir -p oauth-worker/src`
- [x] 创建空文件：`oauth-worker/src/index.js`、`oauth-worker/wrangler.toml`

---

### 🟢 P1-2 实现 Worker（Green）✅

**目标文件**：`oauth-worker/src/index.js`

- [x] 实现 `GET /callback`：接收 `code` 参数，缺失时返回 400
- [x] 调用 Notion token 接口换取 `access_token`
  - `Authorization: Basic base64(client_id:client_secret)`（`client_secret` 来自 env）
  - Body: `{ grant_type, code, redirect_uri }`
- [x] 成功：302 重定向，URL fragment 携带 `access_token`、`workspace_name`、`workspace_icon`
- [x] 失败：返回友好 HTML 错误页（含「授权失败」文字）
- [x] 实现 `OPTIONS /callback`：返回 CORS 头
- [x] 未知路径返回 404
- [x] 运行 `npm run test:worker`，确认所有用例 **🟢 绿色通过**

---

### P1-3 编写 Wrangler 配置（`oauth-worker/wrangler.toml`）✅

- [x] `name`、`main`、`compatibility_date` 填写完整
- [x] `[vars]` 中填入 `NOTION_CLIENT_ID`、`NOTION_REDIRECT_URI`（明文）
- [x] `CLIENT_SECRET` **不**写入 toml

---

### P1-4 部署 Worker

- [ ] `wrangler login`
- [ ] `wrangler secret put NOTION_CLIENT_SECRET`
- [ ] `wrangler deploy`，记录 Worker URL

---

### P1-5 回填 URL

- [ ] Notion Integration 后台 Redirect URI → 更新为实际 Worker URL
- [ ] `wrangler.toml` `NOTION_REDIRECT_URI` → 更新
- [ ] `wrangler deploy` 重新部署

### 🔵 P1-Refactor Worker 重构 ✅

- [x] 将 Notion token 请求逻辑提取为独立函数 `exchangeCodeForToken(code, env)`（已在实现中完成）
- [x] 将重定向 URL 构造提取为独立逻辑（fragment 参数构造已内聚）
- [x] 运行 `npm run test:worker`，确认仍全绿

**验收**：Phase 1 里程碑——`/callback` 能正常响应 OAuth code；`npm run test:worker` 全绿。✅

---

## Phase 2 — 扩展基础设施

> **TDD 顺序**：先写 `notion-api` 测试 → 实现 → 再写 `background` 测试 → 实现。

---

### P2-1 更新 `manifest.json` ✅

（此文件无逻辑，不需要单元测试，直接实现。）

- [x] `manifest_version: 3`
- [x] 权限：`"identity"`、`"storage"`、`"contextMenus"`、`"activeTab"`、`"scripting"`
- [x] `options_ui.page` → `"options/options.html"`，`open_in_tab: true`
- [x] `background.service_worker` → `"background.js"`
- [x] `content_scripts.css` → `["content/toast.css"]`
- [x] `content_scripts.js` → `["scripts/content.js"]`
- [x] `content_scripts.matches` → `["<all_urls>"]`
- [x] `icons` 四种尺寸；`action.default_popup` → `"popup/popup.html"`

**验收**：`chrome://extensions` 加载插件无报错。

---

### P2-2 新建 `utils/config.js` ✅

（纯常量，不需要单元测试，直接实现。）

- [x] 创建 `utils/` 目录
- [x] 导出 `CLIENT_ID`、`WORKER_URL`、`EXTENSION_REDIRECT_URI`、`NOTION_API_BASE`、`NOTION_VERSION`
- [x] 填入 Phase 1-5 产出的实际值

**目标文件**：`utils/config.js`

---

### 🔴 P2-T1 先写 `notion-api` 测试（Red）✅

**目标文件**：`tests/utils/notion-api.test.js`

- [x] 在文件顶部 mock `utils/config.js`（返回固定测试常量）
- [x] 编写以下用例（运行应全部 **🔴 红色失败**）：

  ```
  describe('fetchDatabases')
    it('调用 POST /v1/search，携带 Bearer token 和 Notion-Version 头')
    it('返回格式化后的 [{ id, name, icon }] 数组')
    it('name 取自 results[].title[0].plain_text')
    it('Notion 返回非 2xx 时，抛出含 message 字段的 Error')

  describe('createNotionPage')
    it('调用 POST /v1/pages，body 中包含 parent.database_id')
    it('按 fieldMapping 将 fields 映射为 properties 对象')
    it('content 超过 2000 字符时截断，末尾追加 "…"')
    it('content 不足 2000 字符时不截断')
    it('返回 { id, url } 结构')
    it('Notion 返回非 2xx 时，抛出含 message 字段的 Error')

  describe('updateNotionPage')
    it('调用 PATCH /v1/pages/:pageId')
    it('只更新传入的字段，不传入的字段不出现在 body 中')
    it('Notion 返回非 2xx 时，抛出含 message 字段的 Error')
  ```

- [x] 在每个测试中使用 `tests/__mocks__/fetch.js` mock 全局 `fetch`
- [x] 运行 `npm test`，确认所有 notion-api 用例 **🔴 红色失败**

---

### 🟢 P2-3 实现 `utils/notion-api.js`（Green）✅

- [x] 实现 `notionFetch(path, accessToken, options)`
- [x] 实现 `fetchDatabases(accessToken)`，返回 `[{ id, name, icon }]`
- [x] 实现 `createNotionPage(accessToken, databaseId, fields, fieldMapping)`
  - 截断逻辑：`content.length > 2000 ? content.slice(0, 2000) + '…' : content`
- [x] 实现 `updateNotionPage(accessToken, pageId, fields, fieldMapping)`
- [x] 统一错误处理：非 2xx → `throw new Error(data.message || '未知错误')`
- [x] 运行 `npm test`，确认 notion-api 用例 **🟢 绿色通过**

**目标文件**：`utils/notion-api.js`

---

### 🔵 P2-Refactor notion-api 重构 ✅

- [x] 提取 `buildProperties(fields, fieldMapping)` 为纯函数（便于单独测试）
- [x] 为 `buildProperties` 补充单元测试（8 个用例：title / rich_text / url / date / multi_select / 缺少映射 / 空字符串 / 空对象）
- [x] 运行 `npm test`，确认仍全绿（61/61）

---

### 🔴 P2-T2 先写 `background.js` 测试（Red）✅

**目标文件**：`tests/background/oauth.test.js`、`tests/background/message-router.test.js`

- [x] mock `utils/notion-api.js`（`vi.mock('../utils/notion-api.js')`）
- [x] mock `utils/config.js`（返回固定测试常量）
- [x] **oauth.test.js** 用例（运行应 **🔴 红色失败**）：

  ```
  describe('消息：startOAuth')
    it('调用 chrome.identity.launchWebAuthFlow，URL 含 client_id 和 redirect_uri')
    it('成功时从 redirect URL fragment 解析 access_token 并存入 storage')
    it('成功时回调 { success: true }')
    it('launchWebAuthFlow 抛出异常时，回调 { success: false, error }')
    it('redirect URL 不含 access_token 时，回调 { success: false, error }')
  ```

- [x] **message-router.test.js** 用例（运行应 **🔴 红色失败**）：

  ```
  describe('消息：fetchDatabases')
    it('从 storage 读取 access_token 后调用 fetchDatabases()')
    it('将结果存入 chrome.storage.local 并回调 { databases }')
    it('storage 中无 access_token 时，回调 { error: "未登录" }')
    it('notion-api 抛出异常时，回调 { error }')

  describe('消息：saveToNotion')
    it('调用 createPage 并传入正确参数')
    it('成功时将 lastSaved 存入 storage，回调 { success: true, pageId, pageUrl }')
    it('storage 中无 access_token 时，回调 { success: false, error }')
    it('notion-api 抛出异常时，回调 { success: false, error }')

  describe('消息：updateNotionPage')
    it('调用 updatePage 并传入 pageId 和 fields')
    it('成功时回调 { success: true }')
    it('失败时回调 { success: false, error }')

  describe('右键菜单注册')
    it('onInstalled 时调用 chrome.contextMenus.create，id 为 "save-to-notion"')

  describe('右键菜单点击')
    it('向当前 tab 发送 processSelectedText 消息，携带 selectionText、pageUrl、pageTitle')
  ```

- [x] 运行 `npm test`，确认所有 background 用例 **🟢 绿色通过**

---

### 🟢 P2-4 实现 `background.js`（Green）✅

- [x] 引入 `utils/config.js`、`utils/notion-api.js`
- [x] `onInstalled` → 注册右键菜单（`id: 'save-to-notion'`）
- [x] `contextMenus.onClicked` → 发送 `processSelectedText` 给当前 Tab
- [x] 实现 `startOAuth` 消息处理（完整 OAuth 流程 + 存储 + 回调）
- [x] 实现 `fetchDatabases` 消息处理
- [x] 实现 `saveToNotion` 消息处理
- [x] 实现 `updateNotionPage` 消息处理
- [x] 运行 `npm test`，确认所有 background 用例 **🟢 绿色通过**

**目标文件**：`background.js`

---

### 🔵 P2-Refactor background 重构 ✅

- [x] 将消息处理函数拆分为命名函数（`handleStartOAuth`、`handleFetchDatabases` 等）
- [x] 运行 `npm test`，确认仍全绿

**验收**：Phase 2 里程碑——`npm test` 全绿；Options 页 OAuth 流程可用。

---

## Phase 3 — Content Script & Toast ✅

> **TDD 顺序**：先写 Toast 测试 → 实现 content.js → 绿色通过 → 重构。

---

### 🔴 P3-T1 先写 Toast 测试（Red）✅

**目标文件**：`tests/content/toast.test.js`

- [x] 配置 jsdom 环境（vitest.config.js 已设 `environment: 'jsdom'`）
- [x] 在 `beforeEach` 中清空 `document.body`，重置 chrome mock
- [x] 编写以下用例（运行应全部 **🔴 红色失败**）：

  ```
  describe('Toast 注入')
    it('接收 processSelectedText 消息后，在 body 中注入 #notion-clipper-toast')
    it('已有 toast 时，先移除旧的再注入新的，保证页面唯一')
    it('toast 中包含选中文本的前 150 字符作为预览')

  describe('数据库加载')
    it('storage 中有 databases 时，select 包含对应 option')
    it('storage 中无 databases 时，保存按钮为 disabled 状态')
    it('默认选中 notionDefaultDatabase 对应的 option')

  describe('Phase A → B：保存操作')
    it('点击保存按钮后，按钮变为 disabled 并显示 spinner')
    it('点击保存后，向 background 发送 saveToNotion 消息，含 databaseId、selectedText、pageUrl')

  describe('Phase B → C：成功响应')
    it('saveToNotion 成功后，toast body 替换为成功结构')
    it('成功结构中包含指向 pageUrl 的「在 Notion 中查看」链接')
    it('「编辑详情」按钮初始时 aria-expanded="false"')

  describe('Phase C：编辑详情展开/收起')
    it('点击「编辑详情」后 .nc-edit-panel 变为可见，aria-expanded 变为 "true"')
    it('再次点击「编辑详情」后 .nc-edit-panel 重新隐藏，aria-expanded 变为 "false"')

  describe('Phase D：标签管理')
    it('在标签输入框按 Enter，新增 tag pill 到 .nc-tags-row')
    it('在标签输入框输入逗号，触发新增 tag，清空输入框')
    it('点击 tag 的 × 按钮，移除对应 tag pill')
    it('tag 内容为空或纯空白时，不新增')

  describe('Phase D → 更新')
    it('点击「更新」按钮后，发送 updateNotionPage 消息，含 pageId、tags')
    it('更新成功后，显示「已更新」提示')

  describe('错误处理')
    it('saveToNotion 失败时，恢复按钮可用，并在 .nc-live-region 中显示错误信息')
    it('updateNotionPage 失败时，恢复「更新」按钮，并显示错误信息')

  describe('关闭行为')
    it('点击关闭按钮后，toast 添加 toast-out 类')
    it('animationend 事件触发后，#notion-clipper-toast 从 DOM 中移除')
  ```

- [x] 运行 `npm test`，确认所有 toast 用例 **🟢 绿色通过**（23 tests）

---

### 🟢 P3-1 实现 `scripts/content.js`（Green）✅

#### 基础骨架

- [x] 监听 `chrome.runtime.onMessage`，处理 `processSelectedText` 消息
- [x] 防重复：若 `#notion-clipper-toast` 已存在则先调用 `removeToast()` 再创建
- [x] 实现 `removeToast()`：添加 `toast-out` → `animationend` → 移除 DOM

#### Phase A：初始保存界面

- [x] 注入 Toast DOM：Header（关闭按钮）+ 预览区 + 数据库 select + 操作按钮 + aria-live 区域
- [x] 从 storage 读取 `notionDatabases`，填充 select；读取 `notionDefaultDatabase` 设置默认值
- [x] 无数据库时禁用保存按钮
- [x] 关闭 / 取消按钮 → `removeToast()`

#### Phase B：保存中

- [x] 点击保存 → 禁用控件 → 按钮显示 spinner + 「保存中…」
- [x] 发送 `saveToNotion` 消息（含 `databaseId`、`selectedText`、`pageUrl`、`pageTitle`）

#### Phase C：成功

- [x] 成功响应 → 替换 body 为成功结构（成功行 + 查看链接 + 编辑详情 toggle）
- [x] 「编辑详情」→ 展开/收起 `.nc-edit-panel`，切换 `aria-expanded`

#### Phase D：编辑详情面板

- [x] tag 输入：`Enter` / `,` 添加 pill；`×` 删除 pill；空内容不添加
- [x] 备注输入：`.nc-notes-input` textarea
- [x] 「更新」→ 发送 `updateNotionPage` 消息 → 显示「已更新」提示

#### 错误处理

- [x] 失败响应 → live region 显示错误，恢复按钮可用
- [x] 运行 `npm test`，确认所有 toast 用例 **🟢 绿色通过**（23/23）

**目标文件**：`scripts/content.js`

---

### 🔵 P3-Refactor content.js 重构 ✅

- [x] 提取 `renderPhaseA(toast, data)` 为独立函数，返回控件引用
- [x] 提取 `buildToastContainer()` 构造 toast 容器
- [x] `renderPhaseC` 和 `buildEditPanel` 已作为独立函数
- [x] 运行 `npm test`，确认仍全绿（53/53）

**验收**：Phase 3 里程碑——`npm test` 全绿；选中文字 → 右键 → Toast 弹出 → 保存 → 成功。✅

---

## Phase 4 — Popup & Options 联调

> 此阶段以手动联调为主（涉及真实 Chrome API 和 OAuth 网络交互），单元测试在 Phase 2-3 已覆盖相关逻辑。

### P4-0 代码对齐（存储键 & 消息类型）✅

在手动联调前，必须确保 `popup.js` 和 `options.js` 与 `background.js` 使用一致的 storage key 和消息格式：

- [x] **popup.js**：将 `auth`/`databases`/`settings` 替换为 `notionAccessToken`/`notionWorkspace`/`notionDatabases`/`notionDefaultDatabase`；`lastSaved.url` → `lastSaved.pageUrl`；`lastSaved.title` → `lastSaved.sourceTitle`；`selectDatabase` 变更时写入 `notionDefaultDatabase`
- [x] **options.js**：`{ action: 'startOAuth' }` → `{ type: 'startOAuth' }`；`{ action: 'fetchDatabases' }` → `{ type: 'fetchDatabases' }`；所有 storage 操作改用正确键名；`btnDisconnect` 删除正确键名；数据库列表读写改用 `notionDatabases`；默认数据库读写改用 `notionDefaultDatabase`
- [x] 运行 `npm test`，确认 53/53 全绿

---

### P4-1 Popup 联调

**Bug 修复（2026-04-09）**：点击插件图标弹窗空白/不显示内容。  
根本原因：两个 view 均默认 `hidden`，若 JS 执行前/执行中出错，弹窗完全空白；`init().catch` 中的 `showStatus` 写入仍然隐藏的 `#view-authenticated`，导致错误也不可见。  
修复方案：
- `popup.html`：`#view-unauthenticated` 移除 `hidden`（默认可见）；`#status-message` 移到两个 view 外部（body 级别）
- `popup.js`：未登录时无需主动 show view；已登录时先 `viewUnauthenticated.hidden = true`；catch handler 恢复 unauthenticated 视图再显示错误

- [x] 弹窗打开时至少能看到未登录界面（不再空白）
- [ ] 清空 storage → Popup 显示未登录视图
- [ ] storage 有 `notionAccessToken` → 显示 workspace 名称和图标
- [ ] 切换数据库下拉 → `notionDefaultDatabase` 更新
- [ ] `lastSaved` 存在时显示链接，点击跳转 Notion 页面
- [ ] 「设置」按钮 → `openOptionsPage()` 后 Popup 关闭

---

### P4-2 Options 账号模块联调

- [ ] 「连接 Notion」→ 完整 OAuth 流程 → 显示已登录态
- [ ] 「断开连接」→ confirm → 清空 storage → 恢复未登录态

---

### P4-3 Options 数据库模块联调

- [ ] 「同步」→ `fetchDatabases` 消息 → 列表更新
- [ ] 手动添加 ID → 列表新增，「同步」后获得正确名称
- [ ] 单选默认数据库 → storage 更新
- [ ] 删除数据库 → 若删除的是默认库，清除 `notionDefaultDatabase`

---

### P4-4 Options 字段映射模块联调

- [ ] 切换数据库下拉 → 映射配置切换
- [ ] Preset A/B/C → 自定义表隐藏
- [ ] 「自定义」→ 逐行填写 + 启用/禁用
- [ ] 「保存映射」→ storage 更新，显示「✓ 映射已保存」

**验收**：Phase 4 里程碑——所有 UI 交互可用，数据正确持久化。

---

## Phase 5 — 端到端测试

### P5-0 自动化测试套件确认

> 在手动测试前，确保自动化测试全部通过。

- [ ] 运行 `npm test`，所有单元测试 **🟢 绿色**，无跳过用例
- [ ] 运行 `npm run test:worker`，Worker 测试 **🟢 绿色**
- [ ] 运行 `npm run test:coverage`，查看覆盖率报告：
  - `utils/notion-api.js` 行覆盖率 ≥ 80%
  - `background.js` 行覆盖率 ≥ 80%
  - `scripts/content.js` 行覆盖率 ≥ 80%
- [ ] 若覆盖率不足，补充缺失场景的测试用例

---

### P5-1 主流程手动测试

- [ ] **全新安装流程**：清空 storage → 安装插件 → Popup 显示未登录 → Options → OAuth → 同步数据库 → 设置默认 → 右键保存 → 查看 Notion
- [ ] **重复保存**：同一页面连续保存两次不同选中文字，确认 Notion 出现两条记录
- [ ] **编辑详情**：保存后添加标签 + 备注 → 更新 → Notion 页面属性正确

---

### P5-2 边界场景手动测试

- [ ] **未登录保存**：清空 `auth` → 右键保存 → Toast 提示「请先连接 Notion」
- [ ] **无数据库保存**：清空 `databases` → 右键保存 → 保存按钮 disabled
- [ ] **网络错误**：断网 → 保存 → 错误提示 + 按钮恢复
- [ ] **超长文本**：选中 > 2000 字符 → 保存 → Notion 页面内容末尾有 `…`
- [ ] **token 过期**：置空 `access_token` → 保存 → 认证错误提示

---

### P5-3 样式兼容性测试

- [ ] 浅色 / 深色模式：三个界面均正确切换
- [ ] 深色背景页面（GitHub dark）：Toast 样式不受干扰
- [ ] 高 z-index 页面（YouTube 播放器）：Toast 显示在最顶层
- [ ] `prefers-reduced-motion: reduce`：Toast 无动画，功能正常

---

### P5-4 Popup 状态手动测试

- [ ] 未登录 / 已登录 + 有数据库 / 已登录 + 无数据库 三种状态
- [ ] `lastSaved` 链接有效

---

## Phase 6 — 打包发布

### P6-1 清理工作

- [ ] 删除无用文件：`css/style.css`
- [ ] 检查无遗留备份文件
- [ ] `.gitignore` 包含 `oauth-worker/node_modules`、`.wrangler`、`coverage/`、`node_modules/`

---

### P6-2 图标补全

- [ ] `images/` 包含 16 / 32 / 48 / 128px 四套 PNG 图标

---

### P6-3 最终 manifest.json 检查

- [ ] `version`、`description`、`name` 填写完整
- [ ] 所有路径有效，无调试用权限残留

---

### P6-4 打包前最后一次全量测试

- [ ] `npm test` 全绿
- [ ] `npm run test:worker` 全绿

---

### P6-5 打包

- [ ] 执行：
  ```bash
  zip -r notion-clipper.zip . \
    --exclude '*.git*' \
    --exclude 'oauth-worker/*' \
    --exclude 'docs/*' \
    --exclude 'node_modules/*' \
    --exclude 'coverage/*' \
    --exclude '*.DS_Store' \
    --exclude 'tests/*' \
    --exclude 'vitest.config.js' \
    --exclude 'package*.json'
  ```
- [ ] 解压验证：含所有必要文件，不含敏感文件、测试文件

---

### P6-6（可选）提交 Chrome Web Store

- [ ] 上传 zip、填写展示信息、提交审核

**验收**：Phase 6 里程碑——zip 包可正常安装；所有自动化测试在打包前全绿。

---

## 快速状态总览

| Phase | 描述 | 任务数 | 状态 |
|-------|------|--------|------|
| Phase T | 测试环境搭建 | 10 | ✅ 已完成 |
| Phase 0 | 前置准备（线下操作） | 7 | ⬜ 待线下执行 |
| Phase 1 | Worker 部署（含 TDD） | 14 | ✅ 代码完成（部署待线下） |
| Phase 2 | 扩展基础设施（含 TDD） | 38 | ✅ 已完成 |
| Phase 3 | Content Script（含 TDD） | 22 | ✅ 已完成 |
| Phase 4 | Popup & Options 联调 | 12 | 🔵 P4-0 完成，P4-1~P4-4 待手动联调 |
| Phase 5 | E2E 测试 | 17 | ⬜ 待执行 |
| Phase 6 | 打包发布 | 11 | ⬜ 待执行 |

---

## TDD 快速参考

```
每个功能模块的标准节奏：

1. 🔴 创建 tests/xxx/yyy.test.js
2. 🔴 编写 describe / it 骨架（只写描述，暂不实现断言体）
3. 🔴 补全断言，运行 npm test → 确认红色
4. 🟢 创建 / 修改实现文件
5. 🟢 运行 npm test → 确认绿色
6. 🔵 重构：提取函数、改善命名、消除重复
7. 🔵 运行 npm test → 确认仍绿色
8. ✅ 提交
```

> 提示：用 `npm run test:watch` 保持测试在后台持续监听，每次保存文件自动重跑相关用例，实时获得红绿反馈。
