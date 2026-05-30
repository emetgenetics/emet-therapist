import { useSessionStore } from './store';
import type { SessionPhase } from '@/types';

export const TOOL_SCHEMAS = [
  {
    name: 'trigger_bls',
    description:
      'Start bilateral stimulation (visual lightbar + audio panning). After calling this, say NOTHING. Wait in silence for the duration. The mic will be muted automatically. Use: DESENSITIZATION speedHz=2.0 durationSeconds=30 color=white. RECONNECTION speedHz=1.0 durationSeconds=300 color=amber. INTEGRATION speedHz=0.5 durationSeconds=60 color=emerald. WARM_UP speedHz=1.5 durationSeconds=20 color=white.',
    parameters: {
      type: 'object',
      properties: {
        speedHz: {
          type: 'number',
          description: 'Sweep speed in Hz. DESENSITIZATION=2.0, WARM_UP=1.5, RECONNECTION=1.0, INTEGRATION=0.5',
        },
        durationSeconds: {
          type: 'number',
          description: 'Seconds to run. DESENSITIZATION=30, WARM_UP=20, RECONNECTION=300, INTEGRATION=60',
        },
        color: {
          type: 'string',
          enum: ['white', 'amber', 'emerald', 'blue'],
          description: 'Lightbar color. white=desensitization, amber=reconnection, emerald=integration',
        },
      },
      required: ['speedHz', 'durationSeconds', 'color'],
    },
  },
  {
    name: 'transition_state',
    description:
      'Transition the IADC session to a new phase. Use this for ALL phase changes. Valid phases: INTAKE, DESENSITIZATION, DAY_1_WRAP_UP, CHECK_IN, WARM_UP_BLS, PIVOT, RECONNECTION, INTEGRATION, COMPLETED_DAY_1, COMPLETED_DAY_2, EMERGENCY_GROUNDING.',
    parameters: {
      type: 'object',
      properties: {
        newState: {
          type: 'string',
          enum: [
            'INTAKE',
            'DESENSITIZATION',
            'DAY_1_WRAP_UP',
            'CHECK_IN',
            'WARM_UP_BLS',
            'PIVOT',
            'RECONNECTION',
            'INTEGRATION',
            'COMPLETED_DAY_1',
            'COMPLETED_DAY_2',
            'EMERGENCY_GROUNDING',
          ],
        },
      },
      required: ['newState'],
    },
  },
  {
    name: 'update_suds',
    description: "Record the user's distress level from 0 (no distress) to 10 (maximum distress).",
    parameters: {
      type: 'object',
      properties: {
        score: { type: 'number', minimum: 0, maximum: 10 },
      },
      required: ['score'],
    },
  },
];

export function executeTool(
  name: string,
  args: Record<string, unknown>
): { success: boolean; message: string } {
  const store = useSessionStore.getState();

  switch (name) {
    case 'trigger_bls': {
      const { speedHz, durationSeconds, color } = args as {
        speedHz: number;
        durationSeconds: number;
        color: string;
      };
      store.startBls({ speedHz, durationSeconds, color });
      return {
        success: true,
        message: `BLS started: ${speedHz}Hz, ${durationSeconds}s, color ${color}`,
      };
    }

    case 'transition_state': {
      const { newState } = args as { newState: string };
      store.setPhase(newState as SessionPhase);
      return { success: true, message: `Transitioned to ${newState}` };
    }

    case 'update_suds': {
      const { score } = args as { score: number };
      store.setSuds(score);
      return { success: true, message: `SUDS updated to ${score}` };
    }

    default:
      return { success: false, message: `Unknown tool: ${name}` };
  }
}
