// Copies the ONNX runtime WASM files used by on-device Whisper into public/ort so the app never loads code from a CDN.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/onnxruntime-web/dist';
if (!existsSync(src)) process.exit(0);
mkdirSync('public/ort', { recursive: true });
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) cpSync(`${src}/${f}`, `public/ort/${f}`);
