export type SessionPhase =
  | 'PRE_FLIGHT'
  | 'INTAKE'
  | 'DESENSITIZATION'
  | 'DAY_1_WRAP_UP'
  | 'CHECK_IN'
  | 'WARM_UP_BLS'
  | 'PIVOT'
  | 'RECONNECTION'
  | 'INTEGRATION'
  | 'COMPLETED_DAY_1'
  | 'COMPLETED_DAY_2'
  | 'EMERGENCY_GROUNDING';

export type EyeState = 'IDLE' | 'TRACKING' | 'FROZEN' | 'ERRATIC';

export type ConnectionState = 'idle' | 'connecting' | 'ready' | 'streaming' | 'disconnected' | 'error';

export interface TranscriptEntry {
  speaker: 'ai' | 'user';
  text: string;
  timestamp: number;
}

export interface SessionStore {
  phase: SessionPhase;
  day: 1 | 2 | null;
  bls: {
    isRunning: boolean;
    speedHz: number;
    color: string;
    durationSeconds: number;
    startTime: number;
  };
  suds: number | null;
  isMicMuted: boolean;
  isEmergency: boolean;
  eyeTracking: {
    enabled: boolean;
    state: EyeState;
    position: { x: number };
    velocity: number;
    fixationVar: number;
  };
  transcript: TranscriptEntry[];
  connectionState: ConnectionState;

  setPhase: (p: SessionPhase) => void;
  setDay: (d: 1 | 2) => void;
  startBls: (params: { speedHz: number; durationSeconds: number; color: string }) => void;
  stopBls: () => void;
  setSuds: (s: number) => void;
  setMicMuted: (m: boolean) => void;
  setConnectionState: (s: ConnectionState) => void;
  triggerEmergency: () => void;
  resolveEmergency: () => void;
  addTranscript: (t: { speaker: 'ai' | 'user'; text: string }) => void;
  setEyeTracking: (e: Partial<SessionStore['eyeTracking']>) => void;
  completeDay1: () => void;
  reset: () => void;
}
