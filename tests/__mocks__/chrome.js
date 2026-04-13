/**
 * Chrome Extension API 全局 Mock
 * 在每个测试前自动重置所有 spy
 */
import { vi, beforeEach } from 'vitest';

// 独立存储注册的监听器，不受 vi.clearAllMocks() 影响
const _messageListeners = [];
const _installedListeners = [];
const _contextMenuClickListeners = [];

const chromeMock = {
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(),
    openOptionsPage: vi.fn(),
    onInstalled: {
      addListener: vi.fn((fn) => {
        _installedListeners.push(fn);
      }),
      _trigger(details) {
        _installedListeners.forEach((fn) => fn(details || { reason: 'install' }));
      },
      get _listeners() {
        return _installedListeners;
      },
    },
    onMessage: {
      addListener: vi.fn((fn) => {
        _messageListeners.push(fn);
      }),
      _trigger(message, sender, sendResponse) {
        _messageListeners.forEach((fn) => fn(message, sender || {}, sendResponse || vi.fn()));
      },
      get _listeners() {
        return _messageListeners;
      },
    },
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: {
      addListener: vi.fn((fn) => {
        _contextMenuClickListeners.push(fn);
      }),
      _trigger(info, tab) {
        _contextMenuClickListeners.forEach((fn) => fn(info, tab || {}));
      },
      get _listeners() {
        return _contextMenuClickListeners;
      },
    },
  },
  tabs: {
    sendMessage: vi.fn(),
  },
};

// 挂载到 globalThis，让所有测试文件可以直接访问 chrome
globalThis.chrome = chromeMock;

// jsdom 不提供 window.matchMedia，content.js 中 removeToast 需要用到
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// 每个测试前重置所有 mock，避免用例间互相污染
beforeEach(() => {
  vi.clearAllMocks();

  // 重置默认返回值
  chromeMock.storage.local.get.mockResolvedValue({});
  chromeMock.storage.local.set.mockResolvedValue(undefined);
  chromeMock.storage.local.remove.mockResolvedValue(undefined);

  // 重新绑定 addListener 的 mockImplementation（clearAllMocks 会清除实现）
  chromeMock.runtime.onInstalled.addListener.mockImplementation((fn) => {
    _installedListeners.push(fn);
  });
  chromeMock.runtime.onMessage.addListener.mockImplementation((fn) => {
    _messageListeners.push(fn);
  });
  chromeMock.contextMenus.onClicked.addListener.mockImplementation((fn) => {
    _contextMenuClickListeners.push(fn);
  });
});
