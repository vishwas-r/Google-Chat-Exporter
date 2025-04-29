// Create context menu item when extension is installed
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "exportGoogleChat",
      title: "Export Chat Conversation",
      contexts: ["all"],
      documentUrlPatterns: [
        "https://chat.google.com/*", 
        "https://mail.google.com/*"
      ]
    });
  });
  
  // Handle context menu clicks
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "exportGoogleChat") {
      // Send message to content script to initiate export
      chrome.tabs.sendMessage(tab.id, { action: "exportChatConversation" });
    }
  });
  
  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.status === "no_chat_frame") {
      // Send message to active tab to show instructions
      chrome.tabs.sendMessage(sender.tab.id, { action: "showInstructions" });
    }
  });