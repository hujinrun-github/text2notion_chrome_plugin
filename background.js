chrome.contextMenus.onClicked.addListener(genericOnClick);
const NOTION_KEY = "secret_s37D10Rg5pe65ap2qBawa1O65B8mLrliyCkLVwLOqZI"

const pageId = "a0e9c33e4f874154ac6054cb95949943"
const addDataBaseUrl = "https://api.notion.com/v1/databases/"
    // A generic onclick callback function.
function genericOnClick(info) {
    // 1. Get the selected text.
    const selectedText = info.selectionText;
    console.log(selectedText);
    // 2. Send the selected text to the notion page
    fetch(addDataBaseUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${NOTION_KEY}`,
                "Content-Type": "application/json",
                "notion-Version": "2022-06-28"
            },
            body: JSON.stringify({
                "parent": {
                    "type": "page_id",
                    "page_id": `${pageId}`
                },
                "icon": {
                    "type": "emoji",
                    "emoji": "📝"
                },
                "cover": {
                    "type": "external",
                    "external": {
                        "url": "https://website.domain/images/image.png"
                    }
                },
                "title": [{
                    "type": "text",
                    "text": {
                        "content": `${selectedText}`,
                        "link": null
                    }
                }],
                "properties": {
                    "Name": {
                        "title": {}
                    },
                    "Description": {
                        "rich_text": {}
                    },
                    "In stock": {
                        "checkbox": {}
                    },
                    "Food group": {
                        "select": {
                            "options": [{
                                    "name": "🥦Vegetable",
                                    "color": "green"
                                },
                                {
                                    "name": "🍎Fruit",
                                    "color": "red"
                                },
                                {
                                    "name": "💪Protein",
                                    "color": "yellow"
                                }
                            ]
                        }
                    },
                    "Price": {
                        "number": {
                            "format": "dollar"
                        }
                    },
                    "Last ordered": {
                        "date": {}
                    },
                    "Store availability": {
                        "type": "multi_select",
                        "multi_select": {
                            "options": [{
                                    "name": "Duc Loi Market",
                                    "color": "blue"
                                },
                                {
                                    "name": "Rainbow Grocery",
                                    "color": "gray"
                                },
                                {
                                    "name": "Nijiya Market",
                                    "color": "purple"
                                },
                                {
                                    "name": "Gus'\''s Community Market",
                                    "color": "yellow"
                                }
                            ]
                        }
                    },
                    "+1": {
                        "people": {}
                    },
                    "Photo": {
                        "files": {}
                    }
                }
            })
        })
        .then(response => {
            console.log(response);
            if (!response.ok) {
                return response.json().then(error => {
                    console.error('Error:', response.status, response.statusText, error);
                    throw new Error(`HTTP error ${response.status}: ${error.message}`);
                });
            }
        })
        .then(data => {
            console.log(data);
        })
        .catch(error => {
            console.error(error);
        })
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