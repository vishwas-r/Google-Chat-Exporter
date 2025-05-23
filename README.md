# <a href="https://github.com/vishwas-r/Google-Chat-Exporter/"><img src="images/icon.svg" width="32" height="32" alt="Icon"></a> Google Chat Exporter

[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](https://github.com/vishwas-r/Google-Chat-Exporter)
[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0.en.html)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/vishwas-r/google-chat-exporter/graphs/commit-activity)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/vishwas-r/google-chat-exporter/pulls)
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Extension-Available-blue.svg)](https://chromewebstore.google.com/detail/google-chat-exporter/epemodmmmilflmhgojgonhfcjfjnflgc)


A Chrome extension that adds functionality to export Google Chat conversations to text files.

## Features
- Export any Google Chat conversation to a plain text file
- Works with both standalone chat.google.com and Gmail-integrated Google Chat
- Intelligent message extraction that includes:
  - Sender names
  - Timestamps
  - Message content
- Preserves conversation history by scrolling to load older messages
- Simple right-click context menu integration

## Installation

### From Chrome Web Store
1. *Coming soon*

### Manual Installation (Developer Mode)
1. Download or clone this repository to your local machine
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" at the top right
4. Click "Load unpacked" button
5. Select the folder containing the extension files
6. The extension should now be installed and ready to use

## How to Use
1. Navigate to [Google Chat](https://chat.google.com) or open Chat in Gmail
2. Open the conversation you want to export
3. Right-click anywhere within the chat conversation
4. Select "Export Chat Conversation" from the context menu
5. The extension will:
   - Show a status indicator in the top right
   - Automatically scroll to load older messages
   - Extract all visible messages
   - Download them as a text file named `google-chat-export-YYYY-MM-DD.txt`

## Requirements
- Google Chrome browser (version 88 or higher recommended)
- Access to Google Chat

## Screenshots
| Chrome Extension | Export Chart Option |
|--------------|--------------|
| ![Chrome Extension](images/chrome-extension.jpg) | ![Export Chat Option](images/chrome-extension-export-chat-option.jpg) |

## Troubleshooting

### "Export Chat Conversation" option doesn't appear
- Make sure you're right-clicking inside a Google Chat conversation frame
- Try opening a specific chat first before attempting to export
- Refresh the page and try again

### Export contains incomplete conversation history
- Some very old messages might not load if they're beyond Google Chat's scroll limit
- Try scrolling up manually first to load more history, then use the exporter

### Export fails with no messages found
- Check if you're in an empty conversation
- Try clicking into a different chat and then back to the one you want to export
- Refresh the page and try again

## How It Works
This extension:
1. Identifies the correct frame containing Google Chat content
2. Adds a context menu option when right-clicking in chat
3. When triggered, automatically scrolls up to load older messages
4. Uses multiple parsing approaches to extract message content, senders, and timestamps
5. Formats everything in a clean text file format
6. Downloads the file to your computer

## Privacy
- This extension operates entirely within your browser
- No data is sent to any external servers
- All message extraction happens locally on your computer
- No message content is stored by the extension

## Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

## License
This project is licensed under the GNU General Public License v3.0 - see the LICENSE file for details.
