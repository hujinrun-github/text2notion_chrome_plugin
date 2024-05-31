// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//     if (request.action === "getData") {
//         const data = {
//             title: document.title,
//             url: document.location.href,
//             text: document.body.innerText,
//         };
//         sendResponse(data);
//     }
// });