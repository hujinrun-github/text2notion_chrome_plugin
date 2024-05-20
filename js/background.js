chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "transferData") {
        const data = request.data;
        // 在此处添加将数据传输到 Notion 的代码
    }
});