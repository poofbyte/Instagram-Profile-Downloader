# 📸 InstaScrape Pro — Instagram Profile Media Downloader

An advanced, automated **Instagram profile media downloader** available as both a **Stunning Interactive Web Dashboard** and a **Command-Line Interface (CLI)**.

It uses targeted GraphQL & REST API response interception with **Strict Profile Isolation** to extract high-resolution photos, multi-slide carousels, reels, videos, and highlights—packaging everything into clean, organized ZIP backups without mixed content.

---

## ✨ Features

- 🎯 **Strict Profile Isolation** – Guarantees media belongs *exclusively* to the requested profile by validating numeric user IDs (PK) and author data, completely eliminating mixed-in content from suggested accounts, ads, stories trays, or explore suggestions.
- 🍪 **Reliable "Give Cookies" UI** – Built-in modal with real-time authentication status, support for pasting JSON / Header cookies, drag-and-drop file upload (`cookies.json` or `cookie.json`), and instant server synchronization.
- 💻 **Unified CLI & Web Architecture** – Terminal CLI (`npm run instagram`) and the Web App share the exact same underlying extraction engine (`lib/instagram-scraper.js`).
- 🎠 **Multi-Slide Carousel Unpacking** – Extracts 100% of the slides in every carousel album with individual slide numbering.
- 🎬 **Reels & High-Definition Videos** – Automatically captures full-resolution progressive MP4 video streams.
- ⭐ **Highlights Extraction** – Automatically discovers and downloads stories from profile highlights.
- 📦 **Fast ZIP Packaging** – Uses `STORE` compression to package hundreds of media files into ZIP archives in seconds without CPU bottlenecking.
- 🎨 **Modern Glassmorphic Dark UI** – Tailored with Instagram brand gradients, live stage stepper progress bar, filter tabs (Photos, Videos, Carousels, Highlights), multi-select checkboxes, and media lightbox preview.
- 🦁 **Multi-Browser Auto-Detection** – Automatically detects Google Chrome, Brave Browser, Microsoft Edge, or bundled Puppeteer Chromium.

---

## 📸 Supported Media Types

| Media Type | Supported | Notes |
| :--- | :---: | :--- |
| **Grid Posts (Photos)** | ✅ | Highest resolution JPEG/PNG selected by area |
| **Carousel Albums** | ✅ | All slides unpacked with sequential indexing |
| **Reels & Feed Videos** | ✅ | Progressive MP4 video versions |
| **Profile Highlights** | ✅ | Story media extracted directly from highlight reels |
| **Private Profiles** | ✅ | Fully supported when cookies from a follower are provided |

---

## 📋 Prerequisites

- **Node.js** (v18 or higher)
- **Google Chrome**, **Brave**, or **Microsoft Edge** installed.

---

## 🚀 Installation & Quick Start

1. **Clone or Download the Repository:**
   ```bash
   git clone https://github.com/prayingforthelastsunbeam/Instagram-Profile-Downloader.git
   cd Instagram-Profile-Downloader
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Set Up Authentication Cookies (Recommended):**
   - Save your exported cookies as `cookies.json` or `cookie.json` in the project root directory, OR
   - Simply start the Web App and use the **🍪 Give Cookies** button to paste or upload your cookie file.

---

## 🎯 How to Use

### Method 1: Web Dashboard (Recommended)

1. Start the server:
   ```bash
   npm start
   ```

2. Open your browser:
   ```
   http://localhost:3000
   ```

3. Features on the dashboard:
   - Click **🍪 Give Cookies** to check your login status, paste cookies, or upload `cookies.json`.
   - Enter any Instagram username (e.g. `natgeo`) or profile URL and click **Scan Profile**.
   - Monitor the live stepper and color-coded terminal log.
   - Filter by **Photos**, **Videos & Reels**, **Carousels**, or **Highlights**.
   - Multi-select media cards and click **Download Selected (ZIP)** or **Download All (ZIP)**.

---

### Method 2: Terminal CLI

1. Run the Instagram CLI downloader:
   ```bash
   npm run instagram
   # or
   node index.js
   ```

2. Enter the target profile username or URL when prompted:
   ```
   📸  INSTAGRAM PROFILE MEDIA DOWNLOADER (PRO)
   🍪 Authentication: ACTIVE (11 cookies loaded from cookies.json)
   👤 Logged in as User ID: 20298931857

   🔗 Enter Instagram profile URL or username: natgeo
   ```

3. The CLI extracts all profile media, downloads the files to `./<username>/`, and creates `<username>.zip`.

---

## 🏗️ Architecture & Modules

The project is structured into clean, modular libraries:

- `lib/instagram-scraper.js`: Core scraping engine that navigates profile pages, manages pagination, intercepts network data, extracts highlights, and discovers reels.
- `lib/media-extractor.js`: Handles URL normalization, strict profile isolation (`isTargetUserMedia`), resolution picking, carousel slide extraction, and filename sanitization.
- `lib/cookie-manager.js`: Centralized cookie manager supporting `cookies.json` and `cookie.json`, format parsing, validation, and persistence.
- `lib/zip-builder.js`: Fast concurrent media downloading with STORE-compression ZIP creation and HTTP streaming.
- `server.js`: Express web server with SSE real-time streaming, image proxy, and REST endpoints.
- `index.js`: Terminal interface utilizing the unified scraper engine.
- `public/`: Modern frontend with HTML5, vanilla CSS, and JavaScript.

---

## 🔒 Privacy & Safety

Your cookies, credentials, and downloaded media remain entirely on your local machine. This tool is read-only and never performs automated actions (no following, liking, or commenting).