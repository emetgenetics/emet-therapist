"use client";

import { useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '@/lib/store';
import { InworldClient } from '@/lib/inworld-client';
import { initEyeTracker, processEyeFrame } from '@/lib/eye-tracking';
import Lightbar from './Lightbar';
import AudioPanner from './AudioPanner';
import VoiceIndicator from './VoiceIndicator';
import EmergencyOverlay from './EmergencyOverlay';

export default function Session() {
  const store = useSessionStore();
  const clientRef = useRef<InworldClient | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const eyeTrackingActive = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Emergency handler
  const handleEmergency = useCallback(() => {
    useSessionStore.getState().triggerEmergency();
  }, []);

  // Eye tracking: starts immediately on mount, runs continuously
  useEffect(() => {
    if (!store.eyeTracking.enabled || eyeTrackingActive.current) return;
    eyeTrackingActive.current = true;

    let cancelled = false;
    let animId: number;

    const startEyeTracking = async () => {
      const tracker = await initEyeTracker();
      const video = videoRef.current;
      if (!video) return;

      const processFrame = () => {
        if (cancelled) return;
        processEyeFrame(tracker, video);
        animId = requestAnimationFrame(processFrame);
      };

      processFrame();
    };

    startEyeTracking();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
    };
  }, []);

  // Inworld AI + Audio: starts on mount, auto-reconnect
  useEffect(() => {
    const client = new InworldClient();
    clientRef.current = client;

    client.onStateChange = (state) => {
      store.setConnectionState(state);
      console.log('[Session] State:', state);

      if (state === 'error') {
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (clientRef.current === client) {
            console.log('[Session] Auto-reconnecting...');
            client.disconnect();
            const newClient = new InworldClient();
            clientRef.current = newClient;
            newClient.connect();
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
      client.disconnect();
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

  // BLS: start when state changes to DESENSITIZATION or RECONNECTION
  useEffect(() => {
    const { bls, phase } = store;
    if (phase === 'DESENSITIZATION' || phase === 'RECONNECTION') {
      if (!bls.isRunning) {
        clientRef.current?.sendClientContent(`trigger_bls(${bls.speedHz}, ${bls.durationSeconds}, '${bls.color}')`);
      }
    }
  }, [store.phase, store.bls]);

  // Render
  return (
    <div className="flex flex-col h-full">
      <SessionStateIndicator />
      <div className="flex-1 flex">
        <div className="relative w-1/2">
          <Lightbar />
          <AudioPanner />
        </div>
        <div className="relative w-1/2">
          <video ref={videoRef} className="hidden" />
          <VoiceIndicator />
        </div>
      </div>
      <EmergencyOverlay />
    </div>
  );
}
