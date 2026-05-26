'use client';

import { useSessionStore } from '@/lib/store';

export default function VoiceIndicator() {
  const store = useSessionStore();
  const { connectionState, isMicMuted, bls, eyeTracking } = store;

  // BLS active — highest priority
  if (bls.isRunning) {
    return (
      <div className="flex items-center gap-2 text-amber-400">
        <div className="w-3 h-3 bg-amber-400 rounded-full animate-pulse" />
        <span className="text-sm">
          BLS Active
          {eyeTracking.enabled && ` • Eye ${eyeTracking.state}`}
        </span>
      </div>
    );
  }

  // Mic muted (but BLS not running)
  if (isMicMuted) {
    return (
      <div className="flex items-center gap-2 text-red-400">
        <div className="w-3 h-3 bg-red-400 rounded-full" />
        <span className="text-sm">Mic Muted</span>
      </div>
    );
  }

  // Streaming / listening
  if (connectionState === 'streaming') {
    return (
      <div className="flex items-center gap-2 text-emerald-400">
        <div className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse" />
        <span className="text-sm">Listening</span>
      </div>
    );
  }

  // Ready
  if (connectionState === 'ready') {
    return (
      <div className="flex items-center gap-2 text-blue-400">
        <div className="w-3 h-3 bg-blue-400 rounded-full" />
        <span className="text-sm">Ready</span>
      </div>
    );
  }

  // Connecting
  if (connectionState === 'connecting') {
    return (
      <div className="flex items-center gap-2 text-yellow-400">
        <div className="w-3 h-3 bg-yellow-400 rounded-full animate-pulse" />
        <span className="text-sm">Connecting...</span>
      </div>
    );
  }

  // Error
  if (connectionState === 'error') {
    return (
      <div className="flex items-center gap-2 text-red-400">
        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
        <span className="text-sm">Error</span>
      </div>
    );
  }

  // Disconnected / idle
  return (
    <div className="flex items-center gap-2 text-white/30">
      <div className="w-3 h-3 bg-white/30 rounded-full" />
      <span className="text-sm">{connectionState}</span>
    </div>
  );
}
