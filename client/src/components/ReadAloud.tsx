// "Listen" mode: reads the open book aloud with the device's own voices
// (Web Speech API), highlighting and following along paragraph by paragraph,
// and carrying on into the next part of the book automatically.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useStoredState } from '../hooks';
import { chunkText } from '../speech';
import { Icon } from './Icon';

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

interface ListenSettings {
  rate: number;
  voiceURI: string | null;
}

const RATES = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const SLEEP_OPTIONS = [0, 15, 30, 45, 60];
const BLOCK_SELECTOR = '.reader-section-title, [data-p]';

function voiceScore(v: SpeechSynthesisVoice) {
  let n = 0;
  if (/natural|neural|enhanced|premium|online/i.test(v.name)) n += 4;
  if (/google/i.test(v.name)) n += 2;
  if (v.localService) n += 1;
  if (v.default) n += 1;
  return n;
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

interface Props {
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
}

export function ReadAloudBar({ containerRef, sectionKey, lang, title, author, sectionTitle, hasNext, autoStart, onNeedNext, onClose }: Props) {
  const [settings, setSettings] = useStoredState<ListenSettings>('lol-listen', { rate: 1, voiceURI: null });
  const voices = useVoices(lang);
  const voice = voices.find((v) => v.voiceURI === settings.voiceURI) ?? voices[0] ?? null;
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [sleepAt, setSleepAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // Mutable playback state, read inside speech callbacks.
  const cursor = useRef({ block: 0, piece: 0 });
  const blocks = useRef<HTMLElement[]>([]);
  const generation = useRef(0); // bumps on every stop, so stale callbacks are ignored
  const continueIntoNext = useRef(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null); // keeps Chrome from garbage-collecting it mid-sentence
  const failures = useRef(0);
  const [voiceError, setVoiceError] = useState(false);
  const live = useRef({ voice, rate: settings.rate, hasNext, onNeedNext });
  live.current = { voice, rate: settings.rate, hasNext, onNeedNext };

  const collect = useCallback(() => {
    blocks.current = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(BLOCK_SELECTOR) ?? []);
  }, [containerRef]);

  const highlight = useCallback((i: number | null) => {
    for (const el of containerRef.current?.querySelectorAll('.r-speaking') ?? []) el.classList.remove('r-speaking');
    if (i == null) return;
    const el = blocks.current[i];
    if (!el) return;
    el.classList.add('r-speaking');
    const r = el.getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 140) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [containerRef]);

  const stop = useCallback(() => {
    generation.current++;
    window.speechSynthesis.cancel();
    setPlaying(false);
  }, []);

  const speakFrom = useCallback(
    (block: number, piece = 0) => {
      if (!canSpeak) return;
      generation.current++;
      const gen = generation.current;
      window.speechSynthesis.cancel();
      collect();
      cursor.current = { block, piece };
      setPlaying(true);
      setFinished(false);
      setVoiceError(false);
      failures.current = 0;

      const step = () => {
        if (gen !== generation.current) return;
        const { block: b, piece: p } = cursor.current;
        const el = blocks.current[b];
        if (!el) {
          // End of this part of the book.
          highlight(null);
          if (live.current.hasNext) {
            continueIntoNext.current = true;
            live.current.onNeedNext();
          } else {
            setPlaying(false);
            setFinished(true);
          }
          return;
        }
        const pieces = chunkText(el.textContent ?? '');
        if (p >= pieces.length) {
          cursor.current = { block: b + 1, piece: 0 };
          step();
          return;
        }
        if (p === 0) highlight(b);
        const u = new SpeechSynthesisUtterance(pieces[p]);
        u.lang = live.current.voice?.lang ?? lang;
        if (live.current.voice) u.voice = live.current.voice;
        u.rate = live.current.rate;
        u.onend = () => {
          if (gen !== generation.current) return;
          failures.current = 0;
          cursor.current = { block: b, piece: p + 1 };
          step();
        };
        u.onerror = (e) => {
          if (gen !== generation.current || e.error === 'interrupted' || e.error === 'canceled') return;
          // If the voice keeps failing (no speech engine installed), stop instead of racing through the book.
          if (++failures.current >= 3) {
            generation.current++;
            setPlaying(false);
            setVoiceError(true);
            return;
          }
          // Skip a piece the voice can't handle rather than stopping.
          cursor.current = { block: b, piece: p + 1 };
          step();
        };
        utterance.current = u;
        window.speechSynthesis.speak(u);
      };
      step();
    },
    [collect, highlight, lang],
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

  // Sleep timer.
  useEffect(() => {
    if (!sleepAt) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= sleepAt) {
        stop();
        setSleepAt(null);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [sleepAt, stop]);

  // Keep the screen awake while listening (phones stop speech when the screen locks).
  useEffect(() => {
    if (!playing || !('wakeLock' in navigator)) return;
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
  }, [playing]);

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
      window.speechSynthesis.cancel();
      for (const el of document.querySelectorAll('.r-speaking')) el.classList.remove('r-speaking');
    },
    [],
  );

  if (!canSpeak) {
    return (
      <div className="listen-bar" role="region" aria-label="Listen">
        <p className="listen-note">Your browser can’t read aloud. Try Chrome, Edge or Safari.</p>
        <button className="icon-btn" onClick={onClose} aria-label="Close player">
          <Icon name="x" />
        </button>
      </div>
    );
  }

  const sleepLeft = sleepAt ? Math.max(0, Math.ceil((sleepAt - now) / 60000)) : 0;
  const cycleSleep = () => {
    const current = sleepAt ? SLEEP_OPTIONS.findIndex((m) => m >= sleepLeft) : 0;
    const next = SLEEP_OPTIONS[(current + 1) % SLEEP_OPTIONS.length]!;
    setSleepAt(next ? Date.now() + next * 60000 : null);
    setNow(Date.now());
  };

  return (
    <div className="listen-bar" role="region" aria-label="Listen to this book">
      <div className="listen-main">
        <button className="icon-btn" onClick={() => skip(-1)} aria-label="Previous paragraph" title="Previous paragraph">
          <Icon name="skipBack" />
        </button>
        <button className="listen-play" onClick={playing ? stop : play} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (space)' : 'Play (space)'}>
          <Icon name={playing ? 'pause' : 'play'} size={24} />
        </button>
        <button className="icon-btn" onClick={() => skip(1)} aria-label="Next paragraph" title="Next paragraph">
          <Icon name="skipForward" />
        </button>
      </div>
      <div className="listen-status" aria-live="polite">
        <strong>{voiceError ? 'No voice available' : finished ? 'The end' : playing ? 'Reading aloud' : 'Paused'}</strong>
        <span>
          {voiceError
            ? 'Your device has no working text-to-speech voice. Install one in your system settings, or try another voice.'
            : finished
              ? `You’ve listened to all of ${title}.`
              : 'Tap any paragraph to listen from there.'}
        </span>
      </div>
      <div className="listen-options">
        <label>
          <span className="sr-only">Speed</span>
          <select value={settings.rate} onChange={(e) => setSettings({ ...settings, rate: Number(e.target.value) })} aria-label="Reading speed">
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
        {voices.length > 1 && (
          <label className="listen-voice">
            <span className="sr-only">Voice</span>
            <select value={voice?.voiceURI ?? ''} onChange={(e) => setSettings({ ...settings, voiceURI: e.target.value })} aria-label="Voice">
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name.replace(/^(Microsoft|Google)\s+/, '')} ({v.lang})
                </option>
              ))}
            </select>
          </label>
        )}
        <button className={`btn btn-sm ${sleepAt ? 'on' : ''}`} onClick={cycleSleep} title="Sleep timer" aria-label={sleepAt ? `Sleep timer: ${sleepLeft} minutes left` : 'Set a sleep timer'}>
          <Icon name="moonTimer" size={16} /> {sleepAt ? `${sleepLeft}m` : 'Sleep'}
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Close player" title="Close player">
          <Icon name="x" />
        </button>
      </div>
    </div>
  );
}
