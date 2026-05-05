# OAuth Removal - Implementation Checklist

## Quick Reference: What to Change

### 1. FILES TO DELETE
- [ ] `/oauth-worker/` - entire directory (no longer used)
- [ ] `/tests/background/oauth.test.js` - OAuth test (optional)

### 2. FILES TO MODIFY

#### `utils/config.js` - REMOVE 4 CONSTANTS
```javascript
// DELETE these lines:
export const CLIENT_ID = '33dd872b-594c-8114-b066-00372870058d';
export const WORKER_URL = 'https://notion-oauth.notion-oauth-tylerhu.workers.dev';
export const EXTENSION_REDIRECT_URI = 'https://kakinmibfnkblliifpeaajkpeddcloic.chromiumapp.org/callback';
export const NOTION_AUTH_URL = 'https://api.notion.com/v1/oauth/authorize';
```

#### `manifest.json` - REMOVE PERMISSION
```json
// In "permissions" array, delete:
"identity",
```

#### `background.js` - 2 CHANGES

**Change 1: Remove imports** (lines 15-23)
```javascript
// BEFORE:
import {
  CLIENT_ID,
  WORKER_URL,
  NOTION_AUTH_URL,
  EXTENSION_REDIRECT_URI,
  STORAGE_KEY_TOKEN,
  STORAGE_KEY_DATABASES,
  CONTEXT_MENU_ID,
} from './utils/config.js';

// AFTER:
import {
  STORAGE_KEY_TOKEN,
  STORAGE_KEY_DATABASES,
  CONTEXT_MENU_ID,
} from './utils/config.js';
```

**Change 2: Remove entire handler function** (lines 95-153)
```javascript
// DELETE THIS ENTIRE FUNCTION:
async function handleStartOAuth(sendResponse) {
  // ... 60+ lines ...
}
```

**Change 3: Remove message case** (lines 65-67)
```javascript
// DELETE from switch statement:
case 'startOAuth':
  handleStartOAuth(sendResponse);
  return true; // 异步 sendResponse
```

#### `options/options.html` - REPLACE OAUTH BUTTON

**Change 1: Replace OAuth button** (lines 56-65)
```html
<!-- BEFORE: -->
<div id="account-unauthenticated" class="card" hidden>
  <p class="card-description">连接你的 Notion 账号，开始一键保存网页内容。</p>
  <button id="btn-oauth" class="btn btn-primary" aria-label="通过 OAuth 连接 Notion">
    <svg>...</svg>
    连接 Notion
  </button>
</div>

<!-- AFTER: -->
<div id="account-unauthenticated" class="card" hidden>
  <p class="card-description">输入你的 Notion API Token 来连接账号。</p>
  <div class="field-group">
    <label for="token-input" class="field-label">Notion API Token</label>
    <div class="input-row">
      <input
        id="token-input"
        type="password"
        name="notion-token"
        autocomplete="off"
        placeholder="ntn_***"
        aria-label="输入 Notion API Token"
      />
      <button id="btn-save-token" class="btn btn-primary" aria-label="保存 Token">
        保存
      </button>
    </div>
  </div>
  <div aria-live="polite" id="token-status" class="status-bar" hidden></div>
</div>
```

#### `options/options.js` - MAJOR CHANGES

**Change 1: Update DOM references** (lines 2-8)
```javascript
// BEFORE:
const btnOAuth = document.getElementById('btn-oauth');

// AFTER:
const tokenInput = document.getElementById('token-input');
const btnSaveToken = document.getElementById('btn-save-token');
const tokenStatus = document.getElementById('token-status');
```

**Change 2: Replace OAuth event listener** (lines 104-119)
```javascript
// DELETE THIS:
btnOAuth.addEventListener('click', async () => {
  // ... 15 lines of OAuth code ...
});

// REPLACE WITH THIS:
btnSaveToken.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showStatus(tokenStatus, '请输入 Token', 'error');
    tokenInput.focus();
    return;
  }

  btnSaveToken.disabled = true;
  btnSaveToken.textContent = '保存中…';
  showStatus(tokenStatus, '正在验证 Token…');

  try {
    // Test token validity with fetchDatabases call
    const storage = await chrome.storage.local.get('notionAccessToken');
    
    // Temporarily set token to test it
    await chrome.storage.local.set({ notionAccessToken: token });
    
    // Try to fetch databases to validate
    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'fetchDatabases' }, resolve);
    });

    if (result?.error) {
      // Token invalid, remove it
      await chrome.storage.local.remove('notionAccessToken');
      throw new Error(result.error);
    }

    // Token valid - keep it saved
    showStatus(tokenStatus, '✓ Token 保存成功', 'success');
    tokenInput.value = '';
    init();
  } catch (err) {
    await chrome.storage.local.remove('notionAccessToken');
    showStatus(tokenStatus, '✗ Token 验证失败：' + err.message, 'error');
    btnSaveToken.disabled = false;
    btnSaveToken.textContent = '保存';
  }
});
```

**Change 3: Update renderAccountSection()** (lines 91-102)
```javascript
// BEFORE:
function renderAccountSection(token, workspace) {
  if (token) {
    accountAuthenticated.hidden = false;
    accountUnauthenticated.hidden = true;
    accountWorkspace.textContent = workspace?.name || '我的工作区';
    accountIcon.src = workspace?.icon || '../images/icon-48.png';
    accountIcon.alt = workspace?.name || '';
  } else {
    accountUnauthenticated.hidden = false;
    accountAuthenticated.hidden = true;
  }
}

// AFTER:
function renderAccountSection(token, workspace) {
  if (token) {
    accountAuthenticated.hidden = false;
    accountUnauthenticated.hidden = true;
    accountWorkspace.textContent = '✓ Token 已连接';
    accountIcon.src = '../images/icon-48.png';
    accountIcon.alt = 'Connected';
  } else {
    accountUnauthenticated.hidden = false;
    accountAuthenticated.hidden = true;
  }
}
```

**Change 4: Update disconnect handler** (lines 121-134)
```javascript
// REMOVE notionWorkspace from the removal list:
await chrome.storage.local.remove([
  'notionAccessToken',
  // 'notionWorkspace',  // <- DELETE THIS LINE
  'notionDatabases',
  'notionDefaultDatabase',
  'lastSaved',
]);
```

#### `popup/popup.js` - OPTIONAL CHANGES

**Optional Change 1: Remove workspace display** (lines 51-53)
```javascript
// Option A: Keep as-is (will show "我的工作区")
// Option B: Change to show something simpler:
workspaceName.textContent = 'Notion';
workspaceIcon.src = '../images/icon-48.png';
```

#### `tests/__mocks__/chrome.js` - OPTIONAL

**Optional: Remove mock** (lines 47-49)
```javascript
// DELETE:
identity: {
  launchWebAuthFlow: vi.fn(),
},
```

#### `tests/background/message-router.test.js` - OPTIONAL

Remove any OAuth-related tests or update them.

---

## Testing Checklist After Changes

- [ ] Extension loads without errors
- [ ] Popup shows "连接 Notion" button
- [ ] Can enter token in options page
- [ ] Token validation works (connects to Notion API)
- [ ] "✓ Token 已连接" shows after successful token entry
- [ ] Can still add databases manually by ID
- [ ] "同步" button still works with valid token
- [ ] "保存到 Notion" context menu still works
- [ ] Disconnect button clears token
- [ ] No references to chrome.identity in console

---

## Edge Cases to Handle

1. **Invalid token format** - Show error message
2. **Network error during token test** - Show error, don't save token
3. **Empty token input** - Prevent save, focus input
4. **Token expires** - User needs to re-enter (handled by API errors)
5. **Switching tokens** - Clear old databases and let user re-sync

---

## Performance Notes

- Token validation happens only on save (not real-time)
- Consider debouncing if adding real-time validation
- No performance impact from removing OAuth

---

## Security Notes

- Token input uses `type="password"` for masking
- Token stored in `chrome.storage.local` (extension isolated storage)
- No token ever sent to third-party servers (OAuth Worker removed)
- Users responsible for token security

---

## Files Reference

```
text2notion_chrome_plugin/
├── OAUTH_REMOVAL_ANALYSIS.md          ← Read this for detailed info
├── OAUTH_REMOVAL_CHECKLIST.md         ← You are here
│
├── utils/
│   └── config.js                      ← Remove 4 constants
│
├── manifest.json                      ← Remove "identity" permission
│
├── background.js                      ← Remove imports, handler, case
│
├── options/
│   ├── options.html                   ← Replace OAuth button
│   └── options.js                     ← Major changes (4 sections)
│
├── popup/
│   ├── popup.html                     ← No changes (optional: update text)
│   └── popup.js                       ← Optional: update workspace display
│
├── oauth-worker/                      ← DELETE THIS DIRECTORY
│   ├── src/index.js
│   ├── package.json
│   └── wrangler.toml
│
└── tests/
    ├── __mocks__/chrome.js            ← Optional: remove identity mock
    ├── background/oauth.test.js       ← Optional: delete
    └── background/message-router.test.js ← Optional: update
```

