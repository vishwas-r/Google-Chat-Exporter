# <a href="https://github.com/vishwas-r/Google-Chat-Exporter/"><img src="images/icon.svg" width="32" height="32" alt="Icon"></a> Google Chat Exporter

[![Version](https://img.shields.io/badge/version-2.0.0-green.svg)](https://github.com/vishwas-r/Google-Chat-Exporter)
[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0.en.html)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/vishwas-r/google-chat-exporter/graphs/commit-activity)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/vishwas-r/google-chat-exporter/pulls)
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Extension-Available-blue.svg)](https://chromewebstore.google.com/detail/google-chat-exporter/epemodmmmilflmhgojgonhfcjfjnflgc)

The ultimate, privacy-first browser extension for exporting Google Chat conversations to **Plain Text (TXT)** or **rich HTML with full media attachments (packaged in a ZIP)**.

Works across **Google Chrome, Brave, Microsoft Edge**, standalone PWA windows, and Gmail-embedded Chat.

---

## ✨ Features

- **Dual Export Formats**:
  - **Plain Text (`.txt`)**: Clean, formatted chronological transcript with senders, timestamps, and multi-line formatting preserved.
  - **Structured HTML (`.html + .zip`)**: Complete conversational archive with sender avatars, speech bubbles, embedded images, GIFs, audio notes, video chips, documents, and Google Meet call links.
- **Full Media Extraction**: Automatically downloads photos, GIFs, file attachments, and video previews into a neat `media/` folder inside the ZIP.
- **Automatic History Loading**: Smoothly auto-scrolls up to retrieve past messages and conversation history.
- **Bot & Card Message Support**: Extracts card notifications, webhooks, and bot messages (e.g., alert cards) seamlessly.
- **Universal Compatibility**:
  - Standalone Google Chat (`chat.google.com`)
  - Gmail-integrated Google Chat (`mail.google.com`)
  - Progressive Web App (PWA) / standalone window mode (fully tested and working in Brave & Chrome)
- **Two Easy Export Methods**:
  - **Popup UI**: Modern toolbar popup with live conversation detection, format selection, and progress monitoring.
  - **Context Menu**: Right-click anywhere inside a conversation to export as TXT or HTML with media.
- **Live Animated HUD**: Real-time progress indicator showing message count, scroll progress, and media download status.
- **100% Private & Client-Side**: All parsing and ZIP generation happen inside your browser. No external servers, no tracking, zero telemetry.

---

## 📸 Screenshots

| Feature Overview & Popup | Exported HTML Chat View |
| :---: | :---: |
| ![Features & Popup](images/screenshot-1-features.jpg) | ![HTML Export](images/screenshot-2-html-export.jpg) |

---

## 📥 Installation

### From Chrome Web Store
Install directly from the official store:  
👉 **[Google Chat Exporter on Chrome Web Store](https://chromewebstore.google.com/detail/google-chat-exporter/epemodmmmilflmhgojgonhfcjfjnflgc)**

### Manual Installation (Developer Mode)
1. Clone or download this repository.
2. Open Chrome (or Brave / Edge) and go to `chrome://extensions/`.
3. Toggle **Developer mode** on in the top right.
4. Click **Load unpacked** and select the [`src/`](src) folder.
5. The extension is installed and ready to use!

---

## 🚀 How to Use

1. Navigate to [Google Chat](https://chat.google.com) or Gmail Chat.
2. Click into any direct message or space.
3. Choose either method:
   - **Toolbar Popup**: Click the extension icon in your browser toolbar, select **HTML (with media)** or **TXT**, and click **Export Current Conversation**.
   - **Right-Click**: Right-click anywhere within the chat message area and select **"📄 Export Chat as TXT"** or **"🌐 Export Chat as HTML (with media)"**.
4. The animated status HUD will appear in the bottom-right corner as it scrolls history, extracts messages, and bundles media.
5. Your export file (`.txt` or `.zip`) will download automatically to your Downloads folder.

---

## 🔒 Privacy & Permissions

- **Zero Data Collection**: No user messages, media, or analytics are collected or sent over the internet.
- **Local Packaging**: HTML and ZIP archives are generated client-side using an offline bundling engine (`jszip`).
- **Minimal Permissions**:
  - `activeTab` & `scripting`: To read the chat DOM when initiated by you.
  - `contextMenus`: For convenient right-click options.
  - `downloads`: To save the exported file to your computer.
  - `storage`: To remember your format preferences locally.

---

## 📄 License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.
