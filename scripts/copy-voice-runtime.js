// Copies the in-browser neural voice runtime (ONNX Runtime + Piper's
// phonemizer) and our worker into client/public/voice so they are served
// as plain static files next to the site.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'client/public/voice');
fs.mkdirSync(out, { recursive: true });
const ort = path.join(root, 'node_modules/onnxruntime-web/dist');
const piper = path.join(root, 'node_modules/@diffusionstudio/piper-wasm/build');

for (const f of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  fs.copyFileSync(path.join(ort, f), path.join(out, f));
}
for (const f of ['piper_phonemize.wasm', 'piper_phonemize.data']) {
  fs.copyFileSync(path.join(piper, f), path.join(out, f));
}
// The phonemizer ships as a classic script; expose it as an ES module for the module worker.
const js = fs.readFileSync(path.join(piper, 'piper_phonemize.js'), 'utf8');
fs.writeFileSync(path.join(out, 'piper_phonemize.mjs'), `${js}\nexport default createPiperPhonemize;\n`);
fs.copyFileSync(path.join(root, 'client/voice/worker.mjs'), path.join(out, 'worker.mjs'));
console.log('Copied voice runtime to client/public/voice');
