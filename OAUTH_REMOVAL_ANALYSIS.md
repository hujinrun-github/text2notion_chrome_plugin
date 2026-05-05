# Notion Web Clipper - OAuth Implementation Analysis

## Executive Summary
The extension uses OAuth 2.0 Authorization Code flow with a Cloudflare Worker intermediary. To remove OAuth and use manual token + database ID input, you need to:
1. Remove all `chrome.identity.launchWebAuthFlow` calls
2. Remove the Cloudflare Worker integration
3. Replace the options UI with manual input fields
4. Update storage and initialization logic

---

## 1. POPUP UI & LOGIC (`popup/popup.html` and `popup/popup.js`)

### Current Flow
- **Unauthenticated state** (default): Shows "连接 Notion" button → Opens options page
- **Authenticated state** (when `notionAccessToken` exists): Shows workspace info, database selector, last-saved link

### Key Storage Keys Referenced
- `notionAccessToken` - The OAuth access token
- `notionWorkspace` - Object with `{name, icon}`
- `notionDatabases` - Array of database objects from Notion API
- `notionDefaultDatabase` - Selected database ID
- `lastSaved` - Object with `{pageId, pageUrl, savedAt, sourceUrl, sourceTitle}`

### popup.js - Line-by-Line Reference
```javascript
// Lines 29-41: Reads storage keys
const {
  notionAccessToken,        // NEEDS REMOVAL - check this for auth
  notionWorkspace,          // NEEDS REMOVAL - only used for display
  notionDatabases,
  notionDefaultDatabase,
  lastSaved,
} = await chrome.storage.local.get([...]);

// Lines 43-46: Auth check - NEEDS MODIFICATION
if (!notionAccessToken) {
  // view-unauthenticated 默认可见，无需额外操作
  return;
}

// Lines 51-53: Display workspace info (from OAuth response)
workspaceName.textContent = notionWorkspace?.name || '我的工作区';
workspaceIcon.src = notionWorkspace?.icon || '../images/icon-16.png';

// Lines 85-88: "连接 Notion" button - NEEDS MODIFICATION
btnConnect.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
```

### Changes Needed for Popup
1. Remove `notionWorkspace` from storage checks (or keep for manual input)
2. Update auth check to verify `notionAccessToken` exists instead
3. Simplify workspace display (can be static or use database ID as identifier)

---

## 2. OPTIONS PAGE (`options/options.html` and `options/options.js`)

### Current Account Section Flow
The account section has two modes:

**Unauthenticated** (`#account-unauthenticated`):
```html
<div id="account-unauthenticated" class="card" hidden>
  <p>连接你的 Notion 账号，开始一键保存网页内容。</p>
  <button id="btn-oauth" class="btn btn-primary">
    <svg>...</svg>
    连接 Notion
  </button>
</div>
```

**Authenticated** (`#account-authenticated`):
```html
<div id="account-authenticated" class="card" hidden>
  <div class="account-info">
    <div class="account-avatar">
      <img id="account-icon" src="" alt="" />
    </div>
    <div class="account-meta">
      <p id="account-workspace"></p>
      <p class="account-status">
        <span class="status-dot"></span>
        已连接
      </p>
    </div>
    <button id="btn-disconnect" class="btn btn-danger-outline">
      断开连接
    </button>
  </div>
</div>
```

### options.js - OAuth Handler (Lines 104-119)

**CRITICAL FUNCTION - NEEDS COMPLETE REPLACEMENT:**

```javascript
btnOAuth.addEventListener('click', async () => {
  btnOAuth.disabled = true;
  btnOAuth.textContent = '连接中…';
  showStatus(accountStatusBar, '正在打开 Notion 授权页…');
  
  // *** THIS IS THE OAUTH CALL - NEEDS REMOVAL ***
  chrome.runtime.sendMessage({ type: 'startOAuth' }, (result) => {
    if (result?.success) {
      showStatus(accountStatusBar, '✓ 连接成功', 'success');
      init();
    } else {
      showStatus(accountStatusBar, result?.error || '连接失败，请重试', 'error');
      btnOAuth.disabled = false;
      btnOAuth.textContent = '连接 Notion';
    }
  });
});
```

### Account Section Rendering (Lines 91-102)

```javascript
function renderAccountSection(token, workspace) {
  if (token) {
    // Show authenticated UI
    accountAuthenticated.hidden = false;
    accountUnauthenticated.hidden = true;
    accountWorkspace.textContent = workspace?.name || '我的工作区';
    accountIcon.src = workspace?.icon || '../images/icon-48.png';
    accountIcon.alt = workspace?.name || '';
  } else {
    // Show unauthenticated UI with OAuth button
    accountUnauthenticated.hidden = false;
    accountAuthenticated.hidden = true;
  }
}
```

### Disconnect Handler (Lines 121-134)

```javascript
btnDisconnect.addEventListener('click', async () => {
  if (!confirm('确定要断开与 Notion 的连接吗？')) return;
  await chrome.storage.local.remove([
    'notionAccessToken',        // WILL REMOVE THIS
    'notionWorkspace',          // WILL REMOVE THIS
    'notionDatabases',
    'notionDefaultDatabase',
    'lastSaved',
  ]);
  renderAccountSection(null, null);
  renderDatabaseSection([], '');
  renderMappingSection([]);
  showStatus(accountStatusBar, '已断开连接');
});
```

### Database Section (Lines 202-228)

This sends `fetchDatabases` message to background worker:

```javascript
btnRefreshDbs.addEventListener('click', async () => {
  btnRefreshDbs.disabled = true;
  btnRefreshDbs.textContent = '同步中…';
  showStatus(dbStatusBar, '正在从 Notion 拉取数据库列表…');
  
  // *** CALLS BACKGROUND MESSAGE - WILL STILL WORK ***
  chrome.runtime.sendMessage({ type: 'fetchDatabases' }, async (result) => {
    // ... handles response
  });
});
```

This requires `notionAccessToken` to be set first.

### Manual Database ID Input (Lines 230-251)

**This already exists and works for manual input:**

```javascript
btnAddDb.addEventListener('click', async () => {
  const id = inputDbId.value.trim().replace(/-/g, '');
  if (!id || id.length < 32) {
    showStatus(dbStatusBar, '请输入有效的 Database ID（32 位字符）', 'error');
    inputDbId.focus();
    return;
  }
  // ... validates and adds to storage
  const updated = [...notionDatabases, { id, name: id.slice(0, 8) + '…', icon: '📄' }];
  await chrome.storage.local.set({ notionDatabases: updated });
  // ...
});
```

### Changes Needed for Options Page

**1. Replace OAuth Button with Token Input Form**
- Add input field for Notion API token
- Add button to validate and save token
- Show current token status (masked)

**2. Update renderAccountSection()**
- Show token input form instead of OAuth button when not authenticated
- Display "✓ Token connected" instead of workspace info

**3. Update disconnect**
- Keep the same flow, but now just clears the manual token

**4. Workspace Display**
- Option A: Remove completely (don't need workspace info)
- Option B: Fetch and display workspace info using Notion API
- Option C: Show a placeholder/generic workspace name

---

## 3. UTILS - NOTION API (`utils/notion-api.js`)

### Current API Functions

All functions accept `token` as first parameter and use it in headers:

```javascript
function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
  };
}
```

### Key Functions (No Changes Needed for these)

1. **`fetchDatabases(token)`** - Gets all databases in workspace
   - Used by: `background.js` → `handleFetchDatabases`
   - Used by: `options.js` "同步" button

2. **`createPage(token, databaseId, fields)`** - Creates new page
   - Used by: `background.js` → `handleSaveToNotion`
   - Used by: `content.js` → save flow

3. **`updatePage(token, pageId, updates)`** - Updates page properties
   - Used by: `background.js` → `handleUpdateNotionPage`
   - Used by: `content.js` → edit panel

4. **`buildProperties(fields, fieldMapping)`** - Converts fields to Notion format
   - Pure utility function, no token needed

**No changes needed here** - these functions will continue to work with manual tokens.

---

## 4. CONFIG FILE (`utils/config.js`)

### Current Configuration

```javascript
// OAuth Client ID (public, safe in frontend code)
export const CLIENT_ID = '33dd872b-594c-8114-b066-00372870058d';

// Cloudflare Worker URL for OAuth token exchange
export const WORKER_URL = 'https://notion-oauth.notion-oauth-tylerhu.workers.dev';

// Chrome Extension OAuth callback URI
export const EXTENSION_REDIRECT_URI = 'https://kakinmibfnkblliifpeaajkpeddcloic.chromiumapp.org/callback';

// Notion OAuth authorization endpoint
export const NOTION_AUTH_URL = 'https://api.notion.com/v1/oauth/authorize';

// Storage keys
export const STORAGE_KEY_TOKEN = 'notionAccessToken';
export const STORAGE_KEY_DATABASES = 'notionDatabases';
export const STORAGE_KEY_DEFAULT_DB = 'notionDefaultDatabase';
export const STORAGE_KEY_FIELD_MAP = 'notionFieldMap';
```

### Changes Needed

**Remove these (no longer used):**
```javascript
// ❌ DELETE
export const CLIENT_ID = '33dd872b-594c-8114-b066-00372870058d';
export const WORKER_URL = 'https://notion-oauth.notion-oauth-tylerhu.workers.dev';
export const EXTENSION_REDIRECT_URI = 'https://kakinmibfnkblliifpeaajkpeddcloic.chromiumapp.org/callback';
export const NOTION_AUTH_URL = 'https://api.notion.com/v1/oauth/authorize';
```

**Keep these:**
```javascript
// ✓ KEEP
export const NOTION_API_BASE = 'https://api.notion.com/v1';
export const NOTION_VERSION = '2022-06-28';
export const STORAGE_KEY_TOKEN = 'notionAccessToken';
export const STORAGE_KEY_DATABASES = 'notionDatabases';
export const STORAGE_KEY_DEFAULT_DB = 'notionDefaultDatabase';
export const STORAGE_KEY_FIELD_MAP = 'notionFieldMap';
export const CONTEXT_MENU_ID = 'save-to-notion';
```

---

## 5. BACKGROUND SERVICE WORKER (`background.js`)

### Imports to Remove

```javascript
// ❌ REMOVE THESE
import {
  CLIENT_ID,
  WORKER_URL,
  NOTION_AUTH_URL,
  EXTENSION_REDIRECT_URI,
  // ... keep the STORAGE_KEY_* constants
} from './utils/config.js';
```

### OAuth Handler Function (Lines 95-153)

**ENTIRE FUNCTION NEEDS REMOVAL:**

```javascript
async function handleStartOAuth(sendResponse) {
  // redirect_uri 直接用 chromiumapp.org，chrome.identity 可以可靠拦截
  const redirectUri = encodeURIComponent(EXTENSION_REDIRECT_URI);
  const authUrl =
    `${NOTION_AUTH_URL}?client_id=${CLIENT_ID}` +
    `&response_type=code` +
    `&owner=user` +
    `&redirect_uri=${redirectUri}`;

  // *** THIS CHROME.IDENTITY API CALL NEEDS REMOVAL ***
  chrome.identity.launchWebAuthFlow(
    { url: authUrl, interactive: true },
    async (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        sendResponse({ success: false, error: chrome.runtime.lastError?.message ?? '授权被取消' });
        return;
      }

      try {
        // Notion 把 code 放在 query string 中
        const code = new URL(redirectUrl).searchParams.get('code');
        if (!code) {
          sendResponse({ success: false, error: '未获取到授权 code' });
          return;
        }

        // *** CALLS CLOUDFLARE WORKER - NEEDS REMOVAL ***
        const res = await fetch(`${WORKER_URL}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirect_uri: EXTENSION_REDIRECT_URI }),
        });

        const data = await res.json();

        if (!res.ok || data.error) {
          sendResponse({ success: false, error: data.error ?? '换取 token 失败' });
          return;
        }

        if (!data.access_token) {
          sendResponse({ success: false, error: '授权响应中未包含 access_token，请重新连接' });
          return;
        }

        // *** SAVES OAUTH RESPONSE TO STORAGE ***
        await chrome.storage.local.set({
          [STORAGE_KEY_TOKEN]: data.access_token,
          notionWorkspace: {
            name: data.workspace_name ?? '',
            icon: data.workspace_icon ?? '',
          },
        });

        sendResponse({ success: true, workspaceName: data.workspace_name, workspaceIcon: data.workspace_icon });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
  );
}
```

### Message Router (Lines 63-90)

**Needs modification:**

```javascript
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'startOAuth':
      // ❌ REMOVE THIS CASE
      handleStartOAuth(sendResponse);
      return true; // 异步 sendResponse

    case 'fetchDatabases':
      // ✓ KEEP THIS
      handleFetchDatabases(sendResponse).catch(err =>
        sendResponse({ error: err.message })
      );
      return true;

    case 'saveToNotion':
      // ✓ KEEP THIS
      handleSaveToNotion(message, sendResponse).catch(err =>
        sendResponse({ success: false, error: err.message })
      );
      return true;

    case 'updateNotionPage':
      // ✓ KEEP THIS
      handleUpdateNotionPage(message, sendResponse).catch(err =>
        sendResponse({ success: false, error: err.message })
      );
      return true;

    default:
      return false;
  }
});
```

### Other Handlers (No Changes Needed)

- `handleFetchDatabases()` - Lines 158-174 ✓ KEEP
- `handleSaveToNotion()` - Lines 179-209 ✓ KEEP
- `handleUpdateNotionPage()` - Lines 214-231 ✓ KEEP

All these check for `notionAccessToken` in storage and fail gracefully if not present.

---

## 6. MANIFEST PERMISSIONS (`manifest.json`)

### Current Permissions

```json
"permissions": [
    "identity",              // ❌ REMOVE - Only needed for chrome.identity.launchWebAuthFlow
    "storage",              // ✓ KEEP - For localStorage
    "contextMenus",         // ✓ KEEP - For right-click menu
    "activeTab",            // ✓ KEEP - For content script
    "scripting",            // ✓ KEEP - For content script
    "tabs"                  // ✓ KEEP - For tab access
]
```

### Changes Needed
Remove `"identity"` permission from manifest.json

---

## 7. CONTENT SCRIPT (`scripts/content.js`)

### Storage References

```javascript
// Lines 51-56
const storage = await chrome.storage.local.get([
  'notionDatabases',           // ✓ KEEP
  'notionDefaultDatabase',      // ✓ KEEP
]);
```

### No OAuth References

Content script doesn't directly interact with OAuth or tokens. It:
1. Receives message from background worker
2. Shows toast UI
3. Sends `saveToNotion` message to background

**No changes needed** for content.js

---

## 8. OAUTH WORKER (`oauth-worker/src/index.js`)

### Current Responsibility

This Cloudflare Worker acts as OAuth token intermediary:
1. Receives authorization code from Notion
2. Exchanges code for token using CLIENT_SECRET (kept secret in Worker env)
3. Returns token to extension

### Changes Needed

**Can be deleted entirely** or kept for other purposes. The extension will no longer call it.

---

## SUMMARY: ALL REFERENCES TO REMOVE

### 1. **Config File** (`utils/config.js`)
- ❌ `CLIENT_ID`
- ❌ `WORKER_URL`
- ❌ `EXTENSION_REDIRECT_URI`
- ❌ `NOTION_AUTH_URL`

### 2. **Background Service Worker** (`background.js`)
- ❌ Import: `CLIENT_ID`, `WORKER_URL`, `NOTION_AUTH_URL`, `EXTENSION_REDIRECT_URI`
- ❌ Function: `handleStartOAuth()` (entire function)
- ❌ Message case: `case 'startOAuth':`
- ❌ Function comment mentioning "OAuth 授权流程"

### 3. **Options Page** (`options/options.js`)
- ❌ Element reference: `btnOAuth` (can keep if repurposing for manual token input)
- ❌ Event listener on `btnOAuth` (lines 104-119) - REPLACE with manual token input handler
- ❌ `renderAccountSection()` logic that checks OAuth state

### 4. **Popup** (`popup/popup.js`)
- ✓ No OAuth-specific code (just checks for `notionAccessToken`)
- ✓ May need minor updates if workspace display is changed

### 5. **Options HTML** (`options/options.html`)
- ❌ OAuth button element: `#btn-oauth` (replace with token input)
- ✓ Keep disconnect button

### 6. **Popup HTML** (`popup/popup.html`)
- ✓ No OAuth-specific elements

### 7. **Manifest** (`manifest.json`)
- ❌ `"identity"` permission

### 8. **Tests** (`tests/background/oauth.test.js`)
- ❌ Entire OAuth test file (optional - can delete or update)

### 9. **Mocks** (`tests/__mocks__/chrome.js`)
- ❌ `identity.launchWebAuthFlow` mock

### 10. **OAuth Worker** (`oauth-worker/`)
- ❌ Can be deleted entirely (no longer used)

---

## STORAGE KEYS AFFECTED

### Completely Remove from Storage
- ❌ `notionWorkspace` - No longer needed (workspace info comes from OAuth)

### Keep in Storage
- ✓ `notionAccessToken` - Now stored manually instead of from OAuth
- ✓ `notionDatabases` - Still populated by `fetchDatabases` call
- ✓ `notionDefaultDatabase` - User selection
- ✓ `notionFieldMap` - Field mapping config
- ✓ `lastSaved` - Last saved page info

---

## NEW FEATURE REQUIREMENTS

To replace OAuth, implement:

1. **Token Input UI in Options Page**
   - Text input field for manual token entry
   - Validate token (optional - attempt API call to test)
   - Show token status with "✓ Connected" when valid
   - Clear token button (same as disconnect)

2. **Optional: Manual Workspace Input**
   - Alternative: Keep workspace field blank/generic
   - Or: Add manual workspace name input (cosmetic only)

3. **Storage Changes**
   - When user enters token → save to `notionAccessToken`
   - Remove logic that sets `notionWorkspace`

4. **Validation**
   - Test token validity by attempting `fetchDatabases` call
   - Show error if token is invalid
   - Show success message if valid

