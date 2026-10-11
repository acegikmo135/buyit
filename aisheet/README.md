# AiSheet

A fast, minimal Windows spreadsheet with a ChatGPT-style AI assistant that can read and edit your sheet.
English and ગુજરાતી throughout. Bring your own AI key.

**Stack:** Go + [Wails](https://wails.io) (native window on the system WebView2) · React 19 · [HeroUI v3](https://heroui.com) · Tailwind v4 · custom canvas grid.
No Electron/Chromium bundle, no local AI models — the app is a ~14 MB exe.

## Features
- **Spreadsheet**: canvas grid (virtualised, frozen panes, fill handle, resize/auto-fit), ~90 formula functions, number formats (₹ lakh/crore grouping), formatting, sort, multiple sheets, undo/redo, status-bar Sum/Average/Count.
- **Excel-class editing**: ribbon (Home / Insert / Data / View / AI), AutoFilter dropdowns, conditional formatting (rules, colour scales, data bars), merge cells + borders, data validation (dropdown lists, limits), pivot tables (live formulas), find & replace, remove duplicates, text-to-columns, comments, named ranges, hide/unhide, zoom, auto column/row fit, print / PDF + page setup, ~130 functions, in-app charts (column, bar, line, area, pie, doughnut, scatter). Merges, borders, validation, comments, filters and names round-trip through `.xlsx`; charts, conditional formats and page setup are stored in a hidden `__AiSheet` sheet.
- **Smarter AI**: the assistant reads more of your sheet on demand (range / search / profile / evaluate tools), self-checks its changes on a copy and repairs new formula errors before showing them, and for big jobs proposes a **plan** and runs **parallel sub-agents** with a live progress card, merged into one reviewable, revertable change. **Formula creator** (describe → formula with live result, explain, fix errors) and **Speak to formula** (dictate it with Deepgram), plus one-click Insights, Clean data, Suggest chart and Build dashboard.
- **Files**: open `.xlsx/.xlsm/.csv/.tsv` via Ctrl+O, **drag & drop**, double-click, or right-click → **Open with AiSheet**. Opening a file while AiSheet is running reuses the same window. Saves `.xlsx` atomically.
- **Assistant**: streaming Markdown replies; edits arrive as a previewed change set (ghost cells on the sheet) you approve per action, or auto-apply; every run is one undoable step with *Revert*; animated "AI typing" on the sheet.
- **Permissions**: Ask / Auto / Read-only, per-category allow list, selection-only scope, confirm destructive actions.
- **Providers**: OpenAI, Claude, Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, Ollama, any OpenAI-compatible endpoint. Keys live in **Windows Credential Manager**; requests go from the Go process (no CORS, nothing in web storage).
- **OpenRouter privacy**: *Strict privacy* (default) sends `provider: { data_collection: "deny", zdr: true }` so prompts only reach endpoints that don't retain or train on data.
- **Voice**: live dictation with **Deepgram Nova-3** (English or Gujarati). Text streams into the prompt box while you speak; smart clean-up removes fillers and fixes punctuation / cell references (`Ctrl+Shift+Space`).

## Build
```bash
cd aisheet
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
cd frontend && npm ci && npm test && cd ..
wails build -platform windows/amd64        # → build/bin/AiSheet.exe  (cross-compiles from Linux too)
iscc /DAppVersion=0.3.0 installer\aisheet.iss   # Inno Setup → dist-out/AiSheet-Setup.exe
```
`npm run dev` in `frontend/` gives a browser preview (file picker/downloads instead of native dialogs).
CI (`.github/workflows/aisheet-windows.yml`) builds and publishes both files to the `aisheet-latest` release.

## Not included
Charts, conditional formatting, merged cells, pivot tables, macros, legacy `.xls`.
