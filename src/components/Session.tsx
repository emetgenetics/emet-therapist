"use client";

import { useEffect, useRef, useCallback, useState } from 'react';
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
  const [showBlsTest, setShowBlsTest] = useState(false);

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

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      video.srcObject = stream;
      await video.play();

      const processFrame = () => {
        if (cancelled) return;
        processEyeFrame(video);
        animId = requestAnimationFrame(processFrame);
      };

      processFrame();
    };

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
        }, 5000);
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

  // Manual BLS test handler
  const handleTestBlss = () => {
    useSessionStore.getState().startBls({
      speedHz: 2.0,
      durationSeconds: 30,
      color: 'white',
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Connection status + test controls */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${
          store.connectionState === 'ready' || store.connectionState === 'streaming'
            ? 'bg-green-500 animate-pulse'
            : store.connectionState === 'connecting'
            ? 'bg-yellow-500 animate-pulse'
            : 'bg-red-500'
        }`} />
        <span className="text-xs text-white/50 font-mono">
          {store.connectionState === 'ready' ? 'Connected' :
           store.connectionState === 'streaming' ? 'AI Speaking' :
           store.connectionState === 'connecting' ? 'Connecting...' :
           store.connectionState === 'error' ? 'Error' : 'Disconnected'}
        </span>
        {store.connectionState !== 'ready' && store.connectionState !== 'streaming' && (
          <button
            onClick={() => setShowBlsTest(!showBlsTest)}
            className="text-xs text-white/30 hover:text-white/60 underline"
          >
            Test BLS
          </button>
        )}
      </div>

      {/* BLS test panel */}
      {showBlsTest && (
        <div className="absolute top-12 left-4 z-30 bg-black/80 border border-white/10 rounded-lg p-4 space-y-2">
          <p className="text-xs text-white/50 mb-2">Manual BLS Test</p>
          <button
            onClick={handleTestBlss}
            className="block w-full px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded"
          >
            Start BLS (30s, white, 2Hz)
          </button>
          <button
            onClick={() => useSessionStore.getState().startBls({ speedHz: 1.0, durationSeconds: 30, color: 'amber' })}
            className="block w-full px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded"
          >
            Start BLS (30s, amber, 1Hz)
          </button>
          <button
            onClick={() => useSessionStore.getState().stopBls()}
            className="block w-full px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded"
          >
            Stop BLS
          </button>
        </div>
      )}

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
