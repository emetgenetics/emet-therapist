import { openrouter, getSystemPrompt, type TherapyState } from '../openrouter';

export interface TherapyMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TherapySessionContext {
  sessionId: string;
  currentState: TherapyState;
  distressLevel: number;
  sessionGoals?: string;
  transcriptHistory: Array<{ speaker: string; content: string }>;
}

// State transition function calling tools
export const THERAPY_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'transition_state',
      description: 'Transition to the next therapy phase when the client is ready. Only call when the current phase goals are met.',
      parameters: {
        type: 'object' as const,
        properties: {
          target_state: {
            type: 'string',
            enum: ['INTAKE', 'DESENSITIZATION', 'PIVOT', 'RECONNECTION', 'INTEGRATION', 'EMERGENCY_GROUNDING', 'COMPLETED'],
            description: 'The next therapy state to transition to',
          },
          reason: {
            type: 'string',
            description: 'Brief clinical reason for the transition',
          },
        },
        required: ['target_state', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'trigger_bls',
      description: 'Start bilateral stimulation. Use during desensitization and reconnection phases.',
      parameters: {
        type: 'object' as const,
        properties: {
          speed_hz: {
            type: 'number',
            description: 'BLS speed in Hz (cycles per second). Use 2.0 for desensitization, 1.0 for reconnection, 0.5 for calming.',
          },
          duration_seconds: {
            type: 'number',
            description: 'Duration in seconds. Typical: 30 for desensitization sets, 300 for reconnection.',
          },
          color: {
            type: 'string',
            description: 'BLS dot color. Use white for desensitization, amber for reconnection, blue for calming.',
          },
        },
        required: ['speed_hz', 'duration_seconds', 'color'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_distress',
      description: 'Update the client distress level based on verbal and emotional cues observed during the session.',
      parameters: {
        type: 'object' as const,
        properties: {
          level: {
            type: 'number',
            description: 'Distress level from 0 (completely calm) to 10 (extreme distress)',
          },
          reason: {
            type: 'string',
            description: 'Brief reason for the assessment',
          },
        },
        required: ['level', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'trigger_emergency',
      description: 'Trigger emergency grounding protocol when client is in severe distress (level 8+). This immediately transitions to EMERGENCY_GROUNDING state.',
      parameters: {
        type: 'object' as const,
        properties: {
          reason: {
            type: 'string',
            description: 'Description of the emergency situation',
          },
        },
        required: ['reason'],
      },
    },
  },
];

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onFunctionCall: (name: string, args: Record<string, unknown>) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: Error) => void;
}

export async function streamTherapyResponse(
  context: TherapySessionContext,
  callbacks: StreamCallbacks,
  modelId: string = 'google/gemma-2-9b-it:free'
) {
  const messages: TherapyMessage[] = [
    {
      role: 'system',
      content: getSystemPrompt(context.currentState),
    },
  ];

  // Add session context
  if (context.sessionGoals) {
    messages.push({
      role: 'system',
      content: `Session goals: ${context.sessionGoals}`,
    });
  }

  messages.push({
    role: 'system',
    content: `Current distress level: ${context.distressLevel}/10`,
  });

  // Add recent transcript history (last 20 entries)
  const recentHistory = context.transcriptHistory.slice(-20);
  for (const entry of recentHistory) {
    messages.push({
      role: entry.speaker === 'CLIENT' ? 'user' : 'assistant',
      content: entry.content,
    });
  }

  let fullResponse = '';

  try {
    const stream = await openrouter.chat.completions.create({
      model: modelId,
      messages,
      tools: THERAPY_TOOLS,
      tool_choice: 'auto',
      stream: true,
      max_tokens: 300,
      temperature: 0.7,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      // Handle text content
      if (delta?.content) {
        fullResponse += delta.content;
        callbacks.onToken(delta.content);
      }

      // Handle function calls
      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          if (toolCall.function?.name && toolCall.function?.arguments) {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              callbacks.onFunctionCall(toolCall.function.name, args);
            } catch {
              // Partial arguments, skip
            }
          }
        }
      }
    }

    callbacks.onComplete(fullResponse);
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error('Unknown error'));
  }
}

// Non-streaming version for simple use
export async function getTherapyResponse(
  context: TherapySessionContext,
  modelId: string = 'google/gemma-2-9b-it:free'
): Promise<{ response: string; functionCalls: Array<{ name: string; args: Record<string, unknown> }> }> {
  const messages: TherapyMessage[] = [
    { role: 'system', content: getSystemPrompt(context.currentState) },
  ];

  if (context.sessionGoals) {
    messages.push({ role: 'system', content: `Session goals: ${context.sessionGoals}` });
  }

  messages.push({ role: 'system', content: `Current distress level: ${context.distressLevel}/10` });

  const recentHistory = context.transcriptHistory.slice(-20);
  for (const entry of recentHistory) {
    messages.push({
      role: entry.speaker === 'CLIENT' ? 'user' : 'assistant',
      content: entry.content,
    });
  }

  const completion = await openrouter.chat.completions.create({
    model: modelId,
    messages,
    tools: THERAPY_TOOLS,
    tool_choice: 'auto',
    max_tokens: 300,
    temperature: 0.7,
  });

  const message = completion.choices[0]?.message;
  const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  if (message?.tool_calls) {
    for (const tc of message.tool_calls) {
      const toolFunction = (tc as { function?: { name?: string; arguments?: string } }).function;
      if (toolFunction?.name && toolFunction?.arguments) {
        try {
          functionCalls.push({
            name: toolFunction.name,
            args: JSON.parse(toolFunction.arguments),
          });
        } catch {
          // skip partial
        }
      }
    }
  }

  return {
    response: message?.content || '',
    functionCalls,
  };
}
