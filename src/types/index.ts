export type SessionPhase =
  | 'PRE_FLIGHT'
  | 'INTAKE'
  | 'DESENSITIZATION'
  | 'PIVOT'
  | 'RECONNECTION'
  | 'INTEGRATION'
  | 'COMPLETED'
  | 'EMERGENCY_GROUNDING';

export interface TranscriptEntry {
  speaker: 'ai' | 'user';
  text: string;
  timestamp: number;
}

export interface BlsConfig {
  isRunning: boolean;
  speedHz: number;
  color: string;
  remainingSeconds: number;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  callId: string;
}
