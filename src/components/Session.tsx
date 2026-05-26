'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '@/lib/store';
import { GeminiClient } from '@/lib/gemini-client';
import { createAudioCapture } from '@/lib/audio-utils';
import { initEyeTracker, processEyeFrame } from '@/lib/eye-tracking';
import Lightbar from './Lightbar';
import AudioPanner from './AudioPanner';
import VoiceIndicator from './VoiceIndicator';
import EmergencyOverlay from './EmergencyOverlay';
import EyeTracker from './EyeTracker';

export default function Session() {
  const store = useSessionStore();
  const clientRef = useRef<GeminiClient | null>(null);
  const captureRef = useRef<ReturnType<typeof createAudioCapture> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const eyeTrackerInitialized = useRef(false);

  // Emergency handler
  const handleEmergency = useCallback(() => {
    useSessionStore.getState().triggerEmergency();
  }, []);

  // Initialize session on mount
  useEffect(() => {
    const client = new GeminiClient();
    clientRef.current = client;

    // Set up callbacks
    client.onStateChange = (state) => {
      store.setConnectionState(state);
      console.log('[Session] State:', state);
    };

    client.onTranscript = (text, speaker) => {
      store.addTranscript({ speaker, text });
    };

    client.onError = (msg) => {
      console.error('[Session] Error:', msg);
    };

    // Start audio capture
    const capture = createAudioCapture((base64) => {
      client.sendAudioChunk(base64);
    });
    captureRef.current = capture;
    capture.start();

    // Connect to Gemini
    client.connect();

    // Init eye tracking if enabled
    if (store.eyeTracking.enabled && !eyeTrackerInitialized.current) {
      eyeTrackerInitialized.current = true;
      initEyeTracker().then(() => {
        console.log('[Session] Eye tracker ready');
      });
    }

    return () => {
      client.disconnect();
      capture.stop();
    };
  }, []);

  // Mic mute sync
  useEffect(() => {
    if (store.isMicMuted) {
      clientRef.current?.muteMic();
    } else {
      clientRef.current?.unmuteMic();
    }
  }, [store.isMicMuted]);

  // Eye tracking frame loop
  useEffect(() => {
    if (!store.eyeTracking.enabled || !videoRef.current) return;

    let animId: number;
    const loop = () => {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        processEyeFrame(videoRef.current);
      }
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animId);
  }, [store.eyeTracking.enabled]);

  // Emergency state
  if (store.isEmergency) {
    return <EmergencyOverlay />;
  }

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Phase label */}
      <div className="absolute top-4 left-4 text-sm text-white/50 font-mono z-20">
        {store.phase.replace(/_/g, ' ')}
      </div>

      {/* Top right controls */}
      <div className="absolute top-4 right-4 flex items-center gap-4 z-20">
        <VoiceIndicator />
        <button
          onClick={handleEmergency}
          className="w-10 h-10 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center text-white font-bold"
          title="Emergency — Grounding"
        >
          !
        </button>
      </div>

      {/* Hidden video for eye tracking */}
      {store.eyeTracking.enabled && <EyeTracker ref={videoRef} />}

      {/* BLS Layer */}
      {store.bls.isRunning && (
        <>
          <Lightbar />
          <AudioPanner />
        </>
      )}

      {/* Center indicator when BLS is not running */}
      <div className="flex items-center justify-center h-screen">
        {!store.bls.isRunning && (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full border border-gray-800 flex items-center justify-center mx-auto mb-4">
              <div
                className={`w-3 h-3 rounded-full ${
                  store.connectionState === 'streaming' || store.connectionState === 'ready'
                    ? 'bg-violet-500 animate-pulse'
                    : store.connectionState === 'error'
                    ? 'bg-red-500'
                    : 'bg-gray-600'
                }`}
              />
            </div>
            <p className="text-gray-600 text-sm">
              {store.connectionState === 'streaming' || store.connectionState === 'ready'
                ? 'Session active'
                : store.connectionState === 'error'
                ? 'Connection error'
                : store.connectionState === 'disconnected'
                ? 'Disconnected'
                : 'Connecting...'}
            </p>
          </div>
        )}
      </div>

      {/* Bottom status bar */}
      <div className="absolute bottom-4 left-4 right-4 flex justify-between text-white/30 text-sm z-20">
        <span>
          {store.connectionState === 'streaming' || store.connectionState === 'ready'
            ? 'Session active'
            : store.connectionState}
        </span>
        {store.eyeTracking.enabled && (
          <span
            className={
              store.eyeTracking.state === 'TRACKING'
                ? 'text-emerald-400'
                : store.eyeTracking.state === 'FROZEN'
                ? 'text-amber-400'
                : store.eyeTracking.state === 'ERRATIC'
                ? 'text-red-400'
                : ''
            }
          >
            Eye: {store.eyeTracking.state}
          </span>
        )}
        {store.isMicMuted && <span className="text-amber-400/60">Mic muted</span>}
      </div>
    </div>
  );
}
