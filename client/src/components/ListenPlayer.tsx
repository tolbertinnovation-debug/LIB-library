// Chooses how to read a book aloud: a real human narrator when a LibriVox
// recording exists, otherwise the most natural voice on the device.
import { useEffect, useState } from 'react';
import { useStoredState } from '../hooks';
import { findRecording, type Recording } from '../librivox';
import { HumanNarration } from './HumanNarration';
import { Icon } from './Icon';
import { ReadAloudBar, canSpeak, type ListenProps } from './ReadAloud';

type Mode = 'human' | 'device';

export function ListenPlayer(props: ListenProps & { sectionIdx: number | null; sectionCount: number }) {
  const [recording, setRecording] = useState<Recording | null | undefined>(undefined);
  const [preferred, setPreferred] = useStoredState<Mode>('lol-listen-mode', 'human');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRecording(undefined);
    findRecording(props.title, props.author)
      .then((r) => !cancelled && setRecording(r))
      .catch(() => !cancelled && setRecording(null));
    return () => {
      cancelled = true;
    };
  }, [props.title, props.author]);

  if (recording === undefined) {
    return (
      <div className="listen-bar" role="status">
        <span className="spinner" />
        <div className="listen-status">
          <strong>Looking for a human narrator…</strong>
          <span>Checking the LibriVox library of volunteer recordings.</span>
        </div>
        {canSpeak && (
          <button className="btn btn-sm" onClick={() => setRecording(null)}>
            Use device voice
          </button>
        )}
        <button className="icon-btn" onClick={props.onClose} aria-label="Close player">
          <Icon name="x" />
        </button>
      </div>
    );
  }

  const mode: Mode = recording && !failed && (preferred === 'human' || !canSpeak) ? 'human' : 'device';
  const switcher =
    recording && canSpeak ? (
      <div className="segmented segmented-sm" role="group" aria-label="Narrator">
        <button aria-pressed={mode === 'human'} onClick={() => { setFailed(false); setPreferred('human'); }} title="Real human narrator (LibriVox)">
          <Icon name="user" size={14} /> Human
        </button>
        <button aria-pressed={mode === 'device'} onClick={() => setPreferred('device')} title="Device voice — follows the text on screen">
          <Icon name="type" size={14} /> Follow text
        </button>
      </div>
    ) : null;

  if (mode === 'human' && recording) {
    return (
      <HumanNarration
        recording={recording}
        title={props.title}
        author={props.author}
        sectionIdx={props.sectionIdx}
        sectionCount={props.sectionCount}
        autoStart={props.autoStart}
        onClose={props.onClose}
        onFailed={() => setFailed(true)}
        extra={switcher}
      />
    );
  }
  return <ReadAloudBar {...props} extra={switcher} />;
}
