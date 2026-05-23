'use client';

import { useCallback, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import { therapySessionMachine } from '@/lib/state-machine/therapy-session.machine';
import type { TherapySessionContext, TherapySessionEvent } from '@/lib/state-machine/therapy-session.machine';

export function useSession(sessionId: string, userId: string = '') {
  const [syncedState, setSyncedState] = useState<string | null>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const defaultContext: TherapySessionContext = {
    sessionId,
    userId,
    distressLevel: 0,
    sessionGoals: [],
    blsActive: false,
    blsConfig: {
      visualPattern: 'horizontal',
      visualSpeed: 60,
      visualIntensity: 0.5,
      visualColorPrimary: '#8B5CF6',
      visualColorSecondary: '#C4B5FD',
      auditoryFrequency: 440,
      auditoryVolume: 0.1,
      auditoryWaveform: 'sine',
    },
    voiceConnected: false,
    consentGiven: false,
    equipmentCheckPassed: false,
    emergencyContactNotified: false,
    transcriptBuffer: [],
    lastActivityAt: Date.now(),
  };

  const [snapshot, send] = useMachine(therapySessionMachine, {
    input: defaultContext,
  });

  // Sync state changes to server
  const syncState = useCallback(
    async (newState: string, metadata?: Record<string, unknown>) => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(async () => {
        try {
          await fetch(`/api/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentState: newState, metadata }),
          });
        } catch (error) {
          console.error('Failed to sync state:', error);
        }
      }, 300);
    },
    [sessionId]
  );

  // Send event and sync
  const sendEvent = useCallback(
    (event: TherapySessionEvent) => {
      send(event);
      const stateMap: Record<string, string> = {
        CONSENT_GIVEN: 'PRE_FLIGHT',
        EQUIPMENT_CHECK_PASSED: 'PRE_FLIGHT',
        INTAKE_COMPLETE: 'DESENSITIZATION',
        PROCESSING_COMPLETE: 'PIVOT',
        PIVOT_COMPLETE: 'RECONNECTION',
        CLIENT_READY: 'RECONNECTION',
        RECONNECTION_COMPLETE: 'INTEGRATION',
        INTEGRATION_COMPLETE: 'COMPLETED',
        EMERGENCY_TRIGGERED: 'EMERGENCY_GROUNDING',
        EMERGENCY_RESOLVED: 'INTEGRATION',
        GROUNDED: 'DESENSITIZATION',
        SESSION_ABANDONED: 'ABANDONED',
      };
      const newState = stateMap[event.type];
      if (newState) syncState(newState, { event: event.type });
    },
    [send, syncState]
  );

  return {
    session: snapshot.context as TherapySessionContext,
    currentState: snapshot.value as string,
    distressLevel: (snapshot.context as TherapySessionContext).distressLevel,
    blsActive: (snapshot.context as TherapySessionContext).blsActive,
    sendEvent,
  };
}
