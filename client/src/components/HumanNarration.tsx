// Plays a real human narration of the book (a LibriVox recording hosted by the
// Internet Archive), chapter by chapter, remembering where you stopped.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { readStorage, useStoredState, writeStorage } from '../hooks';
import type { Recording } from '../librivox';
import { Icon } from './Icon';
import { RATES, useSleepTimer } from './ReadAloud';

function clock(s: number) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60)
    .toString()
    .padStart(2, '0');
  return h ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

interface Props {
  recording: Recording;
  title: string;
  author: string;
  /** The reader's current part, used to start at the matching chapter. */
  sectionIdx: number | null;
  sectionCount: number;
  autoStart: boolean;
  onClose: () => void;
  onFailed: () => void;
  extra?: ReactNode;
}

export function HumanNarration({ recording, title, author, sectionIdx, sectionCount, autoStart, onClose, onFailed, extra }: Props) {
  const posKey = `lol-audio:${recording.identifier}`;
  const saved = readStorage<{ track: number; time: number } | null>(posKey, null);
  const aligned = recording.tracks.length === sectionCount && sectionIdx != null;
  const [track, setTrack] = useState(() => Math.min(recording.tracks.length - 1, saved?.track ?? (aligned ? sectionIdx! : 0)));
  const [rate, setRate] = useStoredState<number>('lol-audio-rate', 1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(recording.tracks[track]?.seconds ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const resumeAt = useRef<number | null>(saved && saved.track === track ? saved.time : null);
  const wantPlay = useRef(autoStart);
  const current = recording.tracks[track];

  const trackRef = useRef(track);
  trackRef.current = track;
  const lastTime = useRef(0);
  const save = useCallback(() => {
    writeStorage(posKey, { track: trackRef.current, time: audio.current?.currentTime ?? lastTime.current });
  }, [posKey]);

  // Load a chapter whenever the track changes.
  useEffect(() => {
    const a = audio.current;
    if (!a || !current) return;
    setError(false);
    setTime(0);
    setDuration(current.seconds ?? 0);
    a.src = current.url;
    a.playbackRate = rate;
    a.load();
    if (wantPlay.current) {
      setLoading(true);
      a.play().catch(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, current?.url]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate]);

  const play = useCallback(() => {
    wantPlay.current = true;
    setLoading(true);
    audio.current?.play().catch(() => setLoading(false));
  }, []);
  const pause = useCallback(() => {
    wantPlay.current = false;
    audio.current?.pause();
    save();
  }, [save]);
  const seekBy = useCallback((d: number) => {
    const a = audio.current;
    if (a) a.currentTime = Math.max(0, Math.min((a.duration || Infinity) - 1, a.currentTime + d));
  }, []);
  const goTrack = useCallback(
    (i: number) => {
      if (i < 0 || i >= recording.tracks.length) return;
      save();
      resumeAt.current = null;
      setTrack(i);
    },
    [recording.tracks.length, save],
  );

  // Save the listening position every few seconds and when leaving.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(save, 5000);
    return () => clearInterval(t);
  }, [playing, save]);
  useEffect(() => () => save(), [save]);

  const sleepButton = useSleepTimer(pause);

  // Lock-screen and headset controls; a real audio element keeps playing with the screen off.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title: current?.title ?? title, artist: `${author} · read by LibriVox volunteers`, album: title });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', play],
      ['pause', pause],
      ['seekbackward', () => seekBy(-15)],
      ['seekforward', () => seekBy(30)],
      ['previoustrack', () => goTrack(track - 1)],
      ['nexttrack', () => goTrack(track + 1)],
      [
        'seekto',
        (d) => {
          if (audio.current && d.seekTime != null) audio.current.currentTime = d.seekTime;
        },
      ],
    ];
    for (const [a, h] of handlers) {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* unsupported */
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
  }, [play, pause, seekBy, goTrack, track, current?.title, title, author]);

  // Space = play/pause, ←/→ inside the player's focus = seek.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName)) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (playing) pause();
        else play();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, play, pause]);

  const last = track === recording.tracks.length - 1;

  return (
    <div className="listen-bar listen-human" role="region" aria-label="Human narration">
      <audio
        ref={audio}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          setDuration(a.duration);
          if (resumeAt.current != null) {
            a.currentTime = Math.min(resumeAt.current, Math.max(0, a.duration - 2));
            resumeAt.current = null;
          }
        }}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          lastTime.current = e.currentTarget.currentTime;
          if ('mediaSession' in navigator && e.currentTarget.duration) {
            try {
              navigator.mediaSession.setPositionState({ duration: e.currentTarget.duration, position: e.currentTarget.currentTime, playbackRate: e.currentTarget.playbackRate });
            } catch {
              /* ignore */
            }
          }
        }}
        onPlaying={() => {
          setPlaying(true);
          setLoading(false);
        }}
        onWaiting={() => setLoading(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          if (!last) {
            wantPlay.current = true;
            goTrack(track + 1);
          } else {
            setPlaying(false);
            writeStorage(posKey, { track: 0, time: 0 });
          }
        }}
        onError={() => {
          if (!audio.current?.src) return;
          setError(true);
          setLoading(false);
          setPlaying(false);
        }}
      />
      <div className="listen-top">
      <div className="listen-main">
        <button className="icon-btn" onClick={() => seekBy(-15)} aria-label="Back 15 seconds" title="Back 15 seconds">
          <span className="seek-label">−15</span>
        </button>
        <button className="listen-play" onClick={playing ? pause : play} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (space)' : 'Play (space)'}>
          {loading && !error ? <span className="spinner spinner-light" /> : <Icon name={playing ? 'pause' : 'play'} size={24} />}
        </button>
        <button className="icon-btn" onClick={() => seekBy(30)} aria-label="Forward 30 seconds" title="Forward 30 seconds">
          <span className="seek-label">+30</span>
        </button>
      </div>
      <div className="listen-status">
        {error ? (
          <>
            <strong>Recording couldn’t load</strong>
            <span>
              Check your connection, or{' '}
              <button className="link-btn" onClick={onFailed}>
                use the device voice
              </button>
              .
            </span>
          </>
        ) : (
          <>
            <label className="listen-chapter">
              <span className="sr-only">Chapter</span>
              <select value={track} onChange={(e) => goTrack(Number(e.target.value))} aria-label="Chapter">
                {recording.tracks.map((t, i) => (
                  <option key={t.url} value={i}>
                    {i + 1}. {t.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="listen-seek">
              <span>{clock(time)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={1}
                value={Math.min(time, duration || 0)}
                onChange={(e) => {
                  if (audio.current) audio.current.currentTime = Number(e.target.value);
                }}
                aria-label="Position in chapter"
              />
              <span>{clock(duration)}</span>
            </div>
          </>
        )}
      </div>
      </div>
      <div className="listen-options">
        {extra}
        <select value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Playback speed">
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        {sleepButton}
      </div>
      <button className="icon-btn listen-close" onClick={onClose} aria-label="Close player" title="Close player">
        <Icon name="x" />
      </button>
      <p className="listen-credit">
        Human narration by LibriVox volunteers ·{' '}
        <a href={recording.page} target="_blank" rel="noreferrer">
          public-domain recording ↗
        </a>
      </p>
    </div>
  );
}
