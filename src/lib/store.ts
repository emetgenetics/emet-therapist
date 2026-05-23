import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SessionPhase, TranscriptEntry, BlsConfig } from '@/types';

interface SessionStore {
  phase: SessionPhase;
  bls: BlsConfig;
  /** Shared timebase for Lightbar + AudioPanner sync (performance.now() timestamp) */
  blsStartTime: number;
  suds: number | null;
  transcript: TranscriptEntry[];
  isMicMuted: boolean;
  isEmergency: boolean;

  setPhase: (p: SessionPhase) => void;
  startBls: (params: { speedHz: number; durationSeconds: number; color: string }) => void;
  stopBls: () => void;
  setSuds: (s: number) => void;
  addTranscript: (t: { speaker: 'ai' | 'user'; text: string }) => void;
  setMicMuted: (m: boolean) => void;
  triggerEmergency: () => void;
  resolveEmergency: () => void;
  reset: () => void;
}

const initialBls: BlsConfig = {
  isRunning: false,
  speedHz: 0,
  color: 'white',
  remainingSeconds: 0,
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      phase: 'PRE_FLIGHT',
      bls: { ...initialBls },
      blsStartTime: 0,
      suds: null,
      transcript: [],
      isMicMuted: false,
      isEmergency: false,

      setPhase: (p) => set({ phase: p }),

      startBls: ({ speedHz, durationSeconds, color }) =>
        set({
          bls: { isRunning: true, speedHz, color, remainingSeconds: durationSeconds },
          blsStartTime: performance.now(),
          isMicMuted: true,
        }),

      stopBls: () =>
        set({
          bls: { ...initialBls },
          blsStartTime: 0,
          // Mic unmute is delayed by 500ms in the component to match AudioPanner fade-out
        }),

      setSuds: (s) => set({ suds: s }),

      addTranscript: (t) =>
        set((state) => ({
          transcript: [...state.transcript, { ...t, timestamp: Date.now() }],
        })),

      setMicMuted: (m) => set({ isMicMuted: m }),

      triggerEmergency: () =>
        set({
          phase: 'EMERGENCY_GROUNDING',
          isEmergency: true,
          bls: { ...initialBls },
          blsStartTime: 0,
          isMicMuted: true,
        }),

      resolveEmergency: () =>
        set({
          phase: 'INTEGRATION',
          isEmergency: false,
          isMicMuted: false,
        }),

      reset: () =>
        set({
          phase: 'PRE_FLIGHT',
          bls: { ...initialBls },
          blsStartTime: 0,
          suds: null,
          transcript: [],
          isMicMuted: false,
          isEmergency: false,
        }),
    }),
    {
      name: 'emet-session',
      partialize: (state) => ({
        phase: state.phase,
        suds: state.suds,
        transcript: state.transcript,
      }),
    }
  )
);
