import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SessionState = 
  | 'PRE_FLIGHT'
  | 'INTAKE'
  | 'DESENSITIZATION'
  | 'PIVOT'
  | 'RECONNECTION'
  | 'INTEGRATION'
  | 'EMERGENCY_GROUNDING'
  | 'COMPLETED'
  | 'ABANDONED';

export interface BLSConfig {
  isRunning: boolean;
  speedHz: number;
  durationSeconds: number;
  color: string;
  pattern: 'horizontal' | 'circular' | 'butterfly';
}

export interface TranscriptEntry {
  id: string;
  timestamp: Date;
  speaker: 'CLIENT' | 'AI_THERAPIST' | 'SYSTEM';
  content: string;
}

interface SessionStore {
  sessionId: string | null;
  sessionState: SessionState;
  distressLevel: number;
  sessionGoals: string[];
  
  blsConfig: BLSConfig;
  
  isVoiceConnected: boolean;
  isMicMuted: boolean;
  isPlaying: boolean;
  
  transcripts: TranscriptEntry[];
  
  showEmergencyOverlay: boolean;
  isHeadphonesConfirmed: boolean;
  
  setSessionId: (id: string | null) => void;
  setSessionState: (state: SessionState) => void;
  setDistressLevel: (level: number) => void;
  setSessionGoals: (goals: string[]) => void;
  
  startBLS: (config: Partial<BLSConfig>) => void;
  stopBLS: () => void;
  updateBLSConfig: (config: Partial<BLSConfig>) => void;
  
  setVoiceConnected: (connected: boolean) => void;
  setMicMuted: (muted: boolean) => void;
  setPlaying: (playing: boolean) => void;
  
  addTranscript: (entry: Omit<TranscriptEntry, 'id' | 'timestamp'>) => void;
  clearTranscripts: () => void;
  
  setShowEmergencyOverlay: (show: boolean) => void;
  setHeadphonesConfirmed: (confirmed: boolean) => void;
  
  resetSession: () => void;
}

const initialBLSConfig: BLSConfig = {
  isRunning: false,
  speedHz: 2.0,
  durationSeconds: 30,
  color: 'white',
  pattern: 'horizontal',
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      sessionId: null,
      sessionState: 'PRE_FLIGHT',
      distressLevel: 0,
      sessionGoals: [],
      
      blsConfig: initialBLSConfig,
      
      isVoiceConnected: false,
      isMicMuted: false,
      isPlaying: false,
      
      transcripts: [],
      
      showEmergencyOverlay: false,
      isHeadphonesConfirmed: false,
      
      setSessionId: (id) => set({ sessionId: id }),
      setSessionState: (state) => set({ sessionState: state }),
      setDistressLevel: (level) => set({ distressLevel: Math.max(0, Math.min(10, level)) }),
      setSessionGoals: (goals) => set({ sessionGoals: goals }),
      
      startBLS: (config) => set((state) => ({
        blsConfig: { ...state.blsConfig, ...config, isRunning: true },
        isMicMuted: true,
      })),
      
      stopBLS: () => set((state) => ({
        blsConfig: { ...state.blsConfig, isRunning: false },
        isMicMuted: false,
      })),
      
      updateBLSConfig: (config) => set((state) => ({
        blsConfig: { ...state.blsConfig, ...config },
      })),
      
      setVoiceConnected: (connected) => set({ isVoiceConnected: connected }),
      setMicMuted: (muted) => set({ isMicMuted: muted }),
      setPlaying: (playing) => set({ isPlaying: playing }),
      
      addTranscript: (entry) => set((state) => ({
        transcripts: [...state.transcripts, { ...entry, id: crypto.randomUUID(), timestamp: new Date() }],
      })),
      
      clearTranscripts: () => set({ transcripts: [] }),
      setShowEmergencyOverlay: (show) => set({ showEmergencyOverlay: show }),
      setHeadphonesConfirmed: (confirmed) => set({ isHeadphonesConfirmed: confirmed }),
      
      resetSession: () => set({
        sessionId: null,
        sessionState: 'PRE_FLIGHT',
        distressLevel: 0,
        sessionGoals: [],
        blsConfig: initialBLSConfig,
        isVoiceConnected: false,
        isMicMuted: false,
        isPlaying: false,
        transcripts: [],
        showEmergencyOverlay: false,
        isHeadphonesConfirmed: false,
      }),
    }),
    {
      name: 'emet-session-storage',
      partialize: (state) => ({
        sessionId: state.sessionId,
        sessionState: state.sessionState,
        distressLevel: state.distressLevel,
        sessionGoals: state.sessionGoals,
        isHeadphonesConfirmed: state.isHeadphonesConfirmed,
      }),
    }
  )
);
