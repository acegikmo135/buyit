# AiSheet

A minimal, native Windows spreadsheet where the AI can read and edit your sheet — **bring your own key**.
Built with Tauri 2 (Rust + WebView2) and React. English and ગુજરાતી throughout.

## Features
- **Canvas grid**: virtualized, smooth scrolling, frozen panes, resize/auto-fit columns, fill handle, multi-select, copy/cut/paste (TSV, formulas keep relative refs), context menu.
- **Formula engine** (~90 functions): SUM/AVERAGE/IF/IFERROR/SUMIF(S)/COUNTIF(S)/VLOOKUP/HLOOKUP/XLOOKUP/INDEX/MATCH/TEXT/date & text functions, cross-sheet refs, cycle detection; refs auto-adjust on insert/delete rows/cols and sheet rename.
- **Editing**: number formats (incl. ₹ with lakh/crore grouping), bold/italic/underline, colors, alignment, wrap, sort, freeze, undo/redo, multiple sheets.
- **Files**: open/save `.xlsx` (values, formulas, basic styles, widths, freeze) and `.csv`.
- **AI (BYOK)**: OpenAI, Claude, Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, Ollama, any OpenAI-compatible endpoint. Keys are stored in the **Windows Credential Manager**.
- **Permissions**: *Ask me first* (preview ghost cells on the sheet, tick/untick each action) · *Auto-apply* · *Read-only*; per-category allow list (write/format/structure/sheets/delete), *selection only* scope, confirm-destructive.
- **Revert**: every AI run is one undoable transaction — "Revert" in chat, or restore any point in the History panel.
- **Animated edits**: the AI "types" into cells with a glowing cursor and a fading highlight.
- **Voice (free)**: dictate in English, Gujarati or a mix (`Ctrl+Shift+Space`) with a live waveform and live transcript. Runs **on-device with whisper.cpp** (quantized models, downloaded and managed in Settings → Voice with live progress, resume, mirror fallback and a log; the model unloads when idle to save RAM). Optional cloud transcription with your OpenAI/Groq/Gemini key. Smart clean-up removes fillers, fixes punctuation and turns "a one to b five" into `A1:B5`.
- **Gujarati**: full UI translation, Gujarati/Devanagari digits accepted as numbers, Gujarati collation for sorting, bundled Noto Sans Gujarati, IME-safe editing.

## Develop
```bash
cd aisheet
npm install            # run on Windows/CI for full native deps

npm test               # engine, AI-protocol and voice clean-up tests
npm run tauri dev      # native window (needs Rust + WebView2)
npm run tauri build    # NSIS + MSI installers
```
CI (`.github/workflows/aisheet-windows.yml`) builds the Windows installers on every push to `aisheet/`.

## How the AI edits
The model replies with JSON `{message, actions[]}` (set_range, fill_formula, format, sort, insert/delete rows/cols, sheets…) — provider-agnostic, no native tool-calling needed. Actions are screened against your permissions, dry-run on a clone for the preview, then applied in one transaction.

## Notes / not yet done
Charts, conditional formatting, merged cells, pivot tables and macros are not implemented. The native Windows build was not compiled in the authoring environment (Linux, no WebView2); the web UI, engine and tests were. Gujarati accuracy is best with the Small/Medium models or cloud transcription.
