'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSessionStore } from '@/lib/store';
import { GeminiLiveClient, ConnectionState } from '@/lib/gemini-live';
import Lightbar from './Lightbar';
import AudioPanner from './AudioPanner';
import VoiceIndicator from './VoiceIndicator';
import EmergencyOverlay from './EmergencyOverlay';
import { getPromptForState } from '@/lib/prompts';

interface SessionProps {
  client: GeminiLiveClient;
}

const PHASE_LABELS: Record<string, string> = {
  INTAKE: 'Intake',
  DESENSITIZATION: 'Desensitization',
  PIVOT: 'Pivot',
  RECONNECTION: 'Reconnection',
  INTEGRATION: 'Integration',
  COMPLETED: 'Completed',
  EMERGENCY_GROUNDING: 'Emergency',
};

const COLOR_FREQ: Record<string, number> = {
  white: 440,
  amber: 330,
  emerald: 220,
  blue: 220,
};

export default function Session({ client }: SessionProps) {
  const {
    phase,
    bls,
    isMicMuted,
    isEmergency,
    setPhase,
    addTranscript,
  } = useSessionStore();

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const prevBlsRunningRef = useRef(false);
  const unmuteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mic muting sync — CRITICAL: mic MUST mute during BLS
  useEffect(() => {
    if (isMicMuted) {
      client.muteMic();
    }
  }, [isMicMuted, client]);

  // Detect BLS stop → delay unmute by 500ms to match AudioPanner fade-out
  useEffect(() => {
    const wasRunning = prevBlsRunningRef.current;
    prevBlsRunningRef.current = bls.isRunning;

    if (wasRunning && !bls.isRunning) {
      if (unmuteTimerRef.current) {
        clearTimeout(unmuteTimerRef.current);
      }
      unmuteTimerRef.current = setTimeout(() => {
        useSessionStore.getState().setMicMuted(false);
        client.unmuteMic();
      }, 500);
    }

    return () => {
      if (unmuteTimerRef.current) {
        clearTimeout(unmuteTimerRef.current);
      }
    };
  }, [bls.isRunning, client]);

  // Setup client event handlers
  useEffect(() => {
    client.onStateChange = (state) => {
      setConnectionState(state);
    };

    client.onTranscript = (text, speaker) => {
      addTranscript({ speaker, text });
      if (speaker === 'ai') {
        setIsAiSpeaking(false);
      }
    };

    client.onToolCall = (name, args) => {
      if (name === 'transition_state' && args.newState) {
        const newState = args.newState as string;
        setPhase(newState as Parameters<typeof setPhase>[0]);
        client.setInstructions(
          getPromptForState(
            newState as Parameters<typeof getPromptForState>[0]
          )
        );
      }
    };

    client.onError = (message) => {
      console.error('[Session] Gemini error:', message);
      setErrorMessage(message);
    };

    return () => {
      client.onStateChange = null;
      client.onTranscript = null;
      client.onToolCall = null;
      client.onError = null;
    };
  }, [client, addTranscript, setPhase]);

  const handleEmergency = useCallback(() => {
    useSessionStore.getState().triggerEmergency();
  }, []);

  const handleEndSession = useCallback(() => {
    client.disconnect();
    useSessionStore.getState().reset();
  }, [client]);

  if (isEmergency) {
    return <EmergencyOverlay client={client} />;
  }

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-4 z-10">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {PHASE_LABELS[phase] || phase}
          </span>
          {bls.isRunning && (
            <span className="text-xs text-amber-400/70">
              {bls.remainingSeconds}s
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <VoiceIndicator
            connectionState={connectionState}
            isAiSpeaking={isAiSpeaking}
            isMicMuted={isMicMuted}
            isBlsActive={bls.isRunning}
          />

          <button
            onClick={handleEmergency}
            className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center hover:bg-red-500/30 transition-colors"
            title="Emergency — Grounding"
          >
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          </button>
        </div>
      </div>

      {/* Center: Lightbar or Status */}
      <div className="flex-1 relative">
        {bls.isRunning && (
          <div className="absolute inset-0">
            <Lightbar
              isRunning={bls.isRunning}
              speedHz={bls.speedHz}
              color={bls.color}
            />
          </div>
        )}

        {!bls.isRunning && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full border border-gray-800 flex items-center justify-center mx-auto mb-4">
                <div
                  className={`w-3 h-3 rounded-full ${
                    connectionState === 'connected'
                      ? 'bg-violet-500 animate-pulse'
                      : connectionState === 'error'
                      ? 'bg-red-500'
                      : 'bg-gray-600'
                  }`}
                />
              </div>
              <p className="text-gray-600 text-sm">
                {connectionState === 'connected'
                  ? 'Session active'
                  : connectionState === 'error'
                  ? 'Connection error'
                  : connectionState === 'disconnected'
                  ? 'Disconnected'
                  : 'Connecting...'}
              </p>
              {errorMessage && (
                <p className="text-red-400 text-xs mt-2 max-w-xs mx-auto">{errorMessage}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Bar */}
      <div className="flex items-center justify-between px-6 py-4 z-10">
        <button
          onClick={handleEndSession}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          End Session
        </button>

        <div className="flex items-center gap-2">
          {isMicMuted && (
            <span className="text-xs text-amber-400/60">Mic muted</span>
          )}
        </div>
      </div>

      {/* Audio Panner */}
      {bls.isRunning && (
        <AudioPanner
          isRunning={bls.isRunning}
          speedHz={bls.speedHz}
          frequency={COLOR_FREQ[bls.color] || 440}
        />
      )}
    </div>
  );
}
