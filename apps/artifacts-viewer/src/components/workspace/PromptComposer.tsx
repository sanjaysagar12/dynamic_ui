'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Sparkles, Mic, Square, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils/cn';
import { transcribeAudio, SpeechTranscribeError } from '../../lib/api/speech-client';

export interface PromptComposerProps {
  disabled?: boolean;
  onSend: (message: string) => void;
  placeholder?: string;
  leadingAction?: React.ReactNode;
  surface?: 'light' | 'dark';
  /** Needed to authenticate the voice-transcription request; the mic button is hidden without it. */
  token?: string;
}

// Preference order: opus-in-webm/ogg first (best quality/size, what Chromium/Firefox produce),
// falling back toward what Safari's MediaRecorder actually supports. All are accepted by Gemini's
// inline-audio input (ai.google.dev/gemini-api/docs/audio).
const AUDIO_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];

function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return AUDIO_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

type MicState = 'idle' | 'recording' | 'transcribing';

export function PromptComposer({
  disabled,
  onSend,
  placeholder = 'Ask me to build a page or query your data…',
  leadingAction,
  surface = 'light',
  token,
}: PromptComposerProps) {
  const [value, setValue] = useState('');
  const [micState, setMicState] = useState<MicState>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const micSupported =
    typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (ref.current) ref.current.style.height = 'auto';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const autoGrow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    setMicError(null);
    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      setMicError('This browser cannot record audio');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMicError('Microphone access was denied — allow it in your browser to use voice input');
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stopStream();
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (blob.size === 0 || !token) {
        setMicState('idle');
        return;
      }

      setMicState('transcribing');
      try {
        const transcript = await transcribeAudio(blob, token);
        setValue((current) => (current ? `${current} ${transcript}` : transcript));
        requestAnimationFrame(() => {
          ref.current?.focus();
          autoGrow();
        });
      } catch (err) {
        setMicError(err instanceof SpeechTranscribeError ? err.message : 'Transcription failed — please try again');
      } finally {
        setMicState('idle');
      }
    };

    recorderRef.current = recorder;
    recorder.start();
    setMicState('recording');
  };

  const handleMicClick = () => {
    if (micState === 'recording') {
      recorderRef.current?.stop();
      recorderRef.current = null;
    } else if (micState === 'idle') {
      void startRecording();
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'rounded-xl flex items-end gap-2 p-3',
          surface === 'dark' ? 'bg-white/5 border border-white/10' : 'bg-surface-raised border border-subtle',
        )}
      >
        {leadingAction}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            autoGrow();
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={placeholder}
          className={cn(
            'flex-1 resize-none bg-transparent outline-none text-[14px] py-2 max-h-[140px] disabled:opacity-60',
            surface === 'dark'
              ? 'text-[var(--panel-dark-text-primary)] placeholder:text-[var(--panel-dark-text-secondary)]'
              : 'text-primary placeholder:text-tertiary',
          )}
        />
        {micSupported && token && (
          <button
            type="button"
            onClick={handleMicClick}
            disabled={disabled || micState === 'transcribing'}
            aria-label={micState === 'recording' ? 'Stop recording' : 'Record voice message'}
            title={micState === 'recording' ? 'Stop recording' : 'Record voice message'}
            className={cn(
              'h-9 w-9 shrink-0 rounded-full flex items-center justify-center border transition-colors disabled:opacity-40 disabled:pointer-events-none',
              micState === 'recording'
                ? 'bg-negative/10 border-negative/40 text-negative animate-pulse'
                : surface === 'dark'
                  ? 'border-white/10 text-[var(--panel-dark-text-secondary)] hover:text-[var(--panel-dark-text-primary)] hover:bg-white/5'
                  : 'border-subtle text-secondary hover:text-primary hover:bg-surface-hover',
            )}
          >
            {micState === 'transcribing' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : micState === 'recording' ? (
              <Square className="h-3.5 w-3.5 fill-current" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          aria-label="Send"
          className="h-9 w-9 shrink-0 rounded-full bg-accent-500 text-on-accent flex items-center justify-center hover:bg-accent-600 disabled:opacity-40 disabled:pointer-events-none"
        >
          {disabled ? <Sparkles className="h-4 w-4 animate-pulse" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
      {micError && <p className="text-negative text-[12px] px-1">{micError}</p>}
    </div>
  );
}
