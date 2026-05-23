'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { EmetLogo } from '../ui/EmetLogo';

interface VoiceControlsProps {
  sessionId: string;
  onTranscript: (text: string, speaker: 'CLIENT' | 'AI_THERAPIST') => void;
  onAIResponse: (text: string) => void;
  isMuted: boolean;
  onMuteChange: (muted: boolean) => void;
  disabled?: boolean;
}

export function VoiceControls({
  sessionId,
  onTranscript,
  onAIResponse,
  isMuted,
  onMuteChange,
  disabled = false,
}: VoiceControlsProps) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'listening' | 'processing' | 'speaking'>('idle');
  const recognitionRef = useRef<{
    stop: () => void;
    start: () => void;
  } | null>(null);
  const audioLevelRef = useRef(0);
  const animFrameRef = useRef(0);

  const startListening = useCallback(() => {
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
        results: {
          length: number;
          [i: number]: { isFinal: boolean; [j: number]: { transcript: string } };
        };
      }) => void) | null;
      onerror: ((event: { error: string }) => void) | null;
      onend: (() => void) | null;
    })();

    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      setInterimText(interim);
      if (final) {
        onTranscript(final, 'CLIENT');
        setInterimText('');
        processUserInput(final);
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      setConnectionStatus('idle');
    };

    recognition.onend = () => {
      if (isListening) {
        try { recognition.start(); } catch { /* already started */ }
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
    setConnectionStatus('listening');
  }, [onTranscript]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimText('');
    setConnectionStatus('idle');
  }, []);

  const processUserInput = useCallback(async (text: string) => {
    setIsProcessing(true);
    setConnectionStatus('processing');

    try {
      const response = await fetch('/api/therapy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text }),
      });

      if (!response.ok) throw new Error('Failed to get response');

      const data = await response.json();
      onTranscript(data.response, 'AI_THERAPIST');
      onAIResponse(data.response);

      // Speak the response
      if ('speechSynthesis' in window) {
        setConnectionStatus('speaking');
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(data.response);
        utterance.rate = 0.85;
        utterance.pitch = 0.95;
        utterance.onend = () => {
          setConnectionStatus('listening');
          // Auto-restart listening
          if (isListening) {
            startListening();
          }
        };
        window.speechSynthesis.speak(utterance);
      }
    } catch (error) {
      console.error('Processing error:', error);
      setConnectionStatus('idle');
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, onTranscript, onAIResponse, isListening, startListening]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Audio level animation
  useEffect(() => {
    const animate = () => {
      audioLevelRef.current = isListening ? 0.5 + Math.random() * 0.5 : 0;
      animFrameRef.current = requestAnimationFrame(animate);
    };
    if (isListening) animate();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isListening]);

  // Cleanup
  useEffect(() => {
    return () => {
      stopListening();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, [stopListening]);

  const statusColors = {
    idle: 'bg-slate-500',
    listening: 'bg-emerald-500',
    processing: 'bg-amber-500',
    speaking: 'bg-violet-500',
  };

  const statusLabels = {
    idle: 'Ready',
    listening: 'Listening...',
    processing: 'Processing...',
    speaking: 'Speaking...',
  };

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Status indicator */}
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full ${statusColors[connectionStatus]} ${isListening ? 'animate-pulse' : ''}`} />
        <span className="text-sm text-slate-400 font-medium">{statusLabels[connectionStatus]}</span>
      </div>

      {/* Main mic button */}
      <button
        onClick={toggleListening}
        disabled={disabled || isProcessing}
        className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 ${
          isListening
            ? 'bg-gradient-to-br from-violet-600 to-fuchsia-600 shadow-lg shadow-violet-500/30 scale-110'
            : 'bg-white/5 border border-white/10 hover:bg-white/10 hover:border-violet-500/30'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {/* Pulse rings when listening */}
        {isListening && (
          <>
            <div className="absolute inset-0 rounded-full bg-violet-500/20 animate-ping" />
            <div className="absolute -inset-2 rounded-full border border-violet-500/30 animate-pulse" />
          </>
        )}

        <svg
          className={`w-10 h-10 transition-colors ${isListening ? 'text-white' : 'text-slate-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>

      {/* Interim text */}
      {interimText && (
        <div className="text-sm text-slate-400 italic text-center max-w-md">
          &ldquo;{interimText}&rdquo;
        </div>
      )}

      {/* Mute toggle */}
      <button
        onClick={() => onMuteChange(!isMuted)}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all ${
          isMuted
            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
            : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
        }`}
      >
        {isMuted ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        )}
        {isMuted ? 'Unmute' : 'Mute'}
      </button>
    </div>
  );
}
