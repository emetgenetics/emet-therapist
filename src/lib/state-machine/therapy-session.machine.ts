import { setup, fromCallback, assign } from 'xstate';

// ─── Types ────────────────────────────────────────────────────────

export interface TherapySessionContext {
  sessionId: string;
  userId: string;
  distressLevel: number;
  sessionGoals: string[];
  blsActive: boolean;
  blsConfig: BLSConfig | null;
  voiceConnected: boolean;
  consentGiven: boolean;
  equipmentCheckPassed: boolean;
  emergencyContactNotified: boolean;
  transcriptBuffer: TranscriptEntry[];
  lastActivityAt: number;
}

export interface BLSConfig {
  visualPattern: 'horizontal' | 'circular' | 'butterfly' | 'dotfield';
  visualSpeed: number;
  visualIntensity: number;
  visualColorPrimary: string;
  visualColorSecondary: string;
  auditoryFrequency: number;
  auditoryVolume: number;
  auditoryWaveform: OscillatorType;
}

export interface TranscriptEntry {
  timestamp: number;
  speaker: 'CLIENT' | 'AI_THERAPIST' | 'SYSTEM';
  content: string;
}

export type TherapySessionEvent =
  | { type: 'CONSENT_GIVEN' }
  | { type: 'EQUIPMENT_CHECK_PASSED' }
  | { type: 'EQUIPMENT_CHECK_FAILED' }
  | { type: 'INTAKE_COMPLETE'; goals: string[] }
  | { type: 'PROCESSING_COMPLETE' }
  | { type: 'DISTRESS_SPIKE'; level: number }
  | { type: 'DISTRESS_UPDATE'; level: number }
  | { type: 'GROUNDED' }
  | { type: 'PIVOT_COMPLETE' }
  | { type: 'CLIENT_READY' }
  | { type: 'RECONNECTION_COMPLETE' }
  | { type: 'INTEGRATION_COMPLETE' }
  | { type: 'EMERGENCY_TRIGGERED' }
  | { type: 'EMERGENCY_RESOLVED' }
  | { type: 'SESSION_ABANDONED' }
  | { type: 'SESSION_TIMEOUT' }
  | { type: 'BLS_START' }
  | { type: 'BLS_STOP' }
  | { type: 'VOICE_CONNECTED' }
  | { type: 'VOICE_DISCONNECTED' };

// ─── Guards ───────────────────────────────────────────────────────

const guards = {
  consentGiven: ({ context }: { context: TherapySessionContext }) => context.consentGiven,

  equipmentCheckPassed: ({ context }: { context: TherapySessionContext }) => context.equipmentCheckPassed,

  intakeComplete: ({ context }: { context: TherapySessionContext }) => context.sessionGoals.length > 0,

  isDistressSpike: ({ context, event }: { context: TherapySessionContext; event: TherapySessionEvent }) => {
    if (event.type === 'DISTRESS_SPIKE') return event.level >= 8;
    if (event.type === 'DISTRESS_UPDATE') return event.level >= 8;
    return context.distressLevel >= 8;
  },

  isGrounded: ({ context, event }: { context: TherapySessionContext; event: TherapySessionEvent }) => {
    if (event.type === 'DISTRESS_UPDATE') return event.level < 4;
    return context.distressLevel < 4;
  },

  isClientReady: ({ context }: { context: TherapySessionContext }) => {
    return context.voiceConnected && context.distressLevel <= 5;
  },

  isSessionTimedOut: ({ context }: { context: TherapySessionContext }) => {
    const timeoutMs = 30 * 60 * 1000; // 30 minutes
    return Date.now() - context.lastActivityAt > timeoutMs;
  },
};

// ─── State Machine Definition ─────────────────────────────────────

export const therapySessionMachine = setup({
  types: {
    context: {} as TherapySessionContext,
    events: {} as TherapySessionEvent,
  },
  guards,
}).createMachine({
  id: 'therapySession',
  initial: 'preFlight',

  context: {
    sessionId: '',
    userId: '',
    distressLevel: 0,
    sessionGoals: [],
    blsActive: false,
    blsConfig: null,
    voiceConnected: false,
    consentGiven: false,
    equipmentCheckPassed: false,
    emergencyContactNotified: false,
    transcriptBuffer: [],
    lastActivityAt: Date.now(),
  },

  // ─── Global Transitions ─────────────────────────────────────────
  on: {
    EMERGENCY_TRIGGERED: {
      target: '.emergencyGrounding',
      actions: assign({ distressLevel: 10 }),
    },
    SESSION_ABANDONED: { target: '.abandoned' },
    SESSION_TIMEOUT: { target: '.abandoned' },
    DISTRESS_UPDATE: {
      actions: assign({
        distressLevel: ({ event }) => event.type === 'DISTRESS_UPDATE' ? event.level : 0,
        lastActivityAt: () => Date.now(),
      }),
    },
  },

  states: {
    // ─── PRE_FLIGHT ───────────────────────────────────────────────
    preFlight: {
      entry: assign({ lastActivityAt: () => Date.now() }),
      on: {
        CONSENT_GIVEN: {
          actions: assign({ consentGiven: true }),
        },
        EQUIPMENT_CHECK_PASSED: {
          actions: assign({ equipmentCheckPassed: true }),
        },
      },
      always: {
        target: 'intake',
        guard: ({ context }) => context.consentGiven && context.equipmentCheckPassed,
      },
    },

    // ─── INTAKE ───────────────────────────────────────────────────
    intake: {
      entry: assign({ lastActivityAt: () => Date.now() }),
      on: {
        INTAKE_COMPLETE: {
          target: 'desensitization',
          actions: assign({
            sessionGoals: ({ event }) => event.type === 'INTAKE_COMPLETE' ? event.goals : [],
          }),
        },
      },
    },

    // ─── DESENSITIZATION ──────────────────────────────────────────
    desensitization: {
      entry: [
        assign({ blsActive: true, lastActivityAt: () => Date.now() }),
        ({ context }) => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('bls:visual:start', { detail: context.blsConfig }));
            window.dispatchEvent(new CustomEvent('bls:auditory:start', { detail: context.blsConfig }));
          }
        },
      ],
      on: {
        PROCESSING_COMPLETE: { target: 'pivot' },
        DISTRESS_SPIKE: [
          {
            target: 'emergencyGrounding',
            guard: ({ event }) => event.type === 'DISTRESS_SPIKE' && event.level >= 8,
            actions: assign({ distressLevel: ({ event }) => event.type === 'DISTRESS_SPIKE' ? event.level : 8 }),
          },
          {
            actions: assign({ distressLevel: ({ event }) => event.type === 'DISTRESS_SPIKE' ? event.level : 0 }),
          },
        ],
      },
      exit: [
        assign({ blsActive: false }),
        () => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('bls:visual:stop'));
            window.dispatchEvent(new CustomEvent('bls:auditory:stop'));
          }
        },
      ],
    },

    // ─── PIVOT ────────────────────────────────────────────────────
    pivot: {
      entry: assign({ blsActive: false, lastActivityAt: () => Date.now() }),
      on: {
        CLIENT_READY: {
          target: 'reconnection',
          guard: guards.isClientReady,
        },
        PIVOT_COMPLETE: { target: 'reconnection' },
      },
    },

    // ─── RECONNECTION ─────────────────────────────────────────────
    reconnection: {
      entry: [
        assign({ blsActive: true, lastActivityAt: () => Date.now() }),
        ({ context }) => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('bls:visual:start', { detail: context.blsConfig }));
          }
        },
      ],
      on: {
        RECONNECTION_COMPLETE: { target: 'integration' },
        DISTRESS_SPIKE: [
          {
            target: 'emergencyGrounding',
            guard: ({ event }) => event.type === 'DISTRESS_SPIKE' && event.level >= 8,
            actions: assign({ distressLevel: ({ event }) => event.type === 'DISTRESS_SPIKE' ? event.level : 8 }),
          },
          {
            actions: assign({ distressLevel: ({ event }) => event.type === 'DISTRESS_SPIKE' ? event.level : 0 }),
          },
        ],
      },
      exit: [
        assign({ blsActive: false }),
        () => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('bls:visual:stop'));
          }
        },
      ],
    },

    // ─── INTEGRATION ──────────────────────────────────────────────
    integration: {
      entry: [
        assign({ blsActive: true, lastActivityAt: () => Date.now() }),
        () => {
          if (typeof window !== 'undefined') {
            const calmingConfig = {
              visualPattern: 'horizontal' as const,
              visualSpeed: 30,
              visualIntensity: 0.3,
              visualColorPrimary: '#10B981',
              visualColorSecondary: '#6EE7B7',
              auditoryFrequency: 220,
              auditoryVolume: 0.08,
              auditoryWaveform: 'sine' as OscillatorType,
            };
            window.dispatchEvent(new CustomEvent('bls:visual:start', { detail: calmingConfig }));
            window.dispatchEvent(new CustomEvent('bls:auditory:start', { detail: calmingConfig }));
          }
        },
      ],
      on: {
        INTEGRATION_COMPLETE: { target: 'completed' },
      },
      exit: [
        assign({ blsActive: false }),
        () => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('bls:visual:stop'));
            window.dispatchEvent(new CustomEvent('bls:auditory:stop'));
          }
        },
      ],
    },

    // ─── EMERGENCY GROUNDING ──────────────────────────────────────
    emergencyGrounding: {
      entry: [
        assign({ blsActive: true, lastActivityAt: () => Date.now() }),
        () => {
          if (typeof window !== 'undefined') {
            const emergencyConfig = {
              visualPattern: 'horizontal' as const,
              visualSpeed: 20,
              visualIntensity: 0.25,
              visualColorPrimary: '#3B82F6',
              visualColorSecondary: '#93C5FD',
              auditoryFrequency: 196,
              auditoryVolume: 0.06,
              auditoryWaveform: 'sine' as OscillatorType,
            };
            window.dispatchEvent(new CustomEvent('bls:visual:start', { detail: emergencyConfig }));
            window.dispatchEvent(new CustomEvent('bls:auditory:start', { detail: emergencyConfig }));
          }
        },
      ],
      on: {
        GROUNDED: [
          {
            target: 'integration',
            guard: guards.isGrounded,
          },
        ],
        EMERGENCY_RESOLVED: { target: 'integration' },
      },
      exit: [
        assign({ blsActive: false, emergencyContactNotified: false }),
        () => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('bls:visual:stop'));
            window.dispatchEvent(new CustomEvent('bls:auditory:stop'));
          }
        },
      ],
    },

    // ─── COMPLETED ────────────────────────────────────────────────
    completed: {
      type: 'final',
      entry: assign({ blsActive: false }),
    },

    // ─── ABANDONED ────────────────────────────────────────────────
    abandoned: {
      type: 'final',
      entry: assign({ blsActive: false }),
    },
  },
});
