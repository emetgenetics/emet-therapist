"use client";

import { useEffect, useRef, useCallback } from "react";
import { useSessionStore } from "@/lib/store";
import { InworldClient } from "@/lib/inworld-client";
import { initEyeTracker, processEyeFrame } from "@/lib/eye-tracking";
import Lightbar from "./Lightbar";
import AudioPanner from "./AudioPanner";
import EmergencyOverlay from "./EmergencyOverlay";

export default function Session() {
  const store = useSessionStore();
  const clientRef = useRef<InworldClient | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const eyeTrackingActive = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Eye tracking ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!store.eyeTracking.enabled || eyeTrackingActive.current) return;
    eyeTrackingActive.current = true;

    let cancelled = false;
    let animId: number;

    const startEyeTracking = async () => {
      try {
        await initEyeTracker();
        const video = videoRef.current;
        if (!video) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        video.srcObject = stream;
        await video.play();
        console.log("[Session] Eye tracking video active");

        const loop = () => {
          if (video.readyState >= 2) processEyeFrame(video);
          animId = requestAnimationFrame(loop);
        };
        animId = requestAnimationFrame(loop);
      } catch (err) {
        console.error("[Session] Eye tracking failed:", err);
      }
    };

    startEyeTracking();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [store.eyeTracking.enabled]);

  // ── Inworld AI connection ─────────────────────────────────────────────────
  useEffect(() => {
    const client = new InworldClient();
    clientRef.current = client;

    client.onStateChange = (state) => {
      store.setConnectionState(state);
      console.log("[Session] State:", state);

      if (state === "error" || state === "disconnected") {
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (clientRef.current === client) {
            console.log("[Session] Auto-reconnecting...");
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
      console.error("[Session] Error:", msg);
    };

    client.connect();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      client.disconnect();
    };
  }, []);

  // ── Mic mute sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (store.isMicMuted) {
      clientRef.current?.muteMic();
    } else {
      clientRef.current?.unmuteMic();
    }
  }, [store.isMicMuted]);

  // ── Emergency handler ─────────────────────────────────────────────────────
  const handleEmergency = useCallback(() => {
    useSessionStore.getState().triggerEmergency();
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Hidden video for eye tracking */}
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
        {store.phase.replace(/_/g, " ")}
      </div>

      {/* Connection status + emergency */}
      <div className="absolute top-4 right-4 flex items-center gap-4 z-20">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              store.connectionState === "ready" || store.connectionState === "streaming"
                ? "bg-violet-500 animate-pulse"
                : store.connectionState === "connecting"
                ? "bg-amber-500 animate-pulse"
                : "bg-red-500"
            }`}
          />
          <span className="text-xs text-white/40">
            {store.connectionState === "streaming"
              ? "AI speaking..."
              : store.connectionState === "ready"
              ? "Connected"
              : store.connectionState === "connecting"
              ? "Connecting..."
              : "Disconnected"}
          </span>
        </div>
        <button
          onClick={handleEmergency}
          className="w-9 h-9 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center text-white text-sm font-bold"
          title="Emergency — Grounding"
        >
          !
        </button>
      </div>

      {/* BLS Layer — full screen lightbar + audio panner */}
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
                  store.connectionState === "streaming" || store.connectionState === "ready"
                    ? "bg-violet-500 animate-pulse"
                    : store.connectionState === "error"
                    ? "bg-red-500"
                    : "bg-gray-600"
                }`}
              />
            </div>
            <p className="text-gray-600 text-sm">
              {store.connectionState === "streaming" || store.connectionState === "ready"
                ? "Session active"
                : store.connectionState === "error"
                ? "Connection error — reconnecting..."
                : store.connectionState === "connecting"
                ? "Connecting..."
                : "Waiting to connect..."}
            </p>
          </div>
        )}
      </div>

      {/* Bottom status bar */}
      <div className="absolute bottom-4 left-4 right-4 flex justify-between text-white/30 text-sm z-20">
        <span>
          {store.connectionState === "streaming" || store.connectionState === "ready"
            ? "Session active"
            : store.connectionState}
        </span>
        {store.eyeTracking.enabled && (
          <span
            className={
              store.eyeTracking.state === "TRACKING"
                ? "text-emerald-400"
                : store.eyeTracking.state === "FROZEN"
                ? "text-amber-400"
                : store.eyeTracking.state === "ERRATIC"
                ? "text-red-400"
                : ""
            }
          >
            Eye: {store.eyeTracking.state}
          </span>
        )}
        {store.isMicMuted && <span className="text-amber-400/60">Mic muted</span>}
      </div>

      {/* Emergency overlay */}
      <EmergencyOverlay />
    </div>
  );
}
