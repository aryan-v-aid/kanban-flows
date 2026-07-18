# KanbanFlow v3.0 — Local-First AI-Powered Kanban Board

KanbanFlow is a highly interactive, privacy-focused, local-first Kanban board application. It stores all data securely in the browser's IndexedDB and features incremental streaming AI generation using Google Gemini, smooth drag-and-drop mechanics, rich card attachments, custom tags, and a daily planning board.

## 🚀 Key Features

*   **100% Local & Private:** All projects, boards, cards, custom tags, and attached images are stored directly in your browser using **IndexedDB**. No database or server accounts are required.
*   **AI-Powered Project Generation:** Describe your project in natural language and have the AI instantly stream complete project setups (boards, columns, cards, descriptions, and custom tags) in real-time. Capable of handling complex, multi-disciplinary workflows.
*   **AI Column Generation:** Instantly generate specialized individual columns complete with curated tasks using the "Generate with AI" button in the column creator.
*   **Today's Tasks (Daily Board):** A specialized daily planning board that auto-expires after 24 hours. Input your appointments, habits, and priorities to generate a customized Kanban board for your current day. Includes an active hours-left badge.
*   **Drag-and-Drop Column & Card Ordering:** Rearrange cards across columns or reorder column lists using a smooth touch-enabled interface powered by **SortableJS**.
*   **Comprehensive Card Editor:** Add formatted descriptions, customize border accents, attach URL links, and drop/paste/upload images (stored locally as base64 URLs up to 4MB).
*   **Search & Tag-Based Filters:** Filter cards in real-time using search queries (matching titles and descriptions) or selecting one or more tag chips.
*   **Easy Backup & Restore:** Export all your boards and custom settings to a single `.json` file, or import legacy/modern backups with automatic tag deduplication, file-size enforcement, and strict data sanitization.
*   **Clean Neon Theme:** A dark-navy interface with vibrant, tailored neon highlights, smooth transitions, glassmorphism blur effects, and responsive mobile layouts.

---

## 🛠️ Technology Stack

*   **Frontend:** Vanilla HTML5, CSS3 Custom Properties (CSS variables), and modern ES6 JavaScript.
*   **Data Storage:** IndexedDB (raw local browser storage, no libraries).
*   **Interactive Drag-and-Drop:** [SortableJS](https://sortablejs.github.io/Sortable/) (via CDN).
*   **AI Stream JSON Repair:** [jsonrepair](https://github.com/josdejong/jsonrepair) (via CDN).
*   **Font Family:** [Inter](https://fonts.google.com/specimen/Inter) and [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) (via Google Fonts).

---

## 💻 Getting Started

### Run Locally (Development)

Since KanbanFlow is built using pure frontend technologies, you can run it directly in your browser:

1.  **Option A (Direct File):** Simply double-click `index.html` to open it in your browser.
2.  **Option B (Local Web Server):** For best results (avoiding browser file-handling restrictions), run a lightweight web server in the directory:
    ```bash
    # Serve using Node
    npx http-server . -p 8080 -c-1
    
    # Or serve using Python
    python -m http.server 8000
    ```

### Production Build

A production compilation script is included to bundle necessary assets to a distribution folder:

```bash
# Run the Build script
node build.js
```
The output will be placed in the `dist/` directory, ready to serve or publish to any static hosting provider.

### Vercel Deployment

KanbanFlow compiles to static assets. To deploy it to Vercel:

1.  Import your repository.
2.  Set the **Output Directory** to `dist`.
3.  Set the **Framework Preset** to `Other` (or blank).
4.  Leave the **Build Command** empty or specify `node build.js`.
5.  Deploy!

---

## 🎨 Asset Information & Logos

The application contains high-quality branding assets in the root folder generated from `logo.svg`:
*   `logo.svg`: Vector source.
*   `logo-16.png` / `logo-32.png` / `logo-48.png` / `logo-512.png`: Multi-resolution PNG assets.
*   `favicon.ico`: Standard multi-size browser favicon.

All PNG/ICO assets can be regenerated from `logo.svg` by running:
```bash
node gen-logo.js
```

---

## 📦 Directory Structure

```
.
├── dist/                    # Production build output
├── index.html               # Main application layout
├── styles.css               # Core CSS design system
├── app.js                   # Application state & logic
├── default_project.js       # Seed project data
├── build.js                 # Production packaging script
├── gen-logo.js              # Logo & Favicon generator
├── logo.svg                 # Vector logo
└── package.json             # Dev scripts & dependencies
```

---

## 🔒 Security & Privacy

*   **API Privacy:** All AI interactions are direct requests from your browser to Google's Gemini API endpoints using secure HTTP headers (`x-goog-api-key`). No query parameters are exposed.
*   **Data Isolation:** Your API Key is kept locally in your IndexedDB database; it is never shared, uploaded, or transmitted to any third-party server besides your chosen AI model provider.
*   **XSS Protection:** All imported and dynamically rendered user data is strictly sanitized and escaped. Links and images are enforced to follow safe protocols.
*   **No Tracking:** No telemetry, cookie tracking, or remote tracking software is active.
