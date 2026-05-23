'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { BLSVisual } from '@/components/bls/BLSVisual';
import { BLSAudioEngine } from '@/components/bls/BLSAudioEngine';
import { EmetLogo } from '@/components/ui/EmetLogo';
import { getSystemPrompt, type TherapyState } from '@/lib/openrouter';

interface SessionData {
  id: string;
  currentState: TherapyState;
  distressLevel: number | null;
  sessionGoals: string | null;
  startedAt: string;
}

interface TranscriptEntry {
  id: string;
  speaker: 'CLIENT' | 'AI_THERAPIST' | 'SYSTEM';
  content: string;
  timestamp: Date;
}

const BLS_CONFIGS: Record<string, { visualPattern: 'horizontal' | 'circular' | 'butterfly' | 'dotfield'; visualSpeed: number; visualIntensity: number; visualColorPrimary: string; visualColorSecondary: string; auditoryFrequency: number; auditoryVolume: number }> = {
  DESENSITIZATION: { visualPattern: 'horizontal', visualSpeed: 80, visualIntensity: 0.8, visualColorPrimary: '#8B5CF6', visualColorSecondary: '#C4B5FD', auditoryFrequency: 440, auditoryVolume: 0.15 },
  RECONNECTION: { visualPattern: 'circular', visualSpeed: 40, visualIntensity: 0.5, visualColorPrimary: '#F59E0B', visualColorSecondary: '#FCD34D', auditoryFrequency: 330, auditoryVolume: 0.1 },
  INTEGRATION: { visualPattern: 'horizontal', visualSpeed: 25, visualIntensity: 0.3, visualColorPrimary: '#10B981', visualColorSecondary: '#6EE7B7', auditoryFrequency: 220, auditoryVolume: 0.08 },
  EMERGENCY_GROUNDING: { visualPattern: 'horizontal', visualSpeed: 20, visualIntensity: 0.25, visualColorPrimary: '#3B82F6', visualColorSecondary: '#93C5FD', auditoryFrequency: 196, auditoryVolume: 0.06 },
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

  // Voice state
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [micPermission, setMicPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [voiceSupported, setVoiceSupported] = useState(false);

  // BLS state
  const [blsActive, setBlsActive] = useState(false);
  const [showBLS, setShowBLS] = useState(true);

  // Text input fallback
  const [textInput, setTextInput] = useState('');

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const aiResponseCountRef = useRef(0);

  // Fetch session data
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
          timestamp: new Date(t.timestamp as string),
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
    const interval = setInterval(fetchSession, 15000);
    return () => clearInterval(interval);
  }, [fetchSession]);

  // Check voice support
  useEffect(() => {
    const SpeechRecognitionAPI = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    setVoiceSupported(!!SpeechRecognitionAPI);
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'microphone' as PermissionName }).then((result) => {
        setMicPermission(result.state === 'granted' ? 'granted' : result.state === 'denied' ? 'denied' : 'prompt');
      }).catch(() => {});
    }
  }, []);

  // Auto-start voice session when ready
  useEffect(() => {
    if (session && voiceSupported && micPermission === 'granted' && !isListening && !isSpeaking && !isProcessing) {
      // Small delay to let UI render
      const timer = setTimeout(() => {
        startVoiceSession();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [session, voiceSupported, micPermission]);

  // Update BLS based on state
  useEffect(() => {
    if (!session) return;
    const shouldBeActive = ['DESENSITIZATION', 'RECONNECTION', 'INTEGRATION', 'EMERGENCY_GROUNDING'].includes(session.currentState);
    setBlsActive(shouldBeActive);
  }, [session?.currentState]);

  // Speak AI response using TTS
  const speakResponse = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.85;
    utterance.pitch = 0.95;
    utterance.volume = 1;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      // Auto-listen after speaking
      setTimeout(() => startListening(), 500);
    };
    utterance.onerror = () => setIsSpeaking(false);
    synthRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

  // Start listening with Whisper (via browser SpeechRecognition)
  const startListening = useCallback(() => {
    const SpeechRecognitionAPI = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI || isListening || isSpeaking || isProcessing) return;

    const recognition = new (SpeechRecognitionAPI as new () => SpeechRecognition)();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';
      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      setInterimText(interim);
      if (final) {
        handleUserInput(final);
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      setInterimText('');
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText('');
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setInterimText('');
  }, [isListening, isSpeaking, isProcessing]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimText('');
  }, []);

  // Handle user input (from voice or text)
  const handleUserInput = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing || !session) return;

    setIsProcessing(true);
    stopListening();
    window.speechSynthesis.cancel();
    setIsSpeaking(false);

    const userEntry: TranscriptEntry = {
      id: crypto.randomUUID(),
      speaker: 'CLIENT',
      content: text.trim(),
      timestamp: new Date(),
    };
    setTranscripts(prev => [...prev, userEntry]);

    try {
      const res = await fetch('/api/therapy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: text.trim(),
          sessionState: session.currentState,
          distressLevel: session.distressLevel || 0,
          sessionGoals: session.sessionGoals,
          transcriptHistory: [...transcripts, userEntry].slice(-20).map(t => ({
            speaker: t.speaker,
            content: t.content,
          })),
        }),
      });

      if (!res.ok) throw new Error('Failed to get response');

      const data = await res.json();

      const aiEntry: TranscriptEntry = {
        id: crypto.randomUUID(),
        speaker: 'AI_THERAPIST',
        content: data.response,
        timestamp: new Date(),
      };
      setTranscripts(prev => [...prev, aiEntry]);

      // Update session state if AI triggered a transition
      if (data.newState && data.newState !== session.currentState) {
        await updateSessionState(data.newState);
      }

      // Update distress level if AI detected change
      if (data.distressLevel !== undefined && data.distressLevel !== session.distressLevel) {
        await updateDistressLevel(data.distressLevel);
      }

      // Speak the response
      speakResponse(data.response);
      aiResponseCountRef.current += 1;

    } catch (err) {
      console.error('Chat error:', err);
      const errorEntry: TranscriptEntry = {
        id: crypto.randomUUID(),
        speaker: 'SYSTEM',
        content: 'I apologize, I am having a moment of difficulty. Please take a breath and try again.',
        timestamp: new Date(),
      };
      setTranscripts(prev => [...prev, errorEntry]);
      speakResponse(errorEntry.content);
    } finally {
      setIsProcessing(false);
    }
  }, [session, transcripts, sessionId, isProcessing, stopListening, speakResponse]);

  const updateSessionState = async (newState: TherapyState) => {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentState: newState }),
      });
      setSession(prev => prev ? { ...prev, currentState: newState } : prev);
    } catch (err) {
      console.error('State update error:', err);
    }
  };

  const updateDistressLevel = async (level: number) => {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ distressLevel: level }),
      });
      setSession(prev => prev ? { ...prev, distressLevel: level } : prev);
    } catch (err) {
      console.error('Distress update error:', err);
    }
  };

  const handleEmergency = async () => {
    await updateSessionState('EMERGENCY_GROUNDING');
    const entry: TranscriptEntry = {
      id: crypto.randomUUID(),
      speaker: 'SYSTEM',
      content: 'Emergency grounding activated. I am right here. You are safe. Look around your room and name 5 things you can see out loud. Feel your feet on the floor.',
      timestamp: new Date(),
    };
    setTranscripts(prev => [...prev, entry]);
    speakResponse(entry.content);
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

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      handleUserInput(textInput);
      setTextInput('');
    }
  };

  const requestMicPermission = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermission('granted');
      startVoiceSession();
    } catch {
      setMicPermission('denied');
    }
  };

  const startVoiceSession = () => {
    if (micPermission !== 'granted') {
      requestMicPermission();
      return;
    }
    startListening();
  };

  const blsConfig = BLS_CONFIGS[session?.currentState || ''] || {
    visualPattern: 'horizontal' as const, visualSpeed: 60, visualIntensity: 0.5,
    visualColorPrimary: '#8B5CF6', visualColorSecondary: '#C4B5FD',
    auditoryFrequency: 440, auditoryVolume: 0.1,
  };

  const phaseLabels: Record<string, string> = {
    PRE_FLIGHT: 'Getting Ready',
    INTAKE: 'Building Connection',
    DESENSITIZATION: 'Processing with BLS',
    PIVOT: 'Transitioning',
    RECONNECTION: 'Open Reconnection',
    INTEGRATION: 'Integrating Experience',
    EMERGENCY_GROUNDING: 'Emergency Grounding Active',
    COMPLETED: 'Session Complete',
    ABANDONED: 'Session Ended',
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
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${blsActive ? 'bg-violet-500 animate-pulse' : 'bg-slate-500'}`} />
            <span className="text-xs text-slate-400 uppercase tracking-wider">
              {phaseLabels[session?.currentState || 'PRE_FLIGHT']}
            </span>
          </div>
          <button onClick={handleEmergency} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20">
            Emergency
          </button>
          <button onClick={handleEndSession} disabled={isEnding} className="btn-ghost text-sm text-red-400 hover:text-red-300">
            {isEnding ? 'Ending...' : 'End Session'}
          </button>
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* BLS Panel */}
        {showBLS && (
          <div className="w-1/2 relative bg-[#020617]">
            <BLSVisual isRunning={blsActive} config={blsConfig} className="absolute inset-0" />
            <BLSAudioEngine isRunning={blsActive} config={{
              auditoryFrequency: blsConfig.auditoryFrequency,
              auditoryVolume: blsConfig.auditoryVolume,
              auditoryWaveform: 'sine',
            }} />

            {/* Phase overlay */}
            <div className="absolute bottom-6 left-6 right-6">
              <div className="glass-dark rounded-xl p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-2 h-2 rounded-full ${
                    isSpeaking ? 'bg-violet-500 animate-pulse' :
                    isListening ? 'bg-emerald-500 animate-pulse' :
                    isProcessing ? 'bg-amber-500 animate-pulse' :
                    blsActive ? 'bg-violet-500 animate-pulse' : 'bg-slate-500'
                  }`} />
                  <span className="text-xs text-slate-400 uppercase tracking-wider">
                    {isSpeaking ? 'Emet is speaking...' :
                     isListening ? 'Listening...' :
                     isProcessing ? 'Processing...' :
                     blsActive ? 'BLS Active' : 'Ready'}
                  </span>
                </div>
                {session?.sessionGoals && (
                  <p className="text-xs text-slate-500">{session.sessionGoals}</p>
                )}
              </div>
            </div>

            {/* Toggle BLS visibility */}
            <button
              onClick={() => setShowBLS(false)}
              className="absolute top-4 right-4 p-2 rounded-lg bg-white/5 text-slate-400 hover:bg-white/10"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
              </svg>
            </button>
          </div>
        )}

        {/* Chat / Voice Panel */}
        <div className={`${showBLS ? 'w-1/2' : 'w-full'} flex flex-col border-l border-white/5`}>
          {/* Transcript */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {transcripts.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 rounded-full bg-violet-500/10 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-white mb-2">Voice Session</h3>
                <p className="text-sm text-slate-400 max-w-sm">
                  {voiceSupported
                    ? 'The session will begin automatically. Speak naturally — Emet will guide you through the IADC process.'
                    : 'Voice recognition is not supported in this browser. Use the text input below to communicate.'}
                </p>
                {micPermission === 'denied' && (
                  <p className="text-xs text-red-400 mt-2">Microphone access denied. Please allow microphone access and refresh.</p>
                )}
              </div>
            )}

            {transcripts.map((entry) => (
              <div key={entry.id} className={`flex flex-col ${entry.speaker === 'CLIENT' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  entry.speaker === 'CLIENT' ? 'bg-violet-600/20 text-violet-100 rounded-br-md' :
                  entry.speaker === 'SYSTEM' ? 'bg-white/5 text-slate-400 text-xs italic' :
                  'bg-white/10 text-slate-200 rounded-bl-md'
                }`}>
                  {entry.content}
                </div>
                <span className="text-[10px] text-slate-600 mt-1 px-2">
                  {entry.speaker === 'CLIENT' ? 'You' : entry.speaker === 'AI_THERAPIST' ? 'Emet' : 'System'} · {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}

            {/* Interim text */}
            {interimText && (
              <div className="flex flex-col items-end">
                <div className="max-w-[80%] px-4 py-3 rounded-2xl bg-violet-600/10 text-violet-300/60 text-sm rounded-br-md italic">
                  {interimText}
                </div>
              </div>
            )}
          </div>

          {/* Voice Controls */}
          <div className="border-t border-white/5 p-4">
            {/* Status bar */}
            <div className="flex items-center justify-center gap-4 mb-4">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  isSpeaking ? 'bg-violet-500 animate-pulse' :
                  isListening ? 'bg-emerald-500 animate-pulse' :
                  isProcessing ? 'bg-amber-500 animate-pulse' :
                  'bg-slate-500'
                }`} />
                <span className="text-xs text-slate-400">
                  {isSpeaking ? 'Emet is speaking...' :
                   isListening ? 'Listening...' :
                   isProcessing ? 'Processing...' :
                   'Ready'}
                </span>
              </div>
            </div>

            {/* Mic button */}
            {voiceSupported && (
              <div className="flex justify-center mb-4">
                <button
                  onClick={isListening ? stopListening : startVoiceSession}
                  disabled={isProcessing || isSpeaking}
                  className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all ${
                    isListening
                      ? 'bg-gradient-to-br from-violet-600 to-fuchsia-600 shadow-lg shadow-violet-500/30 scale-110'
                      : 'bg-white/5 border border-white/10 hover:bg-white/10 hover:border-violet-500/30'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isListening && <div className="absolute inset-0 rounded-full bg-violet-500/20 animate-ping" />}
                  <svg className={`w-7 h-7 ${isListening ? 'text-white' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  </svg>
                </button>
              </div>
            )}

            {/* Text input fallback */}
            <form onSubmit={handleTextSubmit} className="flex items-center gap-3">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={voiceSupported ? 'Or type your message...' : 'Type your message...'}
                disabled={isProcessing || isSpeaking}
                className="flex-1 input-emet"
              />
              <button
                type="submit"
                disabled={!textInput.trim() || isProcessing || isSpeaking}
                className="p-2.5 rounded-xl bg-violet-600 text-white hover:bg-violet-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </form>

            {/* Show BLS button if hidden */}
            {!showBLS && (
              <button
                onClick={() => setShowBLS(true)}
                className="mt-3 w-full py-2 rounded-lg bg-white/5 text-slate-400 text-xs hover:bg-white/10"
              >
                Show BLS Visual
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
