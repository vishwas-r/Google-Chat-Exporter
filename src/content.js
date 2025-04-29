// Track if we're inside a valid chat frame
var isInChatFrame = false;

// Check if we're in the correct frame for Google Chat
function detectChatFrame() {
  // Check if this is the single_full_screen frame or contains chat content
  var isSingleFullScreenFrame = window.name === 'single_full_screen';
  var hasChatContent = document.querySelector('.Bl2pUd') || 
                         document.querySelector('[role="main"]') ||
                         document.querySelector('div[data-is-scroll-wrapper="true"]');
  
  isInChatFrame = isSingleFullScreenFrame || hasChatContent;
  
  // If we're in a frame with Google Chat content, log it
  if (isInChatFrame) {
    console.log('Google Chat Exporter: Chat frame detected');
  }
}

// Run frame detection when content script loads
detectChatFrame();

// Create a notification overlay
function createNotification(message, isError = false) {
  var existingNotification = document.getElementById('gchat-exporter-notification');
  if (existingNotification) {
    existingNotification.remove();
  }
  
  var notificationDiv = document.createElement('div');
  notificationDiv.id = 'gchat-exporter-notification';
  notificationDiv.style.position = 'fixed';
  notificationDiv.style.top = '10px';
  notificationDiv.style.right = '10px';
  notificationDiv.style.background = isError ? 'rgba(220,53,69,0.9)' : 'rgba(0,0,0,0.8)';
  notificationDiv.style.color = 'white';
  notificationDiv.style.padding = '12px 16px';
  notificationDiv.style.borderRadius = '8px';
  notificationDiv.style.zIndex = '9999';
  notificationDiv.style.fontFamily = 'Arial, sans-serif';
  notificationDiv.style.fontSize = '14px';
  notificationDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
  notificationDiv.style.maxWidth = '300px';
  notificationDiv.textContent = message;
  
  document.body.appendChild(notificationDiv);
  
  // Auto-remove after 6 seconds
  setTimeout(() => {
    notificationDiv.style.opacity = '0';
    notificationDiv.style.transition = 'opacity 0.5s ease';
    
    setTimeout(() => {
      if (notificationDiv.parentNode) {
        notificationDiv.parentNode.removeChild(notificationDiv);
      }
    }, 500);
  }, 6000);
  
  return notificationDiv;
}

function showInstructions() {
  if (window.top !== window.self) return;  
  createNotification('Please open a Google Chat conversation first, then right-click and select "Export Chat Conversation"', true);
}

function exportChatConversation() {
  console.log('Starting Google Chat text export...');
  
  // Scroll to load all messages - completely rebuilt
  async function scrollToTop() {
    console.log('Scrolling to load all messages...');
    
    // Find the scrollable container
    var possibleContainers = [
      document.querySelector('.Bl2pUd'), // Most common in Google Chat
      document.querySelector('[role="main"]'),
      document.querySelector('div[data-is-scroll-wrapper="true"]'),
      document.querySelector('[data-conversation-container]'),
      document.querySelector('.nH.aJl.nn'),
      document.querySelector('.Bk'),
      document.querySelector('.buA')
    ].filter(Boolean);
    
    var container = possibleContainers[0];
    
    if (!container) {
      console.error('Could not find scrollable container. Will attempt to extract visible messages only.');
      return;
    }
    
    console.log('Found scrollable container:', container);
    
    // Save initial scroll position and height
    var initialScrollTop = container.scrollTop;
    var initialScrollHeight = container.scrollHeight;
    console.log('Initial scroll position:', initialScrollTop, 'Initial height:', initialScrollHeight);
    
    // Function to physically simulate scrolling to the top
    async function simulateScrollingToTop() {
      // Start position - current scroll position
      var currentPosition = container.scrollTop;
      console.log('Starting scroll simulation from position:', currentPosition);
      
      // Track previous heights to detect when no more content is loading
      var previousHeight = container.scrollHeight;
      var noChangeCount = 0;
      
      // Keep scrolling until we reach the top and no more content loads
      while (true) {
        // Scroll up by a smaller amount (600px) for more reliable loading
        container.scrollTop = Math.max(0, currentPosition - 600);
        currentPosition = container.scrollTop;
        
        // Log scroll position periodically
        console.log('Scrolled to position:', currentPosition);
        
        // Wait for content to load
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Check if we've reached the top
        if (currentPosition === 0) {
          // We're at the top, but let's check if content is still loading
          var currentHeight = container.scrollHeight;
          console.log('At top. Previous height:', previousHeight, 'Current height:', currentHeight);
          
          if (currentHeight === previousHeight) {
            noChangeCount++;
            console.log('No height change detected. Count:', noChangeCount);
            
            if (noChangeCount >= 3) {
              console.log('No more messages loading. Exiting scroll loop.');
              break;
            }
          } else {
            // Height changed, reset counter and continue scrolling from top
            noChangeCount = 0;
            previousHeight = currentHeight;
            console.log('More content loaded. Continuing to scroll.');
          }
        }
        
        // If we're at the top but height is still changing, scroll down a bit and then back up to trigger more loading
        if (currentPosition === 0 && noChangeCount < 3) {
          console.log('Scrolling down slightly to trigger more loading...');
          container.scrollTop = 200;
          await new Promise(resolve => setTimeout(resolve, 400));
          currentPosition = container.scrollTop;
        }
        
        // Safety check to prevent infinite loops
        if (noChangeCount >= 10) {
          console.log('Safety exit - possible scroll loop detected');
          break;
        }
      }
      
      // Final log of the scroll results
      var finalHeight = container.scrollHeight;
      console.log('Scrolling completed. Initial height:', initialScrollHeight, 'Final height:', finalHeight);
      console.log('Height difference:', finalHeight - initialScrollHeight);
    }
    
    // Run the scroll simulation
    await simulateScrollingToTop();
    
    // Final wait to ensure everything is loaded
    console.log('Waiting for any remaining content to fully load...');
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  // Extract messages with improved filters and selectors
  function extractMessages() {
    console.log('Extracting messages...');
    var exportText = '';
    var messageCount = 0;
    
    // Identify the main conversation container
    var chatContainer = document.querySelector('.Bl2pUd') || 
                          document.querySelector('[role="main"]') ||
                          document.querySelector('div[data-is-scroll-wrapper="true"]') ||
                          document;
    
    console.log('Chat container found, searching for messages');
    
    // ====== APPROACH 1: Find message bubbles directly ======
    // Updated selectors to target message bubble containers (most reliable in Google Chat)
    var messageBubbles = chatContainer.querySelectorAll('div.GDhqjd, div.vdlEi');
    console.log(`Found ${messageBubbles.length} message bubbles`);
    
    if (messageBubbles.length > 0) {
      messageBubbles.forEach((bubble, index) => {
        try {
          // Find the sender in the bubble's parent structure
          var sender = 'Unknown';

          var senderElement = bubble.closest('div[jsmodel]')?.querySelector('span.zX8Xib, span.Un, span.njhDLd');
          if (senderElement) {
            sender = senderElement.textContent.trim();
          }
          
          // Find the timestamp
          var timestamp = '';
          var timeElement = bubble.closest('div[jsmodel]')?.querySelector('span.FvYVyf, span.ud0FPb');
          if (timeElement) {
            timestamp = timeElement.textContent.trim();
          }
          
          // Get the message content - direct from the bubble
          var messageText = bubble.textContent.trim();
          var cleanedMessage = cleanMessageString(`[${timestamp || 'No time'}] ${sender}: ${messageText}`);
          
          if (cleanedMessage && !cleanedMessage.includes('Add reaction') && !cleanedMessage.includes('More actions') && !cleanedMessage.includes('Quote in reply') && !cleanedMessage.includes('Edit')) {
            exportText += `${cleanedMessage}\n\n`;
            messageCount++;
          }
        } catch (err) {
          console.warn(`Error processing message bubble ${index}:`, err);
        }
      });
    }
    
    // ====== APPROACH 2: Find message by common containers ======
    if (messageCount < 5) {
      console.log('Few messages found with approach 1, trying approach 2');
      
      var messageContainers = chatContainer.querySelectorAll('div.nF6pT');
      console.log(`Found ${messageContainers.length} message containers in approach 2`);
      
      messageContainers.forEach((container, index) => {
        try {
          // Extract sender
          var senderElement = container.querySelector('span.zX8Xib, span.Un, span.njhDLd');
          var sender = senderElement ? senderElement.textContent.trim() : 'Unknown';
          
          // Extract timestamp
          var timeElement = container.querySelector('span.FvYVyf, span.ud0FPb');
          var timestamp = timeElement ? timeElement.textContent.trim() : '';
          
          // Extract message content
          // First try direct message content elements
          var contentElement = container.querySelector('div.GDhqjd, div.vdlEi');
          var messageText = contentElement ? contentElement.textContent.trim() : '';
          
          // If that didn't work, look for common text containers
          if (!messageText) {
            contentElement = container.querySelector('div.iOHNLd, div.TVitee, div.jU4nEd');
            messageText = contentElement ? contentElement.textContent.trim() : '';
          }
          
          // As a fallback, get all text excluding UI elements
          if (!messageText) {
            var allElements = Array.from(container.querySelectorAll('*'));
            var textNodes = allElements.filter(el => {
              var text = el.textContent.trim();
              return text && 
                 !text.includes('Edit') && 
                     !text.includes('Add reaction') && 
                     !text.includes('More actions') &&
                     !text.includes('Reply in thread') &&
                 !text.includes('Quote in reply') &&
                     el.tagName !== 'BUTTON' &&
                     !el.getAttribute('role')?.includes('button');
            });
            
            if (textNodes.length > 0) {
              messageText = textNodes.map(el => el.textContent.trim())
                                    .filter((text, i, arr) => arr.indexOf(text) === i) // Remove duplicates
                                    .join(' ');
            }
          }
          var cleanedMessage = cleanMessageString(`[${timestamp || 'No time'}] ${sender}: ${messageText}`);
          if (cleanedMessage && cleanedMessage.length > 0) {
            exportText += `${cleanedMessage}\n\n`;
            messageCount++;
          }
        } catch (err) {
          console.warn(`Error processing message container ${index}:`, err);
        }
      });
    }
    
    // ====== APPROACH 3: Use the most broadly applicable selectors ======
    if (messageCount < 5) {
      console.log('Few messages found with approach 2, trying approach 3');
      
      // Look for any elements that might contain message text
      var allTextElements = chatContainer.querySelectorAll('div.iOHNLd, div.TVitee, div.jU4nEd, div[jsname="bgmYte"], div[jsname="z8tNhf"]');
      console.log(`Found ${allTextElements.length} possible text elements in approach 3`);
      
      // Use a Set to track processed text to avoid duplicates
      var processedTexts = new Set();
      
      allTextElements.forEach((element, index) => {
        try {
          var messageText = cleanMessageString(element.textContent.trim());
          
          // Skip if empty, UI text, or already processed
          if (!messageText || 
              messageText.includes('Add reaction') || 
              messageText.includes('Edit') || 
              messageText.includes('More actions') ||
              messageText.includes('Reply in thread') ||
              messageText.includes('Quote in reply') ||
              processedTexts.has(messageText)) {
            return;
          }
          
          // Add to processed set
          processedTexts.add(messageText);
          
          // Try to find sender and timestamp by traversing up
          var currentNode = element;
          var sender = 'Unknown';
          var timestamp = '';
          
          // Look up to 5 parent levels for sender and timestamp
          for (var i = 0; i < 5; i++) {
            if (!currentNode.parentElement) break;
            currentNode = currentNode.parentElement;
            
            // Try to find sender
            var senderElement = currentNode.querySelector('span.zX8Xib, span.Un, [data-sender-name]');
            if (senderElement) {
              var potentialSender = senderElement.textContent.trim();
              if (potentialSender && potentialSender !== messageText) {
                sender = potentialSender;
              }
            }
            
            // Try to find timestamp
            var timeElement = currentNode.querySelector('span.FvYVyf, span.ud0FPb, [data-absolute-timestamp]');
            if (timeElement) {
              timestamp = timeElement.textContent.trim();
            }
            
            // If we found both, break early
            if (sender !== 'Unknown' && timestamp) break;
          }
          var cleanedMessage = cleanMessageString(`[${timestamp || 'No time'}] ${sender}: ${messageText}`);
          exportText += `${cleanedMessage}\n\n`;
          messageCount++;
          
        } catch (err) {
          console.warn(`Error processing text element ${index}:`, err);
        }
      });
    }
    
    // Final approach - get ALL text content if we still have nothing
    if (messageCount === 0) {
      console.log('No messages found with regular approaches, using fallback approach');
      
      // Find all elements that might contain conversation text
      var textElements = Array.from(document.querySelectorAll('div')).filter(div => {
        // Filter elements that likely contain message content
        var text = div.textContent.trim();
        return text && 
               text.length > 5 && 
               text.length < 1000 &&
               !text.includes('Add reaction') &&
               !div.querySelector('button') &&
               div.childElementCount < 5;
      });
      
      console.log(`Found ${textElements.length} potential text elements in fallback approach`);
      
      // Use a Set to track processed text
      var processedTexts = new Set();
      
      textElements.forEach((element, index) => {
        try {
          var text = element.textContent.trim();
          
          // Skip if already processed or too short
          if (processedTexts.has(text) || text.length < 5) {
            return;
          }
          
          processedTexts.add(text);
          exportText += text + '\n\n';
          messageCount++;
          
        } catch (err) {
          console.warn(`Error processing fallback element ${index}:`, err);
        }
      });
    }
    
    console.log(`Extracted ${messageCount} messages`);
    return exportText;
  }
  
  // Download as text file
  function downloadText(text) {
    if (!text || text.length < 10) {
      createNotification('No conversation text was found to export. Please try again with an open chat.', true);
      return;
    }
    
    console.log(`Exporting ${text.length} characters of conversation...`);
    
    var filename = 'google-chat-export-' + new Date().toISOString().split('T')[0] + '.txt';
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    createNotification(`Export complete! Downloaded conversation as ${filename}`);
  }
  
  function cleanMessageString(inputString) {
    var headerMatch = inputString.match(/^\[(.*?)\] ([^:]+):/);
    
    if (!headerMatch) {
      return inputString;
    }
    
    var completeHeader = headerMatch[0];
    var dateTime = headerMatch[1];
    var username = headerMatch[2];
    
    var contentStartIndex = inputString.indexOf(completeHeader) + completeHeader.length;
    var content = inputString.substring(contentStartIndex).trim();
    
    var escapedDateTime = dateTime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
    var dateTimePattern = new RegExp(escapedDateTime + '(\\s*,\\s*)?', 'g');
    var usernamePattern = new RegExp(escapedUsername + '(\\s*,\\s*)?', 'g');
    
    var combinedPattern = new RegExp(escapedUsername + '\\s*,\\s*' + escapedDateTime + '(\\s*,\\s*)?', 'g');
    
    content = content.replace(combinedPattern, '');
    content = content.replace(dateTimePattern, '');
    content = content.replace(usernamePattern, '');
    
    content = content.replace(/\s*,\s*,\s*/g, ''); // Multiple commas
    content = content.replace(/^\s*,\s*/g, '');    // Leading commas
    content = content.replace(/\s*,\s*$/g, '');    // Trailing commas
    content = content.replace(/\s+/g, ' ').trim(); // Extra whitespace
    
    return completeHeader + ' ' + content;
  }
  
  async function runExport() {
    try {
      var statusDiv = createNotification('⏳ Loading older messages... (Scrolling to top)');
      await scrollToTop();
      statusDiv.textContent = '📝 Extracting conversation...';
      await new Promise(resolve => setTimeout(resolve, 300));
      var conversationText = extractMessages();
      statusDiv.textContent = '💾 Preparing download...';

      downloadText(conversationText);
      
    } catch (error) {
      console.error('Error exporting conversation:', error);
      createNotification('Error exporting conversation. Please try again.', true);
    }
  }
  
  runExport();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "exportChatConversation") {
    detectChatFrame();
    
    if (isInChatFrame) {
      console.log('Google Chat Exporter: Starting export in chat frame');
      exportChatConversation();
    } else {
      chrome.runtime.sendMessage({ status: "no_chat_frame" });
    }
  } else if (message.action === "showInstructions") {
    showInstructions();
  }
  
  return true; // Required for async response
});