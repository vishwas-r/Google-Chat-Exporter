// Wait for the DOM to be loaded
document.addEventListener('DOMContentLoaded', function() {
    // Get the export button
    const exportBtn = document.getElementById('exportBtn');
    
    // Add click event listener
    exportBtn.addEventListener('click', function() {
      // Get the active tab
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        // Check if we're on chat.google.com
        if (tabs[0] && tabs[0].url && tabs[0].url.includes('chat.google.com')) {
          // Send a message to the active tab to check if it has a valid frame
          chrome.tabs.sendMessage(tabs[0].id, { action: "checkFrame" }, function(response) {
            if (chrome.runtime.lastError) {
              console.error(chrome.runtime.lastError.message);
              return;
            }
            
            if (response && response.validFrame) {
              // If we're in a valid frame, trigger the export
              chrome.tabs.sendMessage(tabs[0].id, { action: "exportConversation" });
            } else {
              // If not in a valid frame, use the findFrame script
              chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                files: ["findFrame.js"]
              });
            }
          });
        } else {
          // If not on chat.google.com, show an error
          alert("Please navigate to chat.google.com and open a conversation first.");
        }
      });
    });
  });