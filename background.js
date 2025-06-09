// 创建右键菜单项
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "myContextMenu",
    title: "处理选中文本",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try{
            // 先注入内容脚本
        await chrome.scripting.executeScript({
            target: {tabId: tab.id},
            files: ['scripts/content.js']
        });

        if (info.menuItemId === "myContextMenu" && info.selectionText) {
            const selectedText = info.selectionText;
            // 可以发送消息给内容脚本
            chrome.tabs.sendMessage(tab.id, {
            action: "processSelectedText",
            text: selectedText
            });
        }

    }catch (error) {
        console.error("操作失败:", error);
    }
})