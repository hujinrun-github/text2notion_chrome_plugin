# Chrome Extension Content Capture & Notion Flow Analysis

## Executive Summary

This Chrome extension captures **plain text only** (no HTML) from user selections and sends it to Notion as **paragraph blocks with rich_text**. There is **no HTML capture mechanism** currently implemented.

---

## Question 1: How is `selectionText` obtained in `scripts/content.js`?

### Answer: Plain Text Only (via Chrome Context Menu API)

**Source Flow:**
1. **User Action:** Right-click on selected text → "Save to Notion" menu item
2. **Chrome Processes:** Chrome's context menu API extracts the selection
3. **background.js receives `info.selectionText`:**
   ```javascript
   chrome.contextMenus.onClicked.addListener((info, tab) => {
     if (info.menuItemId !== CONTEXT_MENU_ID) return;
     chrome.tabs.sendMessage(tab.id, {
       type: 'processSelectedText',
       selectionText: info.selectionText,  // ← PLAIN TEXT from Chrome API
       pageUrl: info.pageUrl,
       pageTitle: tab.title,
     });
   });
   ```

3. **content.js receives via message listener:**
   ```javascript
   chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
     if (message.type !== 'processSelectedText') return;
     const { selectionText = '', pageUrl = '', pageTitle = '' } = message;
     injectToast({ selectionText, pageUrl, pageTitle });
   });
   ```

### Key Points:
- ✅ **It's plain text**: `info.selectionText` from Chrome's context menu API contains **plain text only**, not HTML
- ❌ **No HTML capture**: There's no code like `document.getSelection().getRangeAt(0)` or DOM traversal
- ✅ **User can edit**: In Phase A toast UI, text is put in a `<textarea>` where user can edit it
- ✅ **Editable before save**: Line 193 shows `editedContent = contentTextarea.value` is sent to Notion

### Why No HTML Capture?
The Chrome API `info.selectionText` **intentionally returns plain text** for security/simplicity. To capture HTML, you would need:
```javascript
// NOT IMPLEMENTED - would require content script injection:
const selection = window.getSelection();
const range = selection.getRangeAt(0);
const fragment = range.cloneContents();
const div = document.createElement('div');
div.appendChild(fragment);
const htmlContent = div.innerHTML; // ← Would get HTML
```

---

## Question 2: How is content passed to `createPage` in `background.js`?

### Answer: Via `handleSaveToNotion` handler

**Code Path:**

**background.js `handleSaveToNotion` (lines 115-179):**
```javascript
async function handleSaveToNotion(message, sendResponse) {
  const { databaseId, selectedText, pageUrl, pageTitle } = message;
  
  try {
    // ... token validation ...
    
    // Create fields object
    const fields = {
      title: pageTitle || pageUrl || '未命名',
      content: selectedText,           // ← Plain text from content.js
      sourceUrl: pageUrl,
      capturedAt: new Date().toISOString(),
      tags: message.tags || [],        // ← From tag widget
      notes: message.notes || '',      // ← From notes textarea
    };
    
    // Call createPage with fields + options
    const page = await createPage(token, databaseId, fields, {
      fieldMapping,
      autoCreateFields,
    });
    
    sendResponse({ success: true, pageId: page.id, pageUrl: page.url });
  }
}
```

**Data Flow:**
```
content.js (toast UI)
  ↓
user edits text in textarea + adds tags/notes
  ↓
saveBtn.addEventListener (line 186)
  ↓
safeSendMessage({ type: 'saveToNotion', selectedText, tags, notes })
  ↓
background.js handleSaveToNotion
  ↓
builds fields = { title, content, sourceUrl, capturedAt, tags, notes }
  ↓
createPage(token, databaseId, fields, options)
```

---

## Question 3: What does `createPage` do with the content?

### Answer: Creates 2 Things

**In `utils/notion-api.js` `createPage` (lines 219-306):**

#### 1. Page Properties (Database Fields)
```javascript
// Limit content to 2000 chars (Notion rich_text limit)
const safeContent = content.length > 2000 ? content.slice(0, 2000) : content;

// Build properties using fieldMapping
// Example result:
// {
//   "Title": { title: [{ text: { content: "pageTitle" } }] },
//   "Content": { rich_text: [{ type: 'text', text: { content: safeContent } }] },
//   "Source URL": { url: "pageUrl" },
//   "Captured At": { date: { start: "ISO timestamp" } },
//   "Tags": { multi_select: [{ name: "tag1" }, { name: "tag2" }] },
//   "Notes": { rich_text: [{ type: 'text', text: { content: "user notes" } }] }
// }
```

#### 2. Page Content (Children Blocks)
```javascript
const body = {
  parent: { database_id: databaseId },
  properties,
  children: [
    {
      object: 'block',
      type: 'paragraph',           // ← Only paragraph blocks!
      paragraph: {
        rich_text: [{ 
          type: 'text', 
          text: { content: safeContent }  // ← Plain text wrapped in paragraph
        }],
      },
    },
  ],
};
```

**POST** to Notion API:
```
POST /v1/pages
Body: { parent, properties, children }
```

### Key Insights:
- ✅ **Content stored in 2 places:**
  - **Page Property**: Content field (e.g., "Content" in database)
  - **Page Block**: Paragraph block in page body
- ✅ **2000 character limit**: Enforced for rich_text properties
- ✅ **Plain text only**: No HTML, no formatting, no code blocks
- ✅ **Simple structure**: Only uses `paragraph` block type (most basic)

---

## Question 4: Current Block Types vs. Supported

### Currently Created
```javascript
children: [
  {
    object: 'block',
    type: 'paragraph',    // ← ONLY THIS
    paragraph: { rich_text: [...] }
  }
]
```

### Notion API Supports (All these could be used)

| Block Type | Example | Use Case |
|---|---|---|
| ✅ `paragraph` | Text, mixed content | General content ← **Currently Used** |
| ✅ `heading_1` | # Large title | Main sections |
| ✅ `heading_2` | ## Subsection | Subsections |
| ✅ `heading_3` | ### Minor heading | Sub-subsections |
| ✅ `bulleted_list_item` | • List item | Bullet points |
| ✅ `numbered_list_item` | 1. List item | Numbered lists |
| ✅ `code` | Code snippet | Code blocks with language |
| ✅ `image` | ![alt](url) | Image references |
| ✅ `table` | | Structured data |
| ✅ `table_row` | | Table rows |
| ✅ `bookmark` | Link with preview | Saved links |
| ✅ `quote` | > Text | Block quotes |
| ✅ `callout` | ℹ️ Important | Highlighted info |
| ✅ `divider` | ─ | Visual separator |

### Example: Richer Content (NOT IMPLEMENTED)
```javascript
// What COULD be done if HTML was captured:
children: [
  { object: 'block', type: 'heading_1', heading_1: { 
      rich_text: [{ text: { content: 'Title' } }] } },
  { object: 'block', type: 'paragraph', paragraph: { 
      rich_text: [{ text: { content: 'Introduction...' } }] } },
  { object: 'block', type: 'bulleted_list_item', 
      bulleted_list_item: { rich_text: [{ text: { content: 'Point 1' } }] } },
  { object: 'block', type: 'code', code: { 
      language: 'javascript',
      rich_text: [{ text: { content: 'const x = 1;' } }] } },
  { object: 'block', type: 'quote', quote: { 
      rich_text: [{ text: { content: 'Important quote' } }] } },
]
```

---

## Data Type Reference

### Chrome Context Menu API
```javascript
// info object passed to contextMenus.onClicked callback:
{
  menuItemId: 'save-to-notion',
  parentMenuItemId: undefined,
  mediaType: undefined,
  linkUrl: undefined,
  pageUrl: 'https://example.com/article',      // ← Always available
  frameUrl: undefined,
  selectionText: 'This is the selected text',   // ← Plain text ONLY
  frameId: 0,
  editable: false,
  wasChecked: undefined,
  checked: undefined
}
// NOTE: selectionText is ALWAYS plain text, no HTML ever
```

### Notion Page Creation Payload
```javascript
{
  parent: {
    type: 'database_id',
    database_id: 'abc123...'
  },
  properties: {
    'Title': {                    // title type
      title: [{ text: { content: 'Page Title' } }]
    },
    'Content': {                  // rich_text type
      rich_text: [{ 
        type: 'text',
        text: { content: 'Paragraph content' },
        annotations: { ... }      // Optional: bold, italic, etc.
      }]
    },
    'Source URL': {               // url type
      url: 'https://...'
    },
    'Captured At': {              // date type
      date: { start: '2024-01-15T10:30:00Z' }
    },
    'Tags': {                     // multi_select type
      multi_select: [
        { name: 'tag1' },
        { name: 'tag2' }
      ]
    },
    'Notes': {                    // rich_text type
      rich_text: [{ text: { content: 'User notes' } }]
    }
  },
  children: [                     // Page content blocks
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ text: { content: 'Content here' } }],
        color: 'default'
      }
    }
  ]
}
```

---

## FIELD_TYPES Mapping

```javascript
// utils/notion-api.js lines 10-17
const FIELD_TYPES = {
  title: 'title',              // Notion 'title' property
  content: 'rich_text',        // Notion 'rich_text' property (paragraph in block)
  notes: 'rich_text',          // Notion 'rich_text' property
  sourceUrl: 'url',            // Notion 'url' property
  capturedAt: 'date',          // Notion 'date' property
  tags: 'multi_select',        // Notion 'multi_select' property (like select dropdown)
};

// Maps to schema when creating new fields:
const FIELD_SCHEMA = {
  rich_text:     { rich_text: {} },
  url:           { url: {} },
  date:          { date: {} },
  multi_select:  { multi_select: {} },
};
```

---

## Summary Table

| Component | Source | Type | Content | Editable |
|---|---|---|---|---|
| **Selection** | Chrome context menu | Plain text | Selected text only | ❌ |
| **In content.js** | Received via message | Plain text | Still plain text | ✅ in textarea |
| **After editing** | User edits in toast | Plain text | Edited selection + tags + notes | ✅ |
| **Sent to Notion** | selectedText field | Plain text | Still plain text | ❌ locked in Notion |
| **In Database** | Content property | rich_text | Paragraph block content | ✅ in Notion |
| **In Page Body** | children[0] | paragraph block | Paragraph block content | ✅ in Notion |

---

## Chrome API Limitations

### What Chrome's contextMenus API Provides
```
✅ info.selectionText     → Plain text (auto-stripped of HTML)
✅ info.pageUrl           → Full page URL
✅ info.pageTitle         → From tab.title
✅ info.frameUrl          → If in iframe
✅ info.editable          → Is it in contenteditable?
❌ HTML of selection      → NOT PROVIDED
❌ DOM structure          → NOT PROVIDED
❌ Formatting/styles      → NOT PROVIDED
```

### Why Not HTML?
The Chrome API intentionally provides only plain text for security & simplicity. To get HTML, you'd need to:

1. **Inject content script** (already done ✅)
2. **Use `document.getSelection()`** (could do this)
3. **Serialize to HTML** (could do this)
4. **But:** Very complex to preserve formatting properly

---

## Potential Improvements (Not Implemented)

### To Support HTML/Rich Content:
```javascript
// In content.js, could add:
function captureSelectionHTML() {
  try {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return '';
    
    const range = selection.getRangeAt(0);
    const fragment = range.cloneContents();
    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);
    return wrapper.innerHTML; // ← HTML instead of plain text
  } catch (_) {
    return '';
  }
}

// Then parse HTML to Notion blocks in background.js
// But: VERY complex - need to parse HTML → semantic blocks
```

### Simpler Alternative: Markdown Detection
```javascript
// If text contains markdown syntax, could parse it:
// "# Title" → heading_1 block
// "- Item" → bulleted_list_item block
// "```js code```" → code block
// etc.
```

---

## Critical Findings

### 1. **Plain Text Only**
- Chrome's API provides `info.selectionText` as **plain text**
- No HTML capture mechanism exists
- No DOM parsing in content.js

### 2. **Single Paragraph Blocks**
- All content → single `paragraph` block
- No structure detection (headings, lists, code, etc.)
- All formatting lost

### 3. **2000 Character Limit**
- Notion's rich_text has 2000 char limit
- Enforced in `createPage` at line 224
- Longer text is silently truncated

### 4. **User Can Edit**
- Before saving, user can edit text in toast
- `contentTextarea.value` (textarea) is sent
- So final content ≠ original selection

### 5. **Dual Storage**
- Content stored in **2 places** in Notion page:
  - Database property (e.g., "Content" field)
  - Page body block (children[0])
- Both get same safeContent value

---

## Final Answer: Complete Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ USER BROWSER                                                    │
├─────────────────────────────────────────────────────────────────┤
│ 1. User selects text: "hello world"                             │
│    ↓                                                             │
│ 2. Right-click → "Save to Notion"                               │
│    ↓                                                             │
│ 3. Chrome captures: info.selectionText = "hello world"          │
│    (PLAIN TEXT ONLY - NO HTML)                                  │
└─────────────────────────────────────────────────────────────────┘
        ↓ chrome.contextMenus.onClicked
┌─────────────────────────────────────────────────────────────────┐
│ BACKGROUND SERVICE WORKER                                       │
├─────────────────────────────────────────────────────────────────┤
│ chrome.tabs.sendMessage({                                        │
│   type: 'processSelectedText',                                  │
│   selectionText: "hello world",  ← STILL PLAIN TEXT             │
│   pageUrl, pageTitle                                            │
│ })                                                              │
└─────────────────────────────────────────────────────────────────┘
        ↓ sends to content script
┌─────────────────────────────────────────────────────────────────┐
│ CONTENT SCRIPT (content.js)                                     │
├─────────────────────────────────────────────────────────────────┤
│ injectToast({ selectionText: "hello world" })                   │
│   ↓                                                             │
│ Renders Phase A toast:                                          │
│   - <textarea> with "hello world"  ← USER CAN EDIT              │
│   - Select database                                             │
│   - Add tags (optional)                                         │
│   - Add notes (optional)                                        │
│   - "Save" button                                               │
│                                                                 │
│ User edits: "hello world" → "hello world from example.com"      │
│ User adds tags: ["web", "test"]                                 │
│ User clicks Save                                                │
│   ↓                                                             │
│ Collects: {                                                     │
│   type: 'saveToNotion',                                         │
│   selectedText: "hello world from example.com",  ← EDITED       │
│   tags: ["web", "test"],                                        │
│   notes: "interesting article",                                 │
│   databaseId, pageUrl, pageTitle                                │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
        ↓ chrome.runtime.sendMessage
┌─────────────────────────────────────────────────────────────────┐
│ BACKGROUND SERVICE WORKER (background.js)                       │
├─────────────────────────────────────────────────────────────────┤
│ handleSaveToNotion({                                            │
│   databaseId, selectedText, pageUrl, pageTitle,                 │
│   tags, notes                                                   │
│ })                                                              │
│   ↓                                                             │
│ Builds fields = {                                               │
│   title: "example.com" (or pageTitle),                          │
│   content: "hello world from example.com",  ← LIMITED TO 2000   │
│   sourceUrl: "https://example.com/page",                        │
│   capturedAt: "2024-01-15T10:30:00Z",                           │
│   tags: ["web", "test"],                                        │
│   notes: "interesting article"                                  │
│ }                                                               │
│   ↓                                                             │
│ createPage(token, databaseId, fields, options)                  │
└─────────────────────────────────────────────────────────────────┘
        ↓ calls Notion API
┌─────────────────────────────────────────────────────────────────┐
│ NOTION-API.JS (createPage function)                             │
├─────────────────────────────────────────────────────────────────┤
│ 1. Builds properties map (database fields):                     │
│    {                                                            │
│      "Title": {                                                 │
│        title: [{ text: { content: "example.com" } }]            │
│      },                                                         │
│      "Content": {                                               │
│        rich_text: [{                                            │
│          type: 'text',                                          │
│          text: { content: "hello world from example.com" }      │
│        }]                                                       │
│      },                                                         │
│      "Source URL": {                                            │
│        url: "https://example.com/page"                          │
│      },                                                         │
│      "Captured At": {                                           │
│        date: { start: "2024-01-15T10:30:00Z" }                  │
│      },                                                         │
│      "Tags": {                                                  │
│        multi_select: [{ name: "web" }, { name: "test" }]        │
│      },                                                         │
│      "Notes": {                                                 │
│        rich_text: [{                                            │
│          text: { content: "interesting article" }               │
│        }]                                                       │
│      }                                                          │
│    }                                                            │
│                                                                 │
│ 2. Builds children blocks (page content):                       │
│    [                                                            │
│      {                                                          │
│        object: 'block',                                         │
│        type: 'paragraph',  ← ONLY PARAGRAPH BLOCKS              │
│        paragraph: {                                             │
│          rich_text: [{                                          │
│            type: 'text',                                        │
│            text: {                                              │
│              content: "hello world from example.com"            │
│            }                                                    │
│          }]                                                     │
│        }                                                        │
│      }                                                          │
│    ]                                                            │
│                                                                 │
│ 3. Sends to Notion API:                                         │
│    POST /v1/pages                                               │
│    {                                                            │
│      parent: { database_id: "..." },                            │
│      properties: { ... },                                       │
│      children: [ ... ]                                          │
│    }                                                            │
└─────────────────────────────────────────────────────────────────┘
        ↓ HTTP response
┌─────────────────────────────────────────────────────────────────┐
│ NOTION DATABASE                                                 │
├─────────────────────────────────────────────────────────────────┤
│ NEW PAGE CREATED:                                               │
│                                                                 │
│ Database Row:                                                   │
│   Title: "example.com"                                          │
│   Content: "hello world from example.com"                       │
│   Source URL: "https://example.com/page"                        │
│   Captured At: 2024-01-15T10:30:00Z                             │
│   Tags: [web, test]                                             │
│   Notes: "interesting article"                                  │
│                                                                 │
│ Page Body:                                                      │
│   Paragraph: "hello world from example.com"                     │
│                                                                 │
│ (Same content in both locations!)                               │
└─────────────────────────────────────────────────────────────────┘
        ↓ user sees in Notion UI
┌─────────────────────────────────────────────────────────────────┐
│ NOTION UI                                                       │
├─────────────────────────────────────────────────────────────────┤
│ ✓ Saved to Notion                                               │
│                                                                 │
│ Page title: "example.com"                                       │
│ page body:                                                      │
│   hello world from example.com                                  │
│                                                                 │
│ Database view shows:                                            │
│   | Title        | Content                      | Tags        │  │
│   | example.com  | hello world from example.com | web, test   │  │
└─────────────────────────────────────────────────────────────────┘
```
