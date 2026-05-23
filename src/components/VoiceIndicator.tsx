'use client';

import type { ConnectionState } from '@/lib/realtime';

interface VoiceIndicatorProps {
  connectionState: ConnectionState;
  isAiSpeaking: boolean;
  isMicMuted: boolean;
  isBlsActive: boolean;
}

export default function VoiceIndicator({
  connectionState,
  isAiSpeaking,
  isMicMuted,
  isBlsActive,
}: VoiceIndicatorProps) {
  if (connectionState === 'idle') {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <div className="w-2 h-2 rounded-full bg-gray-600" />
        <span className="text-xs">Idle</span>
      </div>
    );
  }

  if (connectionState === 'error') {
    return (
      <div className="flex items-center gap-2 text-red-400">
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs">Connection error</span>
      </div>
    );
  }

  if (connectionState === 'disconnected') {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <div className="w-2 h-2 rounded-full bg-gray-600" />
        <span className="text-xs">Disconnected</span>
      </div>
    );
  }

  if (connectionState === 'connecting') {
    return (
      <div className="flex items-center gap-2 text-yellow-400">
        <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
        <span className="text-xs">Connecting...</span>
      </div>
    );
  }

  if (isBlsActive) {
    return (
      <div className="flex items-center gap-2 text-amber-400">
        <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-xs">BLS Active — Mic Muted</span>
      </div>
    );
  }

  if (isAiSpeaking) {
    return (
      <div className="flex items-center gap-2 text-violet-400">
        <div className="relative">
          <div className="w-3 h-3 rounded-full bg-violet-400 animate-ping absolute" />
          <div className="w-3 h-3 rounded-full bg-violet-400" />
        </div>
        <span className="text-xs">AI Speaking</span>
      </div>
    );
  }

  if (isMicMuted) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
          />
        </svg>
        <span className="text-xs">Mic Muted</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-emerald-400">
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
        />
      </svg>
      <span className="text-xs">Listening</span>
    </div>
  );
}
