document.getElementById("transferButton").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: "getData" }, (data) => {
            chrome.runtime.sendMessage({ action: "transferData", data: data });
        });
    });
});