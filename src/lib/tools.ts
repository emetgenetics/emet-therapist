import { useSessionStore } from './store';

// Gemini Live API uses functionDeclarations format (not OpenAI's tools format)
export const TOOL_SCHEMAS = [
  {
    name: 'trigger_bls',
    description:
      'Start bilateral stimulation (visual lightbar + audio panning). Use during DESENSITIZATION (fast, white) and RECONNECTION (slow, amber). After calling this, the AI must say NOTHING else until the user speaks after the set completes.',
    parameters: {
      type: 'object',
      properties: {
        speedHz: {
          type: 'number',
          description:
            'Sweep speed in Hz. DESENSITIZATION=2.0, RECONNECTION=1.0, INTEGRATION=0.5',
        },
        durationSeconds: {
          type: 'number',
          description:
            'Seconds to run. DESENSITIZATION=30, RECONNECTION=300 (5 min), INTEGRATION=60',
        },
        color: {
          type: 'string',
          enum: ['white', 'amber', 'emerald', 'blue'],
          description: 'Lightbar color',
        },
      },
      required: ['speedHz', 'durationSeconds', 'color'],
    },
  },
  {
    name: 'transition_state',
    description: 'Transition the IADC session to a new psychological state.',
    parameters: {
      type: 'object',
      properties: {
        newState: {
          type: 'string',
          enum: [
            'INTAKE',
            'DESENSITIZATION',
            'PIVOT',
            'RECONNECTION',
            'INTEGRATION',
            'EMERGENCY_GROUNDING',
            'COMPLETED',
          ],
          description: 'Target state',
        },
      },
      required: ['newState'],
    },
  },
  {
    name: 'update_suds',
    description: "Record the user's distress level.",
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
      // Schedule stopBls after durationSeconds
      setTimeout(() => {
        useSessionStore.getState().stopBls();
      }, durationSeconds * 1000);
      return {
        success: true,
        message: `BLS started: ${speedHz}Hz, ${durationSeconds}s, color ${color}`,
      };
    }

    case 'transition_state': {
      const { newState } = args as { newState: string };
      store.setPhase(newState as Parameters<typeof store.setPhase>[0]);
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
