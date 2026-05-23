'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { EmetLogo } from '@/components/ui/EmetLogo';
import { BLSVisual } from '@/components/bls/BLSVisual';
import { BLSAudioEngine } from '@/components/bls/BLSAudioEngine';
import { SessionStateIndicator } from '@/components/session/SessionStateIndicator';
import { DistressMeter } from '@/components/session/DistressMeter';
import { EmergencyButton } from '@/components/session/EmergencyButton';
import { TranscriptDisplay } from '@/components/session/TranscriptDisplay';
import type { SessionState } from '@/lib/store/session-store';

interface SessionData {
  id: string;
  currentState: SessionState;
  distressLevel: number | null;
  sessionGoals: string | null;
  startedAt: string;
}

interface TranscriptEntry {
  id: string;
  speaker: 'CLIENT' | 'AI_THERAPIST' | 'SYSTEM';
  content: string;
  timestamp: string;
}

const BLS_CONFIGS: Record<string, { visualPattern: 'horizontal' | 'circular' | 'butterfly' | 'dotfield'; visualSpeed: number; visualIntensity: number; visualColorPrimary: string; visualColorSecondary: string }> = {
  DESENSITIZATION: { visualPattern: 'horizontal', visualSpeed: 80, visualIntensity: 0.8, visualColorPrimary: '#8B5CF6', visualColorSecondary: '#C4B5FD' },
  RECONNECTION: { visualPattern: 'circular', visualSpeed: 40, visualIntensity: 0.5, visualColorPrimary: '#F59E0B', visualColorSecondary: '#FCD34D' },
  INTEGRATION: { visualPattern: 'horizontal', visualSpeed: 25, visualIntensity: 0.3, visualColorPrimary: '#10B981', visualColorSecondary: '#6EE7B7' },
  EMERGENCY_GROUNDING: { visualPattern: 'horizontal', visualSpeed: 20, visualIntensity: 0.25, visualColorPrimary: '#3B82F6', visualColorSecondary: '#93C5FD' },
};

const BLS_AUDIO_CONFIGS: Record<string, { auditoryFrequency: number; auditoryVolume: number; auditoryWaveform: OscillatorType }> = {
  DESENSITIZATION: { auditoryFrequency: 440, auditoryVolume: 0.15, auditoryWaveform: 'sine' },
  RECONNECTION: { auditoryFrequency: 330, auditoryVolume: 0.1, auditoryWaveform: 'sine' },
  INTEGRATION: { auditoryFrequency: 220, auditoryVolume: 0.08, auditoryWaveform: 'sine' },
  EMERGENCY_GROUNDING: { auditoryFrequency: 196, auditoryVolume: 0.06, auditoryWaveform: 'sine' },
};

export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<SessionData | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isEnding, setIsEnding] = useState(false);

  const isBLSActive = ['DESENSITIZATION', 'RECONNECTION', 'INTEGRATION', 'EMERGENCY_GROUNDING'].includes(
    session?.currentState || ''
  );

  const blsConfig = BLS_CONFIGS[session?.currentState || ''] || {
    pattern: 'horizontal' as const,
    speed: 60,
    intensity: 0.5,
    color1: '#8B5CF6',
    color2: '#C4B5FD',
  };

  const blsAudioConfig = BLS_AUDIO_CONFIGS[session?.currentState || ''] || {
    frequency: 440,
    volume: 0.1,
    waveform: 'sine' as OscillatorType,
  };

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) throw new Error('Session not found');
      const data = await res.json();
      setSession(data);
      if (data.transcripts) {
        setTranscripts(data.transcripts.map((t: Record<string, unknown>) => ({
          id: t.id as string,
          speaker: t.speaker as 'CLIENT' | 'AI_THERAPIST' | 'SYSTEM',
          content: t.content as string,
          timestamp: t.timestamp as string,
        })));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSession();
    const interval = setInterval(fetchSession, 10000);
    return () => clearInterval(interval);
  }, [fetchSession]);

  const updateState = async (newState: SessionState) => {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentState: newState }),
      });
      setSession((prev) => prev ? { ...prev, currentState: newState } : prev);
    } catch (err) {
      console.error('State update error:', err);
    }
  };

  const updateDistress = async (level: number) => {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ distressLevel: level }),
      });
      setSession((prev) => prev ? { ...prev, distressLevel: level } : prev);
    } catch (err) {
      console.error('Distress update error:', err);
    }
  };

  const handleEmergency = async () => {
    await updateState('EMERGENCY_GROUNDING');
  };

  const handleEndSession = async () => {
    if (!confirm('Are you sure you want to end this session?')) return;
    setIsEnding(true);
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentState: 'COMPLETED' }),
      });
      router.push('/dashboard');
    } catch {
      setIsEnding(false);
    }
  };

  const handleSendMessage = async (message: string) => {
    // Add user message to transcript
    const userEntry: TranscriptEntry = {
      id: crypto.randomUUID(),
      speaker: 'CLIENT',
      content: message,
      timestamp: new Date().toISOString(),
    };
    setTranscripts((prev) => [...prev, userEntry]);

    try {
      const res = await fetch('/api/therapy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message }),
      });

      if (!res.ok) throw new Error('Failed to get response');

      const data = await res.json();
      const aiEntry: TranscriptEntry = {
        id: crypto.randomUUID(),
        speaker: 'AI_THERAPIST',
        content: data.response,
        timestamp: new Date().toISOString(),
      };
      setTranscripts((prev) => [...prev, aiEntry]);

      // Speak the response
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(data.response);
        utterance.rate = 0.85;
        utterance.pitch = 0.95;
        window.speechSynthesis.speak(utterance);
      }
    } catch (err) {
      console.error('Chat error:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
          <p className="text-slate-400 text-sm">Loading session...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <Link href="/dashboard" className="btn-primary">Return to Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Header */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-20">
        <Link href="/dashboard">
          <EmetLogo size="sm" showText={false} />
        </Link>

        <div className="flex items-center gap-6">
          <SessionStateIndicator state={session?.currentState || 'PRE_FLIGHT'} />
          <div className="w-px h-6 bg-white/10" />
          <DistressMeter
            level={session?.distressLevel || 0}
            onChange={updateDistress}
          />
          <EmergencyButton onActivate={handleEmergency} />
        </div>

        <button
          onClick={handleEndSession}
          disabled={isEnding}
          className="btn-ghost text-sm text-red-400 hover:text-red-300"
        >
          {isEnding ? 'Ending...' : 'End Session'}
        </button>
      </nav>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* BLS Panel */}
        <div className="w-1/2 relative bg-[#020617]">
          <BLSVisual
            isRunning={isBLSActive}
            config={blsConfig}
            className="absolute inset-0"
          />
          <BLSAudioEngine
            isRunning={isBLSActive}
            config={blsAudioConfig}
          />

          {/* Phase overlay */}
          <div className="absolute bottom-6 left-6 right-6">
            <div className="glass-dark rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-2 h-2 rounded-full ${
                  session?.currentState === 'EMERGENCY_GROUNDING' ? 'bg-red-500 animate-pulse' :
                  isBLSActive ? 'bg-violet-500 animate-pulse' : 'bg-slate-500'
                }`} />
                <span className="text-xs text-slate-400 uppercase tracking-wider">
                  {session?.currentState === 'PRE_FLIGHT' ? 'Getting Ready' :
                   session?.currentState === 'INTAKE' ? 'Building Connection' :
                   session?.currentState === 'DESENSITIZATION' ? 'Processing with BLS' :
                   session?.currentState === 'PIVOT' ? 'Transitioning' :
                   session?.currentState === 'RECONNECTION' ? 'Open Reconnection' :
                   session?.currentState === 'INTEGRATION' ? 'Integrating Experience' :
                   session?.currentState === 'EMERGENCY_GROUNDING' ? 'Emergency Grounding Active' :
                   session?.currentState || 'Active'}
                </span>
              </div>
              {session?.sessionGoals && (
                <p className="text-xs text-slate-500">{session.sessionGoals}</p>
              )}
            </div>
          </div>
        </div>

        {/* Chat Panel */}
        <div className="w-1/2 flex flex-col border-l border-white/5">
          {/* Transcript */}
          <div className="flex-1 overflow-y-auto p-6">
            <TranscriptDisplay
              entries={transcripts.map((t) => ({
                ...t,
                timestamp: new Date(t.timestamp),
              }))}
            />
          </div>

          {/* Input area */}
          <div className="border-t border-white/5 p-4">
            <ChatInput onSend={handleSendMessage} disabled={isEnding} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatInput({ onSend, disabled }: { onSend: (msg: string) => void; disabled: boolean }) {
  const [message, setMessage] = useState('');
  const [isListening, setIsListening] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || disabled) return;
    onSend(message.trim());
    setMessage('');
  };

  const toggleVoice = () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognitionAPI = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const recognition = new (SpeechRecognitionAPI as new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      start(): void;
      stop(): void;
      onresult: ((event: {
        resultIndex: number;
        results: { [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } };
      }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
    })();

    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      setMessage((prev) => prev + text);
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognition.start();
    setIsListening(true);
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3">
      <button
        type="button"
        onClick={toggleVoice}
        className={`p-2.5 rounded-xl transition-all ${
          isListening
            ? 'bg-violet-500 text-white animate-pulse'
            : 'bg-white/5 text-slate-400 hover:bg-white/10'
        }`}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>

      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Type your message..."
        disabled={disabled}
        className="flex-1 input-emet"
      />

      <button
        type="submit"
        disabled={!message.trim() || disabled}
        className="p-2.5 rounded-xl bg-violet-600 text-white hover:bg-violet-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      </button>
    </form>
  );
}
