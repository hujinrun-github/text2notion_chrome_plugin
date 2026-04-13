/**
 * tests/utils/notion-api.test.js
 * TDD: notion-api.js 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeFetchMock, makeFetchMockSequence } from '../__mocks__/fetch.js';

// 被测模块
import {
  fetchDatabases,
  createPage,
  updatePage,
  buildProperties,
} from '../../utils/notion-api.js';

const MOCK_TOKEN = 'notion-test-token-xyz';

describe('fetchDatabases', () => {
  it('向 /v1/search 发送 POST，filter.value 为 database', async () => {
    globalThis.fetch = makeFetchMock({
      body: { results: [] },
    });

    await fetchDatabases(MOCK_TOKEN);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('/v1/search');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.filter?.value).toBe('database');
  });

  it('请求头包含 Authorization: Bearer <token> 和 Notion-Version', async () => {
    globalThis.fetch = makeFetchMock({ body: { results: [] } });

    await fetchDatabases(MOCK_TOKEN);

    const [, init] = fetch.mock.calls[0];
    expect(init.headers['Authorization']).toBe(`Bearer ${MOCK_TOKEN}`);
    expect(init.headers['Notion-Version']).toBeTruthy();
  });

  it('返回格式化后的 [{ id, name, icon }] 数组', async () => {
    const fakeDBs = [
      { id: 'db-1', title: [{ plain_text: 'My DB' }], icon: { type: 'emoji', emoji: '📚' } },
      { id: 'db-2', title: [{ plain_text: 'Another DB' }], icon: null },
    ];
    globalThis.fetch = makeFetchMock({ body: { results: fakeDBs } });

    const result = await fetchDatabases(MOCK_TOKEN);

    expect(result).toEqual([
      { id: 'db-1', name: 'My DB', icon: '📚' },
      { id: 'db-2', name: 'Another DB', icon: '📄' },
    ]);
  });

  it('Notion API 返回错误时抛出含 status 的 Error', async () => {
    globalThis.fetch = makeFetchMock({ status: 401, body: { message: 'Unauthorized' } });

    await expect(fetchDatabases(MOCK_TOKEN)).rejects.toThrow('401');
  });
});

describe('createPage', () => {
  const fakePageId = 'new-page-id-123';

  // createPage 先 GET /databases/{id} 获取 title 属性名，再 POST /pages 创建页面
  // 因此需要 mock 两次 fetch
  const fakeDbResponse = {
    properties: { Name: { type: 'title' }, Content: { type: 'rich_text' } },
  };

  it('向 /v1/pages 发送 POST', async () => {
    globalThis.fetch = makeFetchMockSequence([
      { body: fakeDbResponse },
      { body: { id: fakePageId } },
    ]);

    await createPage(MOCK_TOKEN, 'db-1', { title: 'Test', content: 'Hello' });

    // 第二次调用是 POST /pages
    const [url, init] = fetch.mock.calls[1];
    expect(url).toContain('/v1/pages');
    expect(init.method).toBe('POST');
  });

  it('parent.database_id 设置为传入的 databaseId', async () => {
    globalThis.fetch = makeFetchMockSequence([
      { body: fakeDbResponse },
      { body: { id: fakePageId } },
    ]);

    await createPage(MOCK_TOKEN, 'my-db-id', { title: 'Hello', content: 'World' });

    const body = JSON.parse(fetch.mock.calls[1][1].body);
    expect(body.parent?.database_id).toBe('my-db-id');
  });

  it('properties 中包含正确的 title rich_text', async () => {
    globalThis.fetch = makeFetchMockSequence([
      { body: fakeDbResponse },
      { body: { id: fakePageId } },
    ]);

    await createPage(MOCK_TOKEN, 'db-x', { title: 'My Title', content: 'Content here' });

    const body = JSON.parse(fetch.mock.calls[1][1].body);
    const titleProp = Object.values(body.properties ?? {}).find(
      (p) => p.title || p.type === 'title'
    );
    const titleText =
      titleProp?.title?.[0]?.text?.content ?? titleProp?.[0]?.text?.content;
    expect(titleText).toBe('My Title');
  });

  it('返回新页面的 id', async () => {
    globalThis.fetch = makeFetchMockSequence([
      { body: fakeDbResponse },
      { body: { id: fakePageId } },
    ]);

    const result = await createPage(MOCK_TOKEN, 'db-1', { title: 'T', content: 'C' });

    expect(result.id).toBe(fakePageId);
  });

  it('内容超过 2000 字时截断为 2000 字', async () => {
    globalThis.fetch = makeFetchMockSequence([
      { body: fakeDbResponse },
      { body: { id: fakePageId } },
    ]);
    const longContent = 'x'.repeat(3000);

    await createPage(MOCK_TOKEN, 'db-1', { title: 'T', content: longContent });

    const body = JSON.parse(fetch.mock.calls[1][1].body);
    // 找到 children 中的段落 rich_text 内容
    const children = body.children ?? [];
    const textContent = children
      .flatMap((b) => b.paragraph?.rich_text ?? [])
      .map((rt) => rt.text?.content ?? '')
      .join('');
    expect(textContent.length).toBeLessThanOrEqual(2000);
  });

  it('Notion API 返回错误时抛出 Error', async () => {
    globalThis.fetch = makeFetchMockSequence([
      { body: fakeDbResponse },
      { status: 400, body: { message: 'Bad Request' } },
    ]);

    await expect(createPage(MOCK_TOKEN, 'db-1', { title: 'T', content: 'C' })).rejects.toThrow();
  });
});

describe('updatePage', () => {
  it('向 /v1/pages/:pageId 发送 PATCH', async () => {
    globalThis.fetch = makeFetchMock({ body: { id: 'page-1' } });

    await updatePage(MOCK_TOKEN, 'page-1', { note: 'updated' });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('/v1/pages/page-1');
    expect(init.method).toBe('PATCH');
  });

  it('Notion API 错误时抛出 Error', async () => {
    globalThis.fetch = makeFetchMock({ status: 404, body: { message: 'Not Found' } });

    await expect(updatePage(MOCK_TOKEN, 'page-1', {})).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// buildProperties（纯函数，无需 fetch）
// ─────────────────────────────────────────────────────────────
describe('buildProperties', () => {
  it('给定 title 字段映射，返回 title rich_text 结构', () => {
    const result = buildProperties(
      { title: 'My Page' },
      { title: 'Name' }
    );
    expect(result).toHaveProperty('Name');
    expect(result['Name'].title[0].text.content).toBe('My Page');
  });

  it('给定 rich_text 字段映射（如 content），返回 rich_text 结构', () => {
    const result = buildProperties(
      { content: 'Hello World' },
      { content: 'Body' }
    );
    expect(result).toHaveProperty('Body');
    expect(result['Body'].rich_text[0].text.content).toBe('Hello World');
  });

  it('给定 url 字段映射（sourceUrl），返回 url 结构', () => {
    const result = buildProperties(
      { sourceUrl: 'https://example.com' },
      { sourceUrl: 'Source' }
    );
    expect(result).toHaveProperty('Source');
    expect(result['Source'].url).toBe('https://example.com');
  });

  it('给定 date 字段映射（capturedAt），返回 date 结构', () => {
    const iso = '2026-04-09T00:00:00.000Z';
    const result = buildProperties(
      { capturedAt: iso },
      { capturedAt: 'Date' }
    );
    expect(result).toHaveProperty('Date');
    expect(result['Date'].date.start).toBe(iso);
  });

  it('给定 multi_select 字段映射（tags），返回 multi_select 结构', () => {
    const result = buildProperties(
      { tags: ['A', 'B'] },
      { tags: 'Tags' }
    );
    expect(result).toHaveProperty('Tags');
    expect(result['Tags'].multi_select).toEqual([{ name: 'A' }, { name: 'B' }]);
  });

  it('字段映射中没有对应 key 时，忽略该字段', () => {
    const result = buildProperties(
      { title: 'My Title', content: 'Body text' },
      { title: 'Name' }  // content 没有映射
    );
    expect(Object.keys(result)).toEqual(['Name']);
  });

  it('fields 中值为空字符串时，不写入 properties', () => {
    const result = buildProperties(
      { title: '', content: 'something' },
      { title: 'Name', content: 'Body' }
    );
    expect(result).not.toHaveProperty('Name');
    expect(result).toHaveProperty('Body');
  });

  it('fields 为空对象时，返回空 properties', () => {
    const result = buildProperties({}, { title: 'Name' });
    expect(result).toEqual({});
  });
});
