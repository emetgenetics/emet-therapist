import { TOOL_SCHEMAS, executeTool } from './tools';
import { getPromptForState } from './prompts';
import { useSessionStore } from './store';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

const GEMINI_MODEL = 'models/gemini-3.1-flash-live-preview';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const CHUNK_MS = 100;

function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

function int16ArrayToBase64(int16Array: Int16Array): string {
  const bytes = new Uint8Array(int16Array.buffer, int16Array.byteOffset, int16Array.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export class GeminiLiveClient {
  ws: WebSocket | null = null;
  micStream: MediaStream | null = null;
  audioCtx: AudioContext | null = null;
  sourceNode: MediaStreamAudioSourceNode | null = null;
  processorNode: ScriptProcessorNode | null = null;
  playbackCtx: AudioContext | null = null;
  playbackQueue: AudioBufferSourceNode[] = [];
  isMicMuted = false;

  onToolCall:
    | ((name: string, args: Record<string, unknown>) => void)
    | null = null;
  onTranscript:
    | ((text: string, speaker: 'ai' | 'user') => void)
    | null = null;
  onStateChange: ((state: ConnectionState) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  private currentInstructions = '';

  setInstructions(instructions: string) {
    this.currentInstructions = instructions;
  }

  async connect() {
    try {
      this.onStateChange?.('connecting');

      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('NEXT_PUBLIC_GEMINI_API_KEY is missing from environment');
      }

      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      this.ws = new WebSocket(wsUrl);

      await new Promise<void>((resolve, reject) => {
        if (!this.ws) return reject(new Error('WebSocket not created'));

        this.ws.onopen = () => {
          console.log('[GeminiLive] WebSocket connected');
          resolve();
        };

        this.ws.onerror = (err) => {
          console.error('[GeminiLive] WebSocket error:', err);
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = (event) => {
          console.log('[GeminiLive] WebSocket closed:', event.code, event.reason);
          this.onStateChange?.('disconnected');
        };

        setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
      });

      this.ws.onmessage = (event) => {
        this.handleMessage(event);
      };

      // Send setup message
      const currentPhase = useSessionStore.getState().phase;
      const instructions = this.currentInstructions || getPromptForState(currentPhase);

      const setupMessage = {
        setup: {
          model: GEMINI_MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Puck',
                },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: instructions }],
          },
          tools: [{ functionDeclarations: TOOL_SCHEMAS }],
        },
      };

      this.ws.send(JSON.stringify(setupMessage));
      console.log('[GeminiLive] Setup message sent');

      // Initialize audio capture
      await this.initAudioCapture();

      this.onStateChange?.('connected');
    } catch (error: any) {
      console.error('[GeminiLive] Connection failed:', error?.message || error);
      this.onStateChange?.('error');
      this.onError?.(error?.message || 'Connection failed');
      this.disconnect();
    }
  }

  private async initAudioCapture() {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });

    this.audioCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    this.sourceNode = this.audioCtx.createMediaStreamSource(this.micStream);

    const bufferSize = INPUT_SAMPLE_RATE * (CHUNK_MS / 1000);
    const processor = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);

    processor.onaudioprocess = (e) => {
      if (this.isMicMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = float32ToInt16(inputData);
      const base64 = int16ArrayToBase64(pcmData);

      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: 'audio/pcm;rate=16000',
                data: base64,
              },
            ],
          },
        })
      );
    };

    this.sourceNode.connect(processor);
    processor.connect(this.audioCtx.destination);
    this.processorNode = processor;

    console.log('[GeminiLive] Audio capture initialized at', INPUT_SAMPLE_RATE, 'Hz');
  }

  private handleMessage(event: MessageEvent) {
    try {
      let data: any;

      if (typeof event.data === 'string') {
        data = JSON.parse(event.data);
      } else {
        console.log('[GeminiLive] Received binary data, length:', event.data.byteLength);
        return;
      }

      console.log('[GeminiLive] Event:', Object.keys(data).join(', '));

      if (data.setupComplete) {
        console.log('[GeminiLive] Setup complete');
      }

      if (data.serverContent) {
        const serverContent = data.serverContent;

        if (serverContent.modelTurn) {
          const parts = serverContent.modelTurn.parts || [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              this.playAudio(part.inlineData.data);
            }
            if (part.text) {
              this.onTranscript?.(part.text, 'ai');
            }
          }
        }

        if (serverContent.inputTranscription) {
          const text = serverContent.inputTranscription.text;
          if (text) {
            this.onTranscript?.(text, 'user');
          }
        }

        if (serverContent.outputTranscription) {
          const text = serverContent.outputTranscription.text;
          if (text) {
            this.onTranscript?.(text, 'ai');
          }
        }

        if (serverContent.turnComplete) {
          console.log('[GeminiLive] Turn complete');
        }

        if (serverContent.interrupted) {
          console.log('[GeminiLive] Interrupted');
          this.stopPlayback();
        }
      }

      if (data.toolCall) {
        const toolCall = data.toolCall;
        console.log('[GeminiLive] Tool call:', toolCall.functionCalls?.map((f: any) => f.name));

        if (toolCall.functionCalls) {
          for (const call of toolCall.functionCalls) {
            const { name, args, id: callId } = call;

            const result = executeTool(name, args || {});
            this.onToolCall?.(name, args || {});

            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(
                JSON.stringify({
                  toolResponse: {
                    functionResponses: [
                      {
                        name,
                        id: callId,
                        response: { result: result.message },
                      },
                    ],
                  },
                })
              );
            }
          }
        }
      }

      if (data.error) {
        console.error('[GeminiLive] Server error:', data.error);
        this.onError?.(data.error.message || 'Server error');
      }
    } catch (error: any) {
      console.error('[GeminiLive] Message handling error:', error?.message || error);
    }
  }

  private playAudio(base64Data: string) {
    try {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const int16Data = new Int16Array(bytes.buffer);

      const float32Data = new Float32Array(int16Data.length);
      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0;
      }

      if (!this.playbackCtx) {
        this.playbackCtx = new AudioContext();
      }

      const ctx = this.playbackCtx;
      const buffer = ctx.createBuffer(1, float32Data.length, OUTPUT_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32Data);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      if (this.playbackQueue.length > 0) {
        const lastSource = this.playbackQueue[this.playbackQueue.length - 1];
        const lastEndTime = (lastSource as any)._endTime || now;
        source.start(lastEndTime);
        (source as any)._endTime = lastEndTime + buffer.duration;
      } else {
        source.start(now);
        (source as any)._endTime = now + buffer.duration;
      }

      this.playbackQueue.push(source);

      source.onended = () => {
        const idx = this.playbackQueue.indexOf(source);
        if (idx >= 0) this.playbackQueue.splice(idx, 1);
      };
    } catch (error: any) {
      console.error('[GeminiLive] Audio playback error:', error?.message || error);
    }
  }

  private stopPlayback() {
    for (const source of this.playbackQueue) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.playbackQueue = [];
  }

  muteMic() {
    this.isMicMuted = true;
    console.log('[GeminiLive] Mic muted');
  }

  unmuteMic() {
    this.isMicMuted = false;
    console.log('[GeminiLive] Mic unmuted');
  }

  disconnect() {
    console.log('[GeminiLive] Disconnecting...');

    this.stopPlayback();

    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }

    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    if (this.playbackCtx) {
      this.playbackCtx.close().catch(() => {});
      this.playbackCtx = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.onStateChange?.('disconnected');
  }
}
