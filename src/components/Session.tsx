'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '@/lib/store';
import { GeminiClient } from '@/lib/gemini-client';
import { initEyeTracker, processEyeFrame } from '@/lib/eye-tracking';
import Lightbar from './Lightbar';
import AudioPanner from './AudioPanner';
import VoiceIndicator from './VoiceIndicator';
import EmergencyOverlay from './EmergencyOverlay';

export default function Session() {
  const store = useSessionStore();
  const clientRef = useRef<GeminiClient | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const eyeTrackingActive = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Emergency handler ──────────────────────────────────────────────────
  const handleEmergency = useCallback(() => {
    useSessionStore.getState().triggerEmergency();
  }, []);

  // ── Eye tracking: starts IMMEDIATELY on mount, runs continuously ───────
  useEffect(() => {
    if (!store.eyeTracking.enabled || eyeTrackingActive.current) return;
    eyeTrackingActive.current = true;

    let cancelled = false;
    let animId: number;

    async function startEyeTracking() {
      try {
        await initEyeTracker();
        if (cancelled) return;
        console.log('[Session] Eye tracker initialized');

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          if (cancelled) return;
          console.log('[Session] Eye tracking video active');

          const loop = () => {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              processEyeFrame(videoRef.current);
            }
            animId = requestAnimationFrame(loop);
          };
          animId = requestAnimationFrame(loop);
        }
      } catch (err) {
        console.error('[Session] Eye tracking failed to start:', err);
      }
    }

    startEyeTracking();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [store.eyeTracking.enabled]);

  // ── Gemini + Audio: starts on mount, BUG 7: auto-reconnect ─────────────
  useEffect(() => {
    const client = new GeminiClient();
    clientRef.current = client;

    client.onStateChange = (state) => {
      store.setConnectionState(state);
      console.log('[Session] State:', state);

      // BUG 7: Auto-reconnect on error after 3 seconds
      if (state === 'error') {
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (clientRef.current === client) {
            console.log('[Session] Auto-reconnecting...');
            client.connect();
          }
        }, 3000);
      }
    };

    client.onTranscript = (text, speaker) => {
      store.addTranscript({ speaker, text });
    };

    client.onError = (msg) => {
      console.error('[Session] Error:', msg);
    };

    client.connect();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      clientRef.current = null;
      client.disconnect();
    };
  }, []);

  // ── Mic mute sync ──────────────────────────────────────────────────────
  useEffect(() => {
    if (store.isMicMuted) {
      clientRef.current?.muteMic();
    } else {
      clientRef.current?.unmuteMic();
    }
  }, [store.isMicMuted]);

  // ── Emergency state ────────────────────────────────────────────────────
  if (store.isEmergency) {
    return <EmergencyOverlay />;
  }

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Hidden video for eye tracking — always present if enabled */}
      {store.eyeTracking.enabled && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="fixed top-0 left-0 w-1 h-1 opacity-0 pointer-events-none z-0"
        />
      )}

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
                ? 'Connection error — reconnecting...'
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
