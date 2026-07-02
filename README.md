# KanbanFlow v2.0

*A local-first AI-powered Kanban board that generates complete project plans from natural language while keeping all of your data in your browser.*

---

## ✨ Overview

KanbanFlow is a privacy-first Kanban application that combines traditional task management with AI-assisted project planning.

Instead of manually creating columns, cards, and milestones, you can describe your project in plain English and let AI generate a complete board. Everything—including projects, images, settings, and API keys—is stored locally using IndexedDB, giving you full ownership of your data.

The application requires no backend, no user accounts, and no cloud database.

---

## 🚀 Features

### 🤖 AI Project Generation

Generate complete Kanban boards from a single prompt.

The AI automatically creates:

- Project structure
- Columns
- Task cards
- Card descriptions
- Custom tags
- Multi-week project roadmaps
- Daily task boards

Supports streaming responses for fast incremental generation.

---

### 📅 Today's Tasks

Generate a dedicated board for today's schedule.

Simply describe your day:

> Gym at 6 PM, finish my report, buy groceries, study React for two hours.

KanbanFlow creates a focused daily board that automatically expires after **24 hours**, preventing clutter.

Features include:

- Auto-expiring boards
- Countdown timer
- AI-generated priorities
- Daily workflow organization

---

### 💾 Local-First Storage

Everything is stored securely in your browser using **IndexedDB**.

Stored locally:

- Projects
- Boards
- Cards
- Images
- Tags
- Settings
- API keys

No accounts.  
No servers.  
No cloud database.

---

### 🖱️ Drag & Drop

Organize work naturally with smooth drag-and-drop powered by **SortableJS**.

- Move cards between columns
- Reorder columns
- Mobile-friendly interactions
- Smooth animations

---

### 📝 Rich Card Editor

Each card supports:

- Detailed descriptions
- Custom accent colors
- Links
- Image attachments
- Drag & drop uploads
- Paste from clipboard

Images are stored locally as Base64 data.

---

### 🔍 Search & Filters

Quickly find work using:

- Live search
- Tag filtering
- Multiple tag selection
- Description search

---

### 💾 Backup & Restore

Export your entire workspace as a single JSON file.

Import supports:

- Legacy backups
- Current backups
- Duplicate tag detection
- ID collision protection

---

### 🎨 Modern UI

Designed with a clean dark theme featuring:

- Neon highlights
- Glassmorphism
- Smooth animations
- Responsive layout
- Desktop-first experience

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| HTML5 | Application structure |
| CSS3 | Styling & design system |
| JavaScript (ES6) | Application logic |
| IndexedDB | Local database |
| SortableJS | Drag-and-drop |
| jsonrepair | AI JSON recovery |
| Google Gemini API | AI board generation |
| Anthropic Claude | Alternative AI provider |

---

## 📁 Project Structure

```text
.
├── dist/                   # Production build
├── index.html              # Main application
├── app.js                  # Core application logic
├── styles.css              # UI styling
├── default_project.js      # Example project
├── build.js                # Production build script
├── gen-logo.js             # Logo generator
├── logo.svg
└── package.json
```

---

## 🚀 Running Locally

Clone the repository:

```bash
git clone https://github.com/yourusername/kanbanflow.git
cd kanbanflow
```

### Option 1

Open `index.html` directly in your browser.

### Option 2 (Recommended)

Using Node:

```bash
npx serve .
```

Using Python:

```bash
python -m http.server 8000
```

---

## 📦 Production Build

Install dependencies (only needed for logo generation and build scripts):

```bash
npm install
```

Build the production version:

```bash
node build.js
```

The compiled application will be available inside:

```text
dist/
```

---

## ▲ Deploying to Vercel

1. Import your repository.
2. Set **Framework Preset** to **Other**.
3. Set **Output Directory** to:

```text
dist
```

4. Leave the Build Command empty or use:

```bash
node build.js
```

5. Deploy.

---

## 🎨 Branding Assets

Included assets:

```text
logo.svg
logo-16.png
logo-32.png
logo-48.png
logo-512.png
favicon.ico
```

Regenerate them with:

```bash
node gen-logo.js
```

---

## 🔒 Privacy

KanbanFlow is designed around a local-first architecture.

- No accounts
- No backend
- No remote database
- No analytics
- No telemetry
- No cookies

AI requests are sent directly from your browser to your selected provider.

Your API key remains stored locally in IndexedDB.

---

## 📌 Current Status

**Version:** 2.0

Current limitations:

- Desktop experience is prioritized.
- No real-time collaboration.
- No cloud synchronization.
- No mobile-specific optimizations yet.

---

## 🛣️ Planned Features

- Calendar integration
- Recurring tasks
- Markdown editor
- Better AI planning
- Project templates
- Import from Trello
- Offline PWA support
- Local LLM integration

---

## 📄 License

This project is released under the MIT License.