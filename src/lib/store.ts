import { create } from 'zustand';
import type { SessionStore, SessionPhase, ConnectionState } from '@/types';

const initialBls = {
  isRunning: false,
  speedHz: 2.0,
  color: 'white',
  durationSeconds: 0,
  startTime: 0,
};

const initialEyeTracking = {
  enabled: false,
  state: 'IDLE' as const,
  position: { x: 0.5 },
  velocity: 0,
  fixationVar: 0,
};

export const useSessionStore = create<SessionStore>((set, get) => ({
  phase: 'PRE_FLIGHT',
  day: null,
  bls: { ...initialBls },
  suds: null,
  isMicMuted: false,
  isEmergency: false,
  eyeTracking: { ...initialEyeTracking },
  transcript: [],
  connectionState: 'idle',

  setPhase: (phase: SessionPhase) => set({ phase }),
  setDay: (day: 1 | 2) => set({ day }),

  startBls: ({ speedHz, durationSeconds, color }) => {
    set({
      bls: { isRunning: true, speedHz, color, durationSeconds, startTime: performance.now() },
      isMicMuted: true,
    });
    // Auto-stop after duration
    setTimeout(() => {
      get().stopBls();
    }, durationSeconds * 1000);
  },

  // BUG 4 fix: delay mic unmute to let AudioPanner fade out
  stopBls: () => {
    set({ bls: { ...initialBls } });
    // Do NOT unmute immediately — AudioPanner needs time to fade
    setTimeout(() => {
      set({ isMicMuted: false });
    }, 600);
  },

  setSuds: (suds: number) => set({ suds }),
  setMicMuted: (isMicMuted: boolean) => set({ isMicMuted }),
  setConnectionState: (connectionState: ConnectionState) => set({ connectionState }),

  triggerEmergency: () => set({
    isEmergency: true,
    phase: 'EMERGENCY_GROUNDING',
    bls: { ...initialBls },
    isMicMuted: true,
  }),

  resolveEmergency: () => set({
    isEmergency: false,
    phase: 'INTEGRATION',
    isMicMuted: false,
  }),

  addTranscript: (entry: { speaker: 'ai' | 'user'; text: string }) =>
    set((state) => ({
      transcript: [...state.transcript, { ...entry, timestamp: Date.now() }],
    })),

  setEyeTracking: (update: Partial<SessionStore['eyeTracking']>) =>
    set((state) => ({
      eyeTracking: { ...state.eyeTracking, ...update },
    })),

  completeDay1: () => {
    const state = get();
    localStorage.setItem('emet_day1_completed', Date.now().toString());
    localStorage.setItem('emet_day1_context', JSON.stringify({
      targetImage: state.transcript.find(t => t.speaker === 'user' && t.text.toLowerCase().includes('image'))?.text || '',
      bodyLocation: state.transcript.find(t => t.speaker === 'user' && t.text.toLowerCase().includes('body'))?.text || '',
      finalSuds: state.suds,
    }));
    set({ phase: 'COMPLETED_DAY_1' });
  },

  reset: () => {
    localStorage.removeItem('emet_day1_completed');
    localStorage.removeItem('emet_day1_context');
    set({
      phase: 'PRE_FLIGHT',
      day: null,
      bls: { ...initialBls },
      suds: null,
      isMicMuted: false,
      isEmergency: false,
      eyeTracking: { ...initialEyeTracking },
      transcript: [],
      connectionState: 'idle',
    });
  },
}));
