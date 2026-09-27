// "Listen" with the device's own voices (Web Speech API): reads the open book
// aloud paragraph by paragraph, highlighting and following along, pausing the
// way a narrator would, and carrying on into the next part of the book.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useStoredState } from '../hooks';
import { chunkText, pauseAfter } from '../speech';
import { STUDIO_VOICES, StudioSpeaker, isDownloaded, studioSupported, type StudioVoice } from '../studioVoice';
import { Icon } from './Icon';

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

interface ListenSettings {
  rate: number;
  voiceURI: string | null;
}

export const RATES = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const SLEEP_OPTIONS = [0, 15, 30, 45, 60];
const BLOCK_SELECTOR = '.reader-section-title, [data-p]';
const NATURAL = /natural|neural|enhanced|premium|online|siri|wavenet|studio/i;

function voiceScore(v: SpeechSynthesisVoice) {
  let n = 0;
  if (NATURAL.test(v.name)) n += 8; // the most human-sounding voices
  if (/google/i.test(v.name)) n += 3;
  if (/compact|espeak|robot|novelty|whisper|bad news|bells|boing|bubbles|cellos|jester|organ|trinoids|zarvox|albert|fred|junior|ralph/i.test(v.name)) n -= 10;
  if (v.default) n += 1;
  return n;
}

export function isNaturalVoice(v: SpeechSynthesisVoice | null) {
  return Boolean(v && NATURAL.test(v.name));
}

function useVoices(lang: string) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!canSpeak) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  return useMemo(() => {
    const prefix = (lang || 'en').slice(0, 2).toLowerCase();
    const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
    return (matching.length ? matching : voices).slice().sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
  }, [voices, lang]);
}

/** A sleep timer that calls onSleep when time is up; the button cycles off/15/30/45/60 minutes. */
export function useSleepTimer(onSleep: () => void) {
  const [sleepAt, setSleepAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const cb = useRef(onSleep);
  cb.current = onSleep;
  useEffect(() => {
    if (!sleepAt) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= sleepAt) {
        cb.current();
        setSleepAt(null);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [sleepAt]);
  const left = sleepAt ? Math.max(0, Math.ceil((sleepAt - now) / 60000)) : 0;
  const button = (
    <button
      className={`btn btn-sm ${sleepAt ? 'on' : ''}`}
      onClick={() => {
        const current = sleepAt ? SLEEP_OPTIONS.findIndex((m) => m >= left) : 0;
        const next = SLEEP_OPTIONS[(current + 1) % SLEEP_OPTIONS.length]!;
        setSleepAt(next ? Date.now() + next * 60000 : null);
        setNow(Date.now());
      }}
      title="Sleep timer"
      aria-label={sleepAt ? `Sleep timer: ${left} minutes left` : 'Set a sleep timer'}
    >
      <Icon name="moonTimer" size={16} /> {sleepAt ? `${left}m` : 'Sleep'}
    </button>
  );
  return button;
}

/** Keep the screen awake while playing (phones stop speech when the screen locks). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    navigator.wakeLock
      .request('screen')
      .then((l) => {
        if (cancelled) l.release();
        else lock = l;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      lock?.release().catch(() => undefined);
    };
  }, [active]);
}

export interface ListenProps {
  containerRef: RefObject<HTMLElement | null>;
  /** Changes whenever a new part of the book has rendered. */
  sectionKey: string | null;
  lang: string;
  title: string;
  author: string;
  sectionTitle: string;
  hasNext: boolean;
  autoStart: boolean;
  onNeedNext: () => void;
  onClose: () => void;
  /** Extra controls (e.g. the narrator switch). */
  extra?: ReactNode;
}

export function ReadAloudBar({ containerRef, sectionKey, lang, title, author, sectionTitle, hasNext, autoStart, onNeedNext, onClose, extra }: ListenProps) {
  const [settings, setSettings] = useStoredState<ListenSettings>('lol-listen', { rate: 1, voiceURI: null });
  const voices = useVoices(lang);
  const english = (lang || 'en').startsWith('en');
  const studioVoice: StudioVoice | null =
    studioSupported && english ? (STUDIO_VOICES.find((v) => `studio:${v.id}` === settings.voiceURI) ?? null) : null;
  const deviceVoice = voices.find((v) => v.voiceURI === settings.voiceURI) ?? voices[0] ?? null;
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [voiceError, setVoiceError] = useState(false);
  const [download, setDownload] = useState<{ loaded: number; total: number; preparing: boolean } | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  // Mutable playback state, read inside the async reading loop.
  const cursor = useRef({ block: 0, piece: 0 });
  const blocks = useRef<HTMLElement[]>([]);
  const pieceCache = useRef(new Map<number, string[]>());
  const generation = useRef(0); // bumps on every stop, so a stale loop quits
  const continueIntoNext = useRef(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null); // keeps Chrome from garbage-collecting it mid-sentence
  const gap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const studio = useRef<StudioSpeaker | null>(null);
  const showDownload = useRef(false);
  const live = useRef({ deviceVoice, studioVoice, rate: settings.rate, hasNext, onNeedNext });
  live.current = { deviceVoice, studioVoice, rate: settings.rate, hasNext, onNeedNext };

  const collect = useCallback(() => {
    blocks.current = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(BLOCK_SELECTOR) ?? []);
    pieceCache.current.clear();
  }, [containerRef]);

  const piecesFor = useCallback((b: number) => {
    let pieces = pieceCache.current.get(b);
    if (!pieces) {
      const el = blocks.current[b];
      const heading = Boolean(el && (el.classList.contains('reader-section-title') || el.tagName === 'H3'));
      pieces = el ? chunkText(el.textContent ?? '', 220, { heading }) : [];
      pieceCache.current.set(b, pieces);
    }
    return pieces;
  }, []);

  /** The next few pieces after (b, p), for synthesizing ahead. */
  const upcoming = useCallback(
    (b: number, p: number, n: number) => {
      const out: string[] = [];
      let bi = b;
      let pi = p + 1;
      while (out.length < n && bi < blocks.current.length) {
        const pieces = piecesFor(bi);
        if (pi < pieces.length) out.push(pieces[pi++]!);
        else {
          bi++;
          pi = 0;
        }
      }
      return out;
    },
    [piecesFor],
  );

  const highlight = useCallback(
    (i: number | null) => {
      for (const el of containerRef.current?.querySelectorAll('.r-speaking') ?? []) el.classList.remove('r-speaking');
      if (i == null) return;
      const el = blocks.current[i];
      if (!el) return;
      el.classList.add('r-speaking');
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight - 180) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    [containerRef],
  );

  const getStudio = useCallback(() => {
    if (!studio.current) {
      studio.current = new StudioSpeaker();
      studio.current.onProgress = (loaded, total, preparing) => {
        if (showDownload.current) setDownload({ loaded, total, preparing });
      };
    }
    return studio.current;
  }, []);

  const halt = useCallback(() => {
    generation.current++;
    if (gap.current) clearTimeout(gap.current);
    if (canSpeak) window.speechSynthesis.cancel();
    studio.current?.cancel();
    setWaiting(false);
  }, []);

  const stop = useCallback(() => {
    halt();
    setPlaying(false);
  }, [halt]);

  const speakDevice = useCallback(
    (text: string) =>
      new Promise<void>((resolve, reject) => {
        const u = new SpeechSynthesisUtterance(text);
        const v = live.current.deviceVoice;
        u.lang = v?.lang ?? lang;
        if (v) u.voice = v;
        u.rate = live.current.rate;
        u.onend = () => resolve();
        u.onerror = (e) => reject(Object.assign(new Error(e.error), { name: e.error === 'interrupted' || e.error === 'canceled' ? 'AbortError' : 'SpeechError' }));
        utterance.current = u;
        window.speechSynthesis.speak(u);
      }),
    [lang],
  );

  const speakFrom = useCallback(
    (block: number, piece = 0) => {
      halt();
      const gen = generation.current;
      collect();
      cursor.current = { block, piece };
      setPlaying(true);
      setFinished(false);
      setVoiceError(false);
      setStudioError(null);
      let failures = 0;
      const wait = (ms: number) =>
        new Promise<void>((r) => {
          gap.current = setTimeout(r, ms);
        });

      (async () => {
        const voice = live.current.studioVoice;
        if (voice) {
          try {
            setWaiting(true);
            showDownload.current = true;
            await getStudio().load(voice);
            showDownload.current = false;
            setDownload(null);
          } catch (e) {
            showDownload.current = false;
            if (gen !== generation.current) return;
            setDownload(null);
            setStudioError(`Couldn’t load the ${voice.name} voice (${(e as Error).message}). Using the device voice instead.`);
            setSettings((s) => ({ ...s, voiceURI: null }));
            live.current.studioVoice = null;
          }
        }
        while (gen === generation.current) {
          const { block: b, piece: p } = cursor.current;
          if (!blocks.current[b]) {
            // End of this part of the book.
            highlight(null);
            setWaiting(false);
            if (live.current.hasNext) {
              continueIntoNext.current = true;
              live.current.onNeedNext();
            } else {
              setPlaying(false);
              setFinished(true);
            }
            return;
          }
          const pieces = piecesFor(b);
          if (p >= pieces.length) {
            cursor.current = { block: b + 1, piece: 0 };
            continue;
          }
          if (p === 0) highlight(b);
          const text = pieces[p]!;
          const rate = live.current.rate;
          try {
            if (live.current.studioVoice && studio.current) {
              const s = studio.current;
              setWaiting(true); // until the audio for this sentence is ready
              // Ask for this sentence first, then the next few, so playback never waits on the queue.
              const done = s.speak(text, rate, () => gen === generation.current && setWaiting(false));
              s.prefetch(upcoming(b, p, 3), rate);
              await done;
            } else {
              if (!canSpeak) throw Object.assign(new Error('no speech'), { name: 'SpeechError' });
              await speakDevice(text);
            }
            failures = 0;
          } catch (e) {
            if (gen !== generation.current || (e as Error).name === 'AbortError') return;
            // If speech keeps failing (no engine installed), stop instead of racing through the book.
            if (++failures >= 3) {
              setPlaying(false);
              setVoiceError(true);
              return;
            }
          }
          if (gen !== generation.current) return;
          const endOfBlock = p + 1 >= pieces.length;
          const heading = blocks.current[b]!.classList.contains('reader-section-title');
          // Breathe between sentences and paragraphs like a person reading.
          await wait(pauseAfter(text, { endOfBlock, heading }) / rate);
          if (gen !== generation.current) return;
          cursor.current = { block: b, piece: p + 1 };
        }
      })();
    },
    [collect, highlight, halt, piecesFor, upcoming, getStudio, speakDevice, setSettings],
  );

  /** The first paragraph that is at least partly on screen. */
  const firstVisible = useCallback(() => {
    collect();
    const i = blocks.current.findIndex((el) => el.getBoundingClientRect().bottom > 90);
    return Math.max(0, i);
  }, [collect]);

  const play = useCallback(() => {
    const { block, piece } = cursor.current;
    const el = blocks.current[block];
    // Resume where we paused if that paragraph is still on screen; otherwise start at what's visible.
    const onScreen = el && el.isConnected && el.getBoundingClientRect().bottom > 0 && el.getBoundingClientRect().top < window.innerHeight;
    if (onScreen) speakFrom(block, piece);
    else speakFrom(firstVisible());
  }, [speakFrom, firstVisible]);

  const skip = useCallback(
    (dir: 1 | -1) => {
      collect();
      const next = Math.max(0, Math.min(blocks.current.length, cursor.current.block + dir));
      if (playing) speakFrom(next);
      else {
        cursor.current = { block: next, piece: 0 };
        highlight(next);
      }
    },
    [collect, playing, speakFrom, highlight],
  );

  // Warm up an already-downloaded AI voice as soon as the player opens, so Play starts quickly.
  // (A voice that isn't downloaded yet only downloads when the reader presses Play.)
  useEffect(() => {
    if (!studioVoice) return;
    let cancelled = false;
    isDownloaded(studioVoice).then((yes) => {
      if (yes && !cancelled) getStudio().load(studioVoice).catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [studioVoice, getStudio]);

  // A new part of the book has rendered: keep going if we were mid-listen.
  useEffect(() => {
    if (!sectionKey) return;
    cursor.current = { block: 0, piece: 0 };
    if (continueIntoNext.current) {
      continueIntoNext.current = false;
      const t = setTimeout(() => speakFrom(0), 400);
      return () => clearTimeout(t);
    }
    if (playing) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionKey]);

  // Start straight away when opened from a "Listen" button.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current || !sectionKey) return;
    started.current = true;
    const t = setTimeout(play, 500);
    return () => clearTimeout(t);
  }, [autoStart, sectionKey, play]);

  // Tap a paragraph to listen from there.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      if (window.getSelection()?.toString()) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>(BLOCK_SELECTOR);
      if (!el) return;
      collect();
      const i = blocks.current.indexOf(el);
      if (i >= 0) speakFrom(i);
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [containerRef, sectionKey, collect, speakFrom]);

  // Changing speed or voice takes effect immediately.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (playing) speakFrom(cursor.current.block, cursor.current.piece);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.rate, settings.voiceURI]);

  const sleepButton = useSleepTimer(stop);
  useWakeLock(playing);

  // Headset buttons and lock-screen controls where supported.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title: sectionTitle || title, artist: author, album: title });
    ms.playbackState = playing ? 'playing' : 'paused';
    const handlers: [MediaSessionAction, () => void][] = [
      ['play', play],
      ['pause', stop],
      ['nexttrack', () => skip(1)],
      ['previoustrack', () => skip(-1)],
    ];
    for (const [a, h] of handlers) {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* unsupported action */
      }
    }
    return () => {
      for (const [a] of handlers) {
        try {
          ms.setActionHandler(a, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [play, stop, skip, playing, title, author, sectionTitle]);

  // Space toggles play/pause while the player is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName)) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (playing) stop();
        else play();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, play, stop]);

  // Silence and clean up when the player closes.
  useEffect(
    () => () => {
      generation.current++;
      if (gap.current) clearTimeout(gap.current);
      if (canSpeak) window.speechSynthesis.cancel();
      studio.current?.dispose();
      studio.current = null;
      for (const el of document.querySelectorAll('.r-speaking')) el.classList.remove('r-speaking');
    },
    [],
  );

  const canUseStudio = studioSupported && english;
  if (!canSpeak && !canUseStudio) {
    return (
      <div className="listen-bar" role="region" aria-label="Listen">
        <p className="listen-note">Your browser can’t read aloud. Try Chrome, Edge or Safari.</p>
        {extra}
        <button className="icon-btn listen-close" onClick={onClose} aria-label="Close player">
          <Icon name="x" />
        </button>
      </div>
    );
  }

  const natural = Boolean(studioVoice) || isNaturalVoice(deviceVoice);
  const pct = download && download.total ? Math.round((download.loaded / download.total) * 100) : null;
  let heading = voiceError ? 'No voice available' : finished ? 'The end' : playing ? 'Reading aloud' : 'Paused';
  let detail: ReactNode;
  if (download && studioVoice) {
    heading = download.preparing ? `Preparing ${studioVoice.name}…` : `Downloading ${studioVoice.name}${pct != null ? ` · ${pct}%` : '…'}`;
    detail = download.preparing ? 'Almost ready.' : `One-time download (about ${studioVoice.sizeMb} MB). After this it works offline.`;
  } else if (studioError) detail = studioError;
  else if (voiceError) detail = 'Your device has no working text-to-speech voice. Choose a natural AI voice from the list, or install a voice in your system settings.';
  else if (finished) detail = `You’ve listened to all of ${title}.`;
  else if (playing && waiting && studioVoice) detail = `${studioVoice.name} is getting ready to read…`;
  else if (studioVoice) detail = `${studioVoice.name} · natural AI voice · tap any paragraph to jump there.`;
  else if (natural) detail = 'Natural voice · tap any paragraph to listen from there.';
  else if (canUseStudio)
    detail = (
      <>
        Sounds robotic?{' '}
        <button className="link-btn" onClick={() => setSettings({ ...settings, voiceURI: `studio:${STUDIO_VOICES[0]!.id}` })}>
          Try a natural AI voice ✦
        </button>
      </>
    );
  else detail = 'Tip: voices marked ★ sound most natural. Tap any paragraph to jump there.';

  return (
    <div className="listen-bar" role="region" aria-label="Listen to this book">
      <div className="listen-top">
        <div className="listen-main">
          <button className="icon-btn" onClick={() => skip(-1)} aria-label="Previous paragraph" title="Previous paragraph">
            <Icon name="skipBack" />
          </button>
          <button className="listen-play" onClick={playing ? stop : play} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (space)' : 'Play (space)'}>
            {playing && (waiting || download) ? <span className="spinner spinner-light" /> : <Icon name={playing ? 'pause' : 'play'} size={24} />}
          </button>
          <button className="icon-btn" onClick={() => skip(1)} aria-label="Next paragraph" title="Next paragraph">
            <Icon name="skipForward" />
          </button>
        </div>
        <div className="listen-status" aria-live="polite">
          <strong>{heading}</strong>
          <span>{detail}</span>
          {download && !download.preparing && pct != null && (
            <span className="listen-progress" aria-hidden>
              <span style={{ width: `${pct}%` }} />
            </span>
          )}
        </div>
      </div>
      <div className="listen-options">
        {extra}
        <select value={settings.rate} onChange={(e) => setSettings({ ...settings, rate: Number(e.target.value) })} aria-label="Reading speed">
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        <select
          className="listen-voice"
          value={studioVoice ? `studio:${studioVoice.id}` : (deviceVoice?.voiceURI ?? '')}
          onChange={(e) => setSettings({ ...settings, voiceURI: e.target.value || null })}
          aria-label="Voice"
        >
          {canUseStudio && (
            <optgroup label="✦ Natural AI voices (one-time download)">
              {STUDIO_VOICES.map((v) => (
                <option key={v.id} value={`studio:${v.id}`}>
                  ✦ {v.name} · {v.accent} (AI)
                </option>
              ))}
            </optgroup>
          )}
          {canSpeak && voices.length > 0 && (
            <optgroup label="Voices on this device">
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {isNaturalVoice(v) ? '★ ' : ''}
                  {v.name.replace(/^(Microsoft|Google)\s+/, '').replace(/\s*-\s*English.*$/, '')} ({v.lang})
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {sleepButton}
      </div>
      <button className="icon-btn listen-close" onClick={onClose} aria-label="Close player" title="Close player">
        <Icon name="x" />
      </button>
    </div>
  );
}
