# LocalMind – in-browser AI chat

A private chatbot that runs entirely in the browser on **WebGPU** (via [WebLLM](https://github.com/mlc-ai/web-llm)). No install, no server, no API key.

- Chat and coding models from 360M to 7B parameters (Qwen2.5 / Qwen2.5-Coder / Qwen3 / Llama 3.2 / Gemma 2 / Phi 3.5 / SmolLM2)
- Streaming replies, Markdown + syntax-highlighted code, one-click copy, **Run** for JS/HTML blocks (sandboxed iframe)
- Live dashboard: tokens/s, time-to-first-token, prefill/decode speed, token counts, UI-thread load, FPS, JS heap, GPU activity, estimated model VRAM, storage, CPU threads, device memory, network, battery
- All generation parameters adjustable (temperature, top-p, max tokens, penalties, seed, context window, system prompt)
- Inference runs in a Web Worker so the UI stays smooth; weights are cached after the first download

## Run

Serve the folder over HTTP(S) (WebGPU needs a secure context; `localhost` counts) and open it in Chrome/Edge/Brave 113+:

```
npx http-server ai-chat -p 8080
```

or host `ai-chat/index.html` on any static host (GitHub Pages, Netlify, …).
