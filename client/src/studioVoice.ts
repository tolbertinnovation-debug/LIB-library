// "Studio voices": natural-sounding neural voices (Piper, by the Rhasspy
// project) that run entirely in the reader's browser. A voice is downloaded
// once from the official Piper voice library, then works offline.

export interface StudioVoice {
  id: string;
  name: string;
  accent: string;
  description: string;
  path: string; // inside rhasspy/piper-voices
  sizeMb: number;
}

const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0';

export const STUDIO_VOICES: StudioVoice[] = [
  { id: 'en_US-lessac-medium', name: 'Lessac', accent: 'American', description: 'Warm, clear storyteller', path: 'en/en_US/lessac/medium/en_US-lessac-medium', sizeMb: 63 },
  { id: 'en_GB-alba-medium', name: 'Alba', accent: 'Scottish', description: 'Gentle and bright', path: 'en/en_GB/alba/medium/en_GB-alba-medium', sizeMb: 63 },
  { id: 'en_US-ryan-medium', name: 'Ryan', accent: 'American', description: 'Steady male narrator', path: 'en/en_US/ryan/medium/en_US-ryan-medium', sizeMb: 63 },
  { id: 'en_GB-alan-medium', name: 'Alan', accent: 'British', description: 'Calm male reader', path: 'en/en_GB/alan/medium/en_GB-alan-medium', sizeMb: 63 },
  { id: 'en_US-hfc_female-medium', name: 'Hannah', accent: 'American', description: 'Friendly and lively', path: 'en/en_US/hfc_female/medium/en_US-hfc_female-medium', sizeMb: 63 },
];

export const studioSupported =
  typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && 'AudioContext' in window;

const CACHE = 'lol-piper-voices-v1';
export const modelUrl = (v: StudioVoice) => `${HF}/${v.path}.onnx`;
export const configUrl = (v: StudioVoice) => `${HF}/${v.path}.onnx.json`;

/** Whether a voice has already been downloaded to this device. */
export async function isDownloaded(v: StudioVoice): Promise<boolean> {
  try {
    const c = await caches.open(CACHE);
    return Boolean(await c.match(modelUrl(v)));
  } catch {
    return false;
  }
}

export async function removeVoice(v: StudioVoice) {
  try {
    const c = await caches.open(CACHE);
    await c.delete(modelUrl(v));
    await c.delete(configUrl(v));
  } catch {
    /* ignore */
  }
}

type Pending = { resolve: (v: { pcm: Float32Array; sampleRate: number }) => void; reject: (e: Error) => void };

/** Talks to the worker and plays synthesized speech through Web Audio. */
export class StudioSpeaker {
  private worker: Worker;
  private ctx: AudioContext;
  private nextId = 1;
  private jobs = new Map<number, Pending>();
  private loads = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  private ready: Promise<void> | null = null;
  private voiceId: string | null = null;
  private cache = new Map<string, Promise<AudioBuffer>>();
  private source: AudioBufferSourceNode | null = null;
  private stopPlayback: (() => void) | null = null;
  onProgress: ((loaded: number, total: number, preparing: boolean) => void) | null = null;

  constructor() {
    this.worker = new Worker(`${import.meta.env.BASE_URL}voice/worker.mjs`, { type: 'module' });
    this.ctx = new AudioContext();
    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'progress') this.onProgress?.(m.loaded, m.total, Boolean(m.preparing));
      else if (m.type === 'ready') this.loads.get(m.id)?.resolve();
      else if (m.type === 'audio') this.jobs.get(m.id)?.resolve({ pcm: m.pcm, sampleRate: m.sampleRate });
      else if (m.type === 'error') {
        const err = new Error(m.message);
        this.loads.get(m.id)?.reject(err);
        this.jobs.get(m.id)?.reject(err);
      }
      if (m.id != null && m.type !== 'progress') {
        this.jobs.delete(m.id);
        this.loads.delete(m.id);
      }
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'The voice engine could not start.');
      for (const j of this.jobs.values()) j.reject(err);
      for (const l of this.loads.values()) l.reject(err);
      this.jobs.clear();
      this.loads.clear();
    };
  }

  /** Download (first time) and load a voice. */
  load(voice: StudioVoice): Promise<void> {
    if (this.voiceId === voice.id && this.ready) return this.ready;
    this.voiceId = voice.id;
    this.cache.clear();
    const id = this.nextId++;
    this.ready = new Promise<void>((resolve, reject) => {
      this.loads.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'load', id, voiceId: voice.id, modelUrl: modelUrl(voice), configUrl: configUrl(voice) });
    });
    this.ready.catch(() => {
      this.ready = null;
      this.voiceId = null;
    });
    return this.ready;
  }

  private synth(text: string, rate: number): Promise<AudioBuffer> {
    const key = `${rate}|${text}`;
    let p = this.cache.get(key);
    if (!p) {
      const id = this.nextId++;
      p = new Promise<{ pcm: Float32Array; sampleRate: number }>((resolve, reject) => {
        this.jobs.set(id, { resolve, reject });
        this.worker.postMessage({ type: 'synth', id, text, rate });
      }).then(({ pcm, sampleRate }) => {
        const buf = this.ctx.createBuffer(1, pcm.length, sampleRate);
        buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
        return buf;
      });
      this.cache.set(key, p);
      p.catch(() => this.cache.delete(key));
      // Keep memory bounded.
      if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  /** Start synthesizing upcoming sentences so playback never waits. */
  prefetch(texts: string[], rate: number) {
    for (const t of texts) this.synth(t, rate).catch(() => undefined);
  }

  /** Speak one piece; resolves when it has finished playing. */
  async speak(text: string, rate: number, onStart?: () => void): Promise<void> {
    const pending = this.synth(text, rate); // queue this sentence before anything else
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
    const buf = await pending;
    this.cache.delete(`${rate}|${text}`);
    await new Promise<void>((resolve, reject) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      // A gentle fade in/out avoids clicks between sentences.
      const gain = this.ctx.createGain();
      const t0 = this.ctx.currentTime;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(1, t0 + 0.012);
      gain.gain.setValueAtTime(1, t0 + Math.max(0.02, buf.duration - 0.02));
      gain.gain.linearRampToValueAtTime(0, t0 + buf.duration);
      src.connect(gain).connect(this.ctx.destination);
      this.source = src;
      this.stopPlayback = () => reject(Object.assign(new Error('stopped'), { name: 'AbortError' }));
      src.onended = () => {
        if (this.source === src) {
          this.source = null;
          this.stopPlayback = null;
        }
        resolve();
      };
      onStart?.();
      src.start();
    });
  }

  cancel() {
    const stop = this.stopPlayback;
    this.stopPlayback = null;
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source = null;
    }
    stop?.();
  }

  dispose() {
    this.cancel();
    this.worker.terminate();
    this.ctx.close().catch(() => undefined);
  }
}
