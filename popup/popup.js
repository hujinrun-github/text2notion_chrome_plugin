const viewUnauthenticated = document.getElementById('view-unauthenticated');
const viewAuthenticated = document.getElementById('view-authenticated');
const selectDatabase = document.getElementById('select-database');
const sectionLastSaved = document.getElementById('section-last-saved');
const lastSavedLink = document.getElementById('last-saved-link');
const lastSavedTitle = document.getElementById('last-saved-title');
const statusMessage = document.getElementById('status-message');
const btnConnect = document.getElementById('btn-connect');
const btnSettings = document.getElementById('btn-settings');

function showStatus(msg, isError = false) {
  statusMessage.textContent = msg;
  statusMessage.classList.toggle('error', isError);
  statusMessage.hidden = false;
}

function hideStatus() {
  statusMessage.hidden = true;
}

/** 从原始 Notion API 对象或手动添加的对象中提取可读名称 */
function getDbName(db) {
  return db.name || db.title?.[0]?.plain_text || db.id;
}

async function init() {
  const {
    notionAccessToken,
    notionDatabases,
    notionDefaultDatabase,
    lastSaved,
  } = await chrome.storage.local.get([
    'notionAccessToken',
    'notionDatabases',
    'notionDefaultDatabase',
    'lastSaved',
  ]);

  if (!notionAccessToken) {
    // view-unauthenticated 默认可见，无需额外操作
    return;
  }

  // 已登录：切换视图
  viewUnauthenticated.hidden = true;
  viewAuthenticated.hidden = false;

  // 填充数据库列表
  const databases = notionDatabases || [];
  if (databases.length) {
    selectDatabase.innerHTML = databases.map(db => {
      const name = getDbName(db);
      const icon = db.icon && typeof db.icon === 'string' ? db.icon + ' ' : '';
      return `<option value="${db.id}">${icon}${name}</option>`;
    }).join('');

    if (notionDefaultDatabase) {
      selectDatabase.value = notionDefaultDatabase;
    }
  } else {
    selectDatabase.innerHTML = '<option value="">— 请先在设置中添加数据库 —</option>';
  }

  // 上次保存
  if (lastSaved?.pageUrl) {
    lastSavedTitle.textContent = lastSaved.sourceTitle || lastSaved.pageUrl;
    lastSavedLink.href = lastSaved.pageUrl;
    sectionLastSaved.hidden = false;
  }
}

// 切换默认数据库
selectDatabase.addEventListener('change', async () => {
  await chrome.storage.local.set({ notionDefaultDatabase: selectDatabase.value });
});

// 连接 Notion
btnConnect.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// 打开设置
btnSettings.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

init().catch(err => {
  console.error('Popup init error:', err);
  // 确保未登录视图可见，并在其中显示错误
  viewUnauthenticated.hidden = false;
  viewAuthenticated.hidden = true;
  showStatus('加载失败，请重试', true);
});
