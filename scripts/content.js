// 监听来自背景脚本的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "processSelectedText") {
    // 在页面上显示选中的文本
    // alert(`你选择了: ${request.text}`);
    const currentUrl = window.location.href;
    console.log(`你选择了: ${request.text}`)
    console.log(`当前的网页地址是：${currentUrl}`)
    // 可以在这里对选中的文本进行进一步处理
    // 例如高亮、替换等操作
    return true
  }
});