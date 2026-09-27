// Studio voice engine: runs a Piper neural text-to-speech model in the browser.
// Loaded as a module worker from /voice/ next to the runtime files that
// scripts/copy-voice-runtime.js copies out of node_modules at build time.
import * as ort from './ort.wasm.min.mjs';
import createPiperPhonemize from './piper_phonemize.mjs';

const here = (file) => new URL(`./${file}`, import.meta.url).href;
const CACHE = 'lol-piper-voices-v1';

ort.env.wasm.wasmPaths = here('');
ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which static hosts don't provide

let session = null;
let config = null;
let loadedVoice = null;
let phonemizer = null;
let pendingIds = null;
let queue = Promise.resolve();

async function fetchCached(url, onProgress) {
  const cache = self.caches ? await caches.open(CACHE) : null;
  const hit = cache && (await cache.match(url));
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const blob = new Blob(parts);
  if (cache) await cache.put(url, new Response(blob)).catch(() => undefined);
  return blob.arrayBuffer();
}

async function getPhonemizer() {
  if (!phonemizer) {
    phonemizer = await createPiperPhonemize({
      print: (line) => {
        const done = pendingIds;
        pendingIds = null;
        done?.(JSON.parse(line).phoneme_ids);
      },
      printErr: () => undefined,
      locateFile: (f) => here(f.endsWith('.wasm') ? 'piper_phonemize.wasm' : 'piper_phonemize.data'),
    });
  }
  return phonemizer;
}

async function phonemeIds(text) {
  const p = await getPhonemizer();
  return new Promise((resolve) => {
    pendingIds = resolve;
    p.callMain(['-l', config.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  });
}

async function load({ voiceId, modelUrl, configUrl }) {
  if (loadedVoice === voiceId && session) return;
  session = null;
  config = JSON.parse(new TextDecoder().decode(await fetchCached(configUrl)));
  const model = await fetchCached(modelUrl, (loaded, total) => postMessage({ type: 'progress', voiceId, loaded, total }));
  postMessage({ type: 'progress', voiceId, loaded: 1, total: 1, preparing: true });
  await getPhonemizer();
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  loadedVoice = voiceId;
}

async function synth({ text, rate }) {
  const ids = await phonemeIds(text);
  const inf = config.inference ?? {};
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, (n) => BigInt(n)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    // Piper controls speed natively (no chipmunk effect): longer length_scale = slower.
    scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / (rate || 1), inf.noise_w ?? 0.8]), [3]),
  };
  if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const { output } = await session.run(feeds);
  return output.data;
}

self.onmessage = (e) => {
  const msg = e.data;
  // Run jobs one at a time: the phonemizer and model are single-threaded.
  queue = queue.then(async () => {
    try {
      if (msg.type === 'load') {
        await load(msg);
        postMessage({ type: 'ready', voiceId: msg.voiceId, id: msg.id });
      } else if (msg.type === 'synth') {
        if (!session) throw new Error('Voice not loaded');
        const pcm = await synth(msg);
        postMessage({ type: 'audio', id: msg.id, pcm, sampleRate: config.audio.sample_rate }, [pcm.buffer]);
      }
    } catch (err) {
      postMessage({ type: 'error', id: msg.id, voiceId: msg.voiceId, message: String(err?.message || err) });
    }
  });
};
