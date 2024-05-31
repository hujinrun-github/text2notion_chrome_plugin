chrome.contextMenus.onClicked.addListener(genericOnClick);

// A generic onclick callback function.
function genericOnClick(info) {
    // 1. Get the selected text.
    const selectedText = info.selectionText;

    // 2. Send the selected text to the notion page

}



// Add a listener to create the initial context menu items,
// context menu items only need to be created at runtime.onInstalled
chrome.runtime.onInstalled.addListener(async() => {
    chrome.contextMenus.create({
        id: "selection-parant",
        title: "Transfer text to Notion",
        type: 'normal',
        contexts: ['selection']
    });
});