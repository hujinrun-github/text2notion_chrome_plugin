/**
 * utils/html-to-blocks.js
 * HTML → Notion Block 转换器
 *
 * 将 HTML 字符串解析为 Notion API 可接受的 block 数组。
 * 支持：段落、标题(h1~h6)、有序/无序列表、代码块、引用、图片、表格、链接、分割线、行内格式。
 */

const MAX_RICH_TEXT_LENGTH = 2000;

// ─────────────────────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────────────────────

/**
 * 将 HTML 字符串转换为 Notion blocks 数组
 * @param {string} html       - HTML 字符串
 * @param {string} [pageUrl]  - 当前页面 URL，用于解析相对路径
 * @returns {object[]}        - Notion block 对象数组
 */
// eslint-disable-next-line no-unused-vars
function htmlToBlocks(html, pageUrl = '') {
  if (!html || !html.trim()) {
    return [makeParagraphBlock([{ type: 'text', text: { content: '' } }])];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  return convertChildNodes(doc.body, pageUrl);
}

/**
 * 将一个容器元素的子节点转换为 blocks 数组。
 * 核心逻辑：连续的行内节点（文本、span、a、br 等）合并为一个 paragraph block，
 * 遇到块级元素时断开。
 */
function convertChildNodes(container, pageUrl) {
  const blocks = [];
  let inlineBuffer = []; // 暂存连续的行内 rich_text 片段

  function flushInlineBuffer() {
    if (inlineBuffer.length === 0) return;
    // 去掉首尾纯空白
    const trimmed = trimRichTextArray(inlineBuffer);
    if (trimmed.length === 0) {
      inlineBuffer = [];
      return;
    }

    // 检测纯文本内容是否像代码/JSON
    const plainText = richTextToPlainText(trimmed);
    if (looksLikeCode(plainText)) {
      blocks.push(makeCodeBlock(plainText, detectLanguage(plainText)));
    } else if (looksLikeLatex(plainText)) {
      // 纯文本中的 LaTeX 公式
      blocks.push({
        object: 'block',
        type: 'equation',
        equation: { expression: plainText },
      });
    } else {
      blocks.push(makeParagraphBlock(splitLongRichText(trimmed)));
    }
    inlineBuffer = [];
  }

  for (const child of container.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || '';
      if (text) {
        inlineBuffer.push(makeRichText(text));
      }
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName.toLowerCase();

    // LaTeX 块级公式检测
    const latex = extractLatex(child);
    if (latex) {
      flushInlineBuffer();
      blocks.push({
        object: 'block',
        type: 'equation',
        equation: { expression: latex },
      });
      continue;
    }

    // <br> → 行内换行
    if (tag === 'br') {
      inlineBuffer.push(makeRichText('\n'));
      continue;
    }

    // 行内元素 → 加入 buffer
    if (isInlineElement(tag)) {
      inlineBuffer.push(...parseInlineNode(child, pageUrl));
      continue;
    }

    // 块级元素 → 先 flush 行内 buffer，再处理块级
    flushInlineBuffer();
    blocks.push(...nodeToBlocks(child, pageUrl));
  }

  // 最后 flush 剩余行内内容
  flushInlineBuffer();

  return blocks;
}

// ─────────────────────────────────────────────────────────────
// 节点 → Blocks（块级转换）
// ─────────────────────────────────────────────────────────────

function nodeToBlocks(node, pageUrl) {
  // 文本节点不在这里处理（由 convertChildNodes 收集到 inlineBuffer）
  if (node.nodeType === Node.TEXT_NODE) {
    return [];
  }

  // 非元素节点跳过
  if (node.nodeType !== Node.ELEMENT_NODE) return [];

  const tag = node.tagName.toLowerCase();

  switch (tag) {
    // ── 标题 ──
    case 'h1':
      return [makeHeadingBlock(1, parseInlineChildren(node, pageUrl))];
    case 'h2':
      return [makeHeadingBlock(2, parseInlineChildren(node, pageUrl))];
    case 'h3':
      return [makeHeadingBlock(3, parseInlineChildren(node, pageUrl))];
    case 'h4':
    case 'h5':
    case 'h6':
      return [makeHeadingBlock(3, parseInlineChildren(node, pageUrl))];

    // ── 段落 ──
    case 'p': {
      // 如果段落内含有 img，需要拆分为多个 blocks
      if (node.querySelector('img')) {
        return convertChildNodes(node, pageUrl);
      }
      // 检测段落内容是否为代码/JSON
      const pText = node.textContent || '';
      if (looksLikeCode(pText.trim())) {
        return [makeCodeBlock(pText.trim(), detectLanguage(pText.trim()))];
      }
      return [makeParagraphBlock(parseInlineChildren(node, pageUrl))];
    }

    // ── 列表 ──
    case 'ul':
      return parseList(node, 'bulleted_list_item', pageUrl);
    case 'ol':
      return parseList(node, 'numbered_list_item', pageUrl);
    case 'li':
      return [makeParagraphBlock(parseInlineChildren(node, pageUrl))];

    // ── 代码块 ──
    case 'pre': {
      const codeEl = node.querySelector('code');
      const codeText = (codeEl || node).textContent || '';
      // 优先从 class 获取语言，否则自动检测内容
      const classLang = codeEl?.className?.match(/language-(\S+)/)?.[1]
        || node.className?.match(/language-(\S+)/)?.[1]
        || '';
      const lang = classLang ? normalizeLanguage(classLang) : detectLanguage(codeText);
      return [makeCodeBlock(codeText, lang)];
    }

    // ── 引用 ──
    case 'blockquote': {
      if (node.querySelector('img')) {
        return convertChildNodes(node, pageUrl);
      }
      return [makeQuoteBlock(parseInlineChildren(node, pageUrl))];
    }

    // ── 分割线 ──
    case 'hr':
      return [{ object: 'block', type: 'divider', divider: {} }];

    // ── 图片 ──
    case 'img':
      return parseImage(node, pageUrl);

    // ── 表格 ──
    case 'table':
      return parseTable(node, pageUrl);

    // ── <br> ──（块级上下文中单独出现的 br）
    case 'br':
      return [];

    // ── 容器元素（div/section 等）→ 递归子节点 ──
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'aside':
    case 'figure':
    case 'figcaption':
    case 'details':
    case 'summary':
    case 'nav':
    case 'header':
    case 'footer':
      return convertChildNodes(node, pageUrl);

    // ── 行内元素不应该到这里（由 convertChildNodes 处理） ──
    // ── 但如果到了，按段落处理 ──
    default: {
      if (hasBlockChildren(node)) {
        return convertChildNodes(node, pageUrl);
      }
      const richText = parseInlineChildren(node, pageUrl);
      if (richText.length === 0) return [];
      return [makeParagraphBlock(richText)];
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 行内节点 → RichText 数组
// ─────────────────────────────────────────────────────────────

/**
 * 解析元素的子节点为 Notion rich_text 数组
 */
function parseInlineChildren(element, pageUrl, annotations = {}) {
  const result = [];
  for (const child of element.childNodes) {
    result.push(...parseInlineNode(child, pageUrl, annotations));
  }
  return splitLongRichText(result);
}

/**
 * 解析单个节点为 rich_text 片段
 */
function parseInlineNode(node, pageUrl, annotations = {}) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    if (!text) return [];
    return [makeRichText(text, annotations)];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return [];

  const tag = node.tagName.toLowerCase();

  // LaTeX 公式检测（知乎 ztext-math、MathJax、KaTeX 等）
  const latex = extractLatex(node);
  if (latex) {
    return [{ type: 'equation', equation: { expression: latex } }];
  }

  // 行内格式
  const newAnnotations = { ...annotations };

  switch (tag) {
    case 'strong':
    case 'b':
      newAnnotations.bold = true;
      break;
    case 'em':
    case 'i':
      newAnnotations.italic = true;
      break;
    case 'code':
      newAnnotations.code = true;
      break;
    case 'u':
    case 'ins':
      newAnnotations.underline = true;
      break;
    case 's':
    case 'del':
    case 'strike':
      newAnnotations.strikethrough = true;
      break;
    case 'a': {
      const href = node.getAttribute('href') || '';
      const url = resolveUrl(href, pageUrl);
      const children = parseInlineChildren(node, pageUrl, newAnnotations);
      // 给每个 rich_text 加上 link
      return children.map(rt => ({
        ...rt,
        text: { ...rt.text, link: url ? { url } : undefined },
      }));
    }
    case 'br':
      return [makeRichText('\n', annotations)];
    case 'img': {
      // 行内图片 → 用 alt 文本代替
      const alt = node.getAttribute('alt') || '[image]';
      return [makeRichText(alt, annotations)];
    }
    case 'sup':
    case 'sub':
    case 'mark':
    case 'small':
    case 'span':
      // 无特殊标注，递归子节点
      break;
    default:
      break;
  }

  return parseInlineChildren(node, pageUrl, newAnnotations);
}

// ─────────────────────────────────────────────────────────────
// 列表解析
// ─────────────────────────────────────────────────────────────

function parseList(listNode, blockType, pageUrl) {
  const blocks = [];
  for (const child of listNode.children) {
    if (child.tagName.toLowerCase() === 'li') {
      // li 内可能有嵌套的 ul/ol
      const inlineContent = [];
      const nestedBlocks = [];

      for (const liChild of child.childNodes) {
        const liTag = liChild.nodeType === Node.ELEMENT_NODE ? liChild.tagName.toLowerCase() : '';
        if (liTag === 'ul' || liTag === 'ol') {
          const nestedType = liTag === 'ul' ? 'bulleted_list_item' : 'numbered_list_item';
          nestedBlocks.push(...parseList(liChild, nestedType, pageUrl));
        } else {
          inlineContent.push(...parseInlineNode(liChild, pageUrl));
        }
      }

      const richText = splitLongRichText(inlineContent);
      const block = {
        object: 'block',
        type: blockType,
        [blockType]: { rich_text: richText.length > 0 ? richText : [makeRichText('')] },
      };

      // 嵌套子列表作为 children
      if (nestedBlocks.length > 0) {
        block[blockType].children = nestedBlocks;
      }

      blocks.push(block);
    }
  }
  return blocks;
}

// ─────────────────────────────────────────────────────────────
// 图片解析
// ─────────────────────────────────────────────────────────────

function parseImage(imgNode, pageUrl) {
  const src = imgNode.getAttribute('src') || '';
  if (!src) return [];

  const url = resolveUrl(src, pageUrl);
  if (!url) return [];

  return [{
    object: 'block',
    type: 'image',
    image: {
      type: 'external',
      external: { url },
    },
  }];
}

// ─────────────────────────────────────────────────────────────
// 表格解析
// ─────────────────────────────────────────────────────────────

function parseTable(tableNode, pageUrl) {
  const rows = [];
  let maxCols = 0;
  const hasHeader = !!tableNode.querySelector('thead');

  // 收集所有行
  const trElements = tableNode.querySelectorAll('tr');
  for (const tr of trElements) {
    const cells = [];
    for (const cell of tr.children) {
      if (cell.tagName === 'TD' || cell.tagName === 'TH') {
        cells.push(parseInlineChildren(cell, pageUrl));
      }
    }
    if (cells.length > 0) {
      rows.push(cells);
      maxCols = Math.max(maxCols, cells.length);
    }
  }

  if (rows.length === 0 || maxCols === 0) return [];

  // 统一每行的列数
  const tableRows = rows.map(cells => {
    while (cells.length < maxCols) {
      cells.push([makeRichText('')]);
    }
    return {
      object: 'block',
      type: 'table_row',
      table_row: { cells: cells.slice(0, maxCols) },
    };
  });

  return [{
    object: 'block',
    type: 'table',
    table: {
      table_width: maxCols,
      has_column_header: hasHeader,
      has_row_header: false,
      children: tableRows,
    },
  }];
}

// ─────────────────────────────────────────────────────────────
// Block 构造辅助函数
// ─────────────────────────────────────────────────────────────

function makeParagraphBlock(richText) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: richText.length > 0 ? richText : [makeRichText('')] },
  };
}

function makeHeadingBlock(level, richText) {
  const type = `heading_${Math.min(level, 3)}`;
  return {
    object: 'block',
    type,
    [type]: { rich_text: richText.length > 0 ? richText : [makeRichText('')] },
  };
}

function makeCodeBlock(text, language = 'plain text') {
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: splitLongRichText(textToRichText(text)),
      language: normalizeLanguage(language),
    },
  };
}

function makeQuoteBlock(richText) {
  return {
    object: 'block',
    type: 'quote',
    quote: { rich_text: richText.length > 0 ? richText : [makeRichText('')] },
  };
}

function makeRichText(content, annotations = {}, link = undefined) {
  const rt = {
    type: 'text',
    text: { content },
  };
  if (link) {
    rt.text.link = { url: link };
  }

  const hasAnnotation = annotations.bold || annotations.italic || annotations.code
    || annotations.underline || annotations.strikethrough;
  if (hasAnnotation) {
    rt.annotations = {
      bold: !!annotations.bold,
      italic: !!annotations.italic,
      code: !!annotations.code,
      underline: !!annotations.underline,
      strikethrough: !!annotations.strikethrough,
    };
  }

  return rt;
}

function textToRichText(text) {
  if (!text) return [];
  return [makeRichText(text)];
}

/**
 * 将 rich_text 数组合并为纯文本
 */
function richTextToPlainText(richTextArray) {
  return richTextArray.map(rt => rt.text?.content || '').join('');
}

/**
 * 检测纯文本是否像代码/JSON（需满足多行 + 特征匹配）
 */
function looksLikeCode(text) {
  if (!text || text.length < 10) return false;
  const trimmed = text.trim();
  const lines = trimmed.split('\n');

  // JSON 对象（单行也检测）
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { JSON.parse(trimmed); return true; } catch (_) {}
    // 即使 parse 失败，看起来像 JSON 也算
    if (/^\{[\s\S]*"[\w]+"[\s]*:/.test(trimmed)) return true;
  }

  // JSON 数组（单行也检测）
  if (trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.includes('{')) {
    try { JSON.parse(trimmed); return true; } catch (_) {}
  }

  // 非 JSON 的代码检测需要多行
  if (lines.length < 2) return false;

  // 编程语言特征（至少匹配 3 个不同特征才判定为代码）
  const codePatterns = [
    /\b(function|const|let|var|import|export|return|class|if|else|for|while)\b/,
    /[={]>\s/,                        // 箭头函数
    /^\s{2,}([\w.]+\s*[=(])/m,       // 缩进 + 赋值/调用
    /[;{}]\s*$/m,                     // 行尾分号或大括号
    /\b(def|self|print|elif|lambda)\b/,  // Python
    /\b(func|fmt\.|package|go)\b/,       // Go
    /\b(pub fn|let mut|impl|use )\b/,    // Rust
    /^\s*(#include|using namespace)/m,   // C/C++
    /\b(SELECT|FROM|WHERE|INSERT|CREATE TABLE)\b/i, // SQL
    /^\$\s+\w+/m,                    // shell 命令
    /^\s*[\w-]+:\s+.+/m,             // YAML key: value
  ];

  let matchCount = 0;
  for (const pattern of codePatterns) {
    if (pattern.test(trimmed)) matchCount++;
  }

  return matchCount >= 2;
}

/**
 * 推断代码语言
 */
function detectLanguage(text) {
  const t = text.trim();

  // JSON
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { JSON.parse(t); return 'json'; } catch (_) {}
    if (/^\{[\s\S]*"[\w]+"[\s]*:/.test(t)) return 'json';
  }

  // Shell
  if (/^\$\s+\w+/m.test(t) || /^(npm|pip|brew|apt|yum|docker|git|curl|wget)\s/m.test(t)) return 'shell';

  // Python
  if (/\b(def |import |from .+ import|print\(|elif |lambda )/m.test(t)) return 'python';

  // Go
  if (/\b(func |package |fmt\.|go )/m.test(t)) return 'go';

  // Rust
  if (/\b(fn |let mut |impl |use std::)/m.test(t)) return 'rust';

  // SQL
  if (/\b(SELECT|FROM|WHERE|INSERT INTO|CREATE TABLE)\b/i.test(t)) return 'sql';

  // YAML / TOML
  if (/^[\w-]+:\s+.+/m.test(t) && !/{/.test(t)) return 'yaml';

  // TypeScript (before JS, because TS is a superset)
  if (/\b(interface |type |: string|: number|<[A-Z]\w*>)/m.test(t)) return 'typescript';

  // JavaScript
  if (/\b(const |let |var |function |=>|require\(|import )/m.test(t)) return 'javascript';

  // C/C++
  if (/^#include/m.test(t) || /\bstd::/m.test(t)) return 'c++';

  // Java
  if (/\b(public class |System\.out|void main)/m.test(t)) return 'java';

  // HTML/XML
  if (/^<\w+[\s>]/m.test(t) && /<\/\w+>/m.test(t)) return 'html';

  // CSS
  if (/\{[\s\S]*[\w-]+\s*:\s*[^;]+;/m.test(t) && /[.#@]\w+/m.test(t)) return 'css';

  return 'plain text';
}

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

/**
 * Notion rich_text 单个内容最长 2000 字符，超长自动拆分
 */
function splitLongRichText(richTextArray) {
  const result = [];
  for (const rt of richTextArray) {
    const content = rt.text?.content || '';
    if (content.length <= MAX_RICH_TEXT_LENGTH) {
      result.push(rt);
      continue;
    }
    // 拆分
    for (let i = 0; i < content.length; i += MAX_RICH_TEXT_LENGTH) {
      result.push({
        ...rt,
        text: { ...rt.text, content: content.slice(i, i + MAX_RICH_TEXT_LENGTH) },
      });
    }
  }
  return result;
}

/**
 * 解析 URL（相对路径 → 绝对路径）
 */
function resolveUrl(href, pageUrl) {
  if (!href) return '';
  // 已经是绝对 URL 或 data URL
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('data:')) {
    return href;
  }
  // 协议相对 URL
  if (href.startsWith('//')) {
    return 'https:' + href;
  }
  // 相对路径
  if (pageUrl) {
    try {
      return new URL(href, pageUrl).href;
    } catch (_) {}
  }
  return href;
}

/**
 * 将代码语言标识映射为 Notion API 接受的合法值
 */
const NOTION_LANGUAGES = new Set([
  'abap','abc','agda','arduino','ascii art','assembly','bash','basic','bnf',
  'c','c#','c++','clojure','coffeescript','coq','css','dart','dhall','diff',
  'docker','ebnf','elixir','elm','erlang','f#','flow','fortran','gherkin',
  'glsl','go','graphql','groovy','haskell','hcl','html','idris','java',
  'javascript','json','julia','kotlin','latex','less','lisp','livescript',
  'llvm ir','lua','makefile','markdown','markup','matlab','mathematica',
  'mermaid','nix','notion formula','objective-c','ocaml','pascal','perl',
  'php','plain text','powershell','prolog','protobuf','purescript','python',
  'r','racket','reason','ruby','rust','sass','scala','scheme','scss','shell',
  'smalltalk','solidity','sql','swift','toml','typescript','vb.net','verilog',
  'vhdl','visual basic','webassembly','xml','yaml','java/c/c++/c#',
]);

const LANGUAGE_ALIASES = {
  'js': 'javascript',
  'ts': 'typescript',
  'py': 'python',
  'rb': 'ruby',
  'sh': 'shell',
  'zsh': 'shell',
  'fish': 'shell',
  'yml': 'yaml',
  'text': 'plain text',
  'txt': 'plain text',
  'plaintext': 'plain text',
  'dockerfile': 'docker',
  'objective_c': 'objective-c',
  'objc': 'objective-c',
  'csharp': 'c#',
  'cpp': 'c++',
  'fsharp': 'f#',
  'vb': 'visual basic',
  'protobuffer': 'protobuf',
  'proto': 'protobuf',
  'asm': 'assembly',
  'jsx': 'javascript',
  'tsx': 'typescript',
  'graphql': 'graphql',
  'gql': 'graphql',
  'md': 'markdown',
  'tex': 'latex',
};

function normalizeLanguage(lang) {
  if (!lang) return 'plain text';
  const lower = lang.toLowerCase().trim();
  if (NOTION_LANGUAGES.has(lower)) return lower;
  if (LANGUAGE_ALIASES[lower]) return LANGUAGE_ALIASES[lower];
  return 'plain text';
}

/**
 * 检测纯文本是否像 LaTeX 公式
 */
function looksLikeLatex(text) {
  if (!text || text.length < 5) return false;
  const t = text.trim();
  // 包含多个 LaTeX 命令
  const latexCommands = /\\(frac|sqrt|sum|int|prod|lim|text|left|right|begin|end|alpha|beta|gamma|delta|theta|lambda|sigma|omega|infty|partial|nabla|cdot|times|div|pm|leq|geq|neq|approx|equiv|forall|exists|in|subset|supset|cup|cap|mathbb|mathcal|mathrm|operatorname)\b/g;
  const matches = t.match(latexCommands);
  return matches && matches.length >= 2;
}

/**
 * 从元素中提取 LaTeX 表达式（支持多种网站格式）
 * 返回 LaTeX 字符串，未检测到返回 null
 */
function extractLatex(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  // 1. 知乎：<span class="ztext-math" data-tex="...">
  const dataTex = node.getAttribute('data-tex');
  if (dataTex) return dataTex;

  // 2. MathJax <script type="math/tex"> 或 <script type="math/tex;mode=display">
  const mathScript = node.querySelector('script[type*="math/tex"]');
  if (mathScript) return mathScript.textContent?.trim() || null;

  // 3. KaTeX：<span class="katex"> 内有 <annotation encoding="application/x-tex">
  const katexAnnotation = node.querySelector('annotation[encoding="application/x-tex"]');
  if (katexAnnotation) return katexAnnotation.textContent?.trim() || null;

  // 4. 通用 data 属性
  const dataLatex = node.getAttribute('data-latex') || node.getAttribute('data-formula');
  if (dataLatex) return dataLatex;

  // 5. MathML <math> 内的 <annotation encoding="application/x-tex">
  if (node.tagName.toLowerCase() === 'math') {
    const ann = node.querySelector('annotation[encoding="application/x-tex"]');
    if (ann) return ann.textContent?.trim() || null;
  }

  // 6. 检测 class 名中是否有数学相关标记
  const cls = node.className || '';
  if (/\b(math|katex|mathjax|MathJax|tex2jax)\b/i.test(cls)) {
    // 尝试从 data-eeimg / data-tex 或子元素中获取
    const eeimg = node.getAttribute('data-eeimg');
    if (eeimg) {
      const innerTex = node.getAttribute('data-tex') || node.querySelector('[data-tex]')?.getAttribute('data-tex');
      if (innerTex) return innerTex;
    }
    // 最后尝试用纯文本（可能已经是渲染后的，但总比丢失好）
    const textContent = node.textContent?.trim() || '';
    // 如果文本包含明显的 LaTeX 命令，认为它是公式
    if (textContent && /\\(frac|sqrt|sum|int|prod|lim|text|left|right|begin|end)\b/.test(textContent)) {
      return textContent;
    }
  }

  return null;
}

/**
 * 检查元素是否包含块级子元素
 */
function hasBlockChildren(element) {
  const blockTags = new Set([
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'table', 'blockquote', 'pre', 'hr',
    'section', 'article', 'figure', 'details',
  ]);
  for (const child of element.children) {
    if (blockTags.has(child.tagName.toLowerCase())) return true;
  }
  return false;
}

/**
 * 判断标签是否为行内元素
 */
function isInlineElement(tag) {
  const inlineTags = new Set([
    'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data',
    'del', 'dfn', 'em', 'i', 'ins', 'kbd', 'mark', 'q',
    's', 'samp', 'small', 'span', 'strong', 'sub', 'sup',
    'time', 'u', 'var', 'wbr', 'label', 'button', 'input',
    'select', 'textarea', 'font', 'strike',
  ]);
  return inlineTags.has(tag);
}

/**
 * 去除 rich_text 数组首尾的纯空白片段
 */
function trimRichTextArray(arr) {
  if (arr.length === 0) return arr;

  // 复制一份避免修改原数组
  const result = [...arr];

  // trim 开头
  while (result.length > 0) {
    const first = result[0];
    const text = first.text?.content || '';
    const trimmed = text.replace(/^[\s\n]+/, '');
    if (trimmed) {
      result[0] = { ...first, text: { ...first.text, content: trimmed } };
      break;
    }
    result.shift();
  }

  // trim 结尾
  while (result.length > 0) {
    const last = result[result.length - 1];
    const text = last.text?.content || '';
    const trimmed = text.replace(/[\s\n]+$/, '');
    if (trimmed) {
      result[result.length - 1] = { ...last, text: { ...last.text, content: trimmed } };
      break;
    }
    result.pop();
  }

  return result;
}
