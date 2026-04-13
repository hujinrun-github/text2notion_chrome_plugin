/**
 * fetch Mock 工厂函数
 * 供各测试文件按需 import，不全局注入
 */
import { vi } from 'vitest';

/**
 * 创建单次 fetch mock
 * @param {object} options
 * @param {number} options.status  HTTP 状态码，默认 200
 * @param {object|string} options.body  响应体，对象会自动序列化为 JSON
 * @param {object} options.headers  额外响应头
 */
export function makeFetchMock({ status = 200, body = {}, headers = {} } = {}) {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
    json: vi.fn().mockResolvedValue(typeof body === 'string' ? JSON.parse(body) : body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  };
  return vi.fn().mockResolvedValue(response);
}

/**
 * 创建多次顺序调用 fetch mock（每次调用返回不同响应）
 * @param {Array<{status, body}>} responses  按调用顺序排列的响应列表
 */
export function makeFetchMockSequence(responses) {
  const mockFn = vi.fn();
  responses.forEach(({ status = 200, body = {}, headers = {} }, index) => {
    const response = {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
      json: vi.fn().mockResolvedValue(typeof body === 'string' ? JSON.parse(body) : body),
      text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    };
    mockFn.mockResolvedValueOnce(response);
  });
  return mockFn;
}
