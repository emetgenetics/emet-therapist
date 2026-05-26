import { GoogleGenAI, Modality } from '@google/genai';
import { useSessionStore } from './store';
import { getPromptForState } from './prompts';
import { TOOL_SCHEMAS, executeTool } from './tools';
import type { ConnectionState } from '@/types';

const GEMINI_MODEL = 'gemini-3.1-flash-live-preview';
const OUTPUT_SAMPLE_RATE = 24000;

export class GeminiClient {
  private client: GoogleGenAI | null = null;
  private session: any = null;
  private audioCtx: AudioContext | null = null;
  private nextPlayTime = 0;
  private isMuted = false;

  onTranscript: ((text: string, speaker: 'ai' | 'user') => void) | null = null;
  onStateChange: ((state: ConnectionState) => void) | null = null;
  onError: ((msg: string) => void) | null = null;

  private setState(state: ConnectionState) {
    useSessionStore.getState().setConnectionState(state);
    this.onStateChange?.(state);
  }

  async connect() {
    try {
      this.setState('connecting');

      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) throw new Error('NEXT_PUBLIC_GEMINI_API_KEY is not set');

      this.client = new GoogleGenAI({ apiKey });

      const store = useSessionStore.getState();
      const instructions = getPromptForState(store.phase, store.day);

      this.session = await this.client.live.connect({
        model: GEMINI_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Puck' },
            },
          },
          systemInstruction: { parts: [{ text: instructions }] },
          tools: [{ functionDeclarations: TOOL_SCHEMAS as any }],
        },
        callbacks: {
          onopen: () => {
            console.log('[Gemini] Connection opened');
          },
          onmessage: (message: any) => {
            this.handleMessage(message);
          },
          onerror: (error: any) => {
            console.error('[Gemini] Error:', error);
            this.onError?.(error.message || 'Session error');
            this.setState('error');
          },
          onclose: () => {
            console.log('[Gemini] Connection closed');
            this.setState('disconnected');
          },
        },
      });

      this.setState('ready');

      // Send initial prompt to start the session
      this.session.sendClientContent({
        turns: [
          {
            role: 'user',
            parts: [
              {
                text: 'Begin the IADC session. Introduce yourself briefly and ask me to think about the person I have lost.',
              },
            ],
          },
        ],
        turnComplete: true,
      });
    } catch (error: any) {
      console.error('[Gemini] Connect failed:', error);
      this.onError?.(error.message || 'Connection failed');
      this.setState('error');
    }
  }

  private async handleMessage(message: any) {
    // Handle setup complete
    if (message.setupComplete) {
      console.log('[Gemini] Setup complete');
      this.setState('ready');
      return;
    }

    // Handle server content (AI response)
    if (message.serverContent) {
      const content = message.serverContent;

      // Model turn with parts
      if (content.modelTurn?.parts) {
        this.setState('streaming');
        for (const part of content.modelTurn.parts) {
          if (part.text) {
            this.onTranscript?.(part.text, 'ai');
          }
          if (part.inlineData?.data && part.inlineData?.mimeType?.startsWith('audio/')) {
            await this.playAudio(part.inlineData.data);
          }
        }
      }

      // Input transcription (what the user said)
      if (content.inputTranscription?.text) {
        this.onTranscript?.(content.inputTranscription.text, 'user');
      }

      // Turn complete
      if (content.turnComplete) {
        this.setState('ready');
      }

      // Interrupted
      if (content.interrupted) {
        this.nextPlayTime = 0;
      }
    }

    // Handle tool calls from AI
    if (message.toolCall?.functionCalls) {
      for (const call of message.toolCall.functionCalls) {
        const result = executeTool(call.name, call.args || {});

        // Send tool response back to Gemini
        if (this.session) {
          this.session.sendToolResponse({
            functionResponses: [
              {
                name: call.name,
                id: call.id,
                response: { result: result.message },
              },
            ],
          });
        }
      }
    }

    // Handle text (alternative path)
    if (message.text) {
      this.onTranscript?.(message.text, 'ai');
    }

    // Handle data/audio (alternative path)
    if (message.data) {
      await this.playAudio(message.data);
      this.setState('streaming');
    }
  }

  private async playAudio(audioData: any) {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
        this.nextPlayTime = 0;
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      const buffer = await this.decodeAudio(audioData);
      if (!buffer) return;

      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioCtx.destination);

      const now = this.audioCtx.currentTime;
      if (this.nextPlayTime < now) this.nextPlayTime = now;
      source.start(this.nextPlayTime);
      this.nextPlayTime += buffer.duration;
    } catch (error: any) {
      console.error('[Gemini] Audio playback error:', error);
    }
  }

  private async decodeAudio(audioData: any): Promise<AudioBuffer | null> {
    if (audioData instanceof AudioBuffer) return audioData;
    if (typeof audioData === 'string') {
      // Base64-encoded PCM
      const binary = Uint8Array.from(atob(audioData), (c) => c.charCodeAt(0));
      return this.pcmToBuffer(binary);
    }
    if (audioData instanceof Uint8Array || audioData instanceof ArrayBuffer) {
      return this.pcmToBuffer(new Uint8Array(audioData));
    }
    if (audioData?.data) return this.decodeAudio(audioData.data);
    console.warn('[Gemini] Unknown audio format:', typeof audioData);
    return null;
  }

  private pcmToBuffer(bytes: Uint8Array): AudioBuffer {
    const pcm16 = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      Math.floor(bytes.byteLength / 2)
    );
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }
    const buffer = this.audioCtx!.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);
    return buffer;
  }

  sendAudioChunk(pcm16Base64: string) {
    if (this.isMuted || !this.session) return;
    this.session.sendRealtimeInput({
      media: {
        mimeType: 'audio/pcm;rate=16000',
        data: pcm16Base64,
      },
    });
  }

  muteMic() {
    this.isMuted = true;
  }

  unmuteMic() {
    this.isMuted = false;
  }

  disconnect() {
    this.session?.close();
    this.session = null;
    this.audioCtx?.close();
    this.audioCtx = null;
    this.nextPlayTime = 0;
    this.setState('disconnected');
  }
}
