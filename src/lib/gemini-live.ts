import { TOOL_SCHEMAS, executeTool } from './tools';
import { getPromptForState } from './prompts';
import { useSessionStore } from './store';

export type ConnectionState = 'idle' | 'connecting' | 'awaiting_setup' | 'ready' | 'streaming' | 'disconnected' | 'error';

const GEMINI_MODEL = 'models/gemini-3.1-flash-live-preview';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const PROCESSOR_BUFFER_SIZE = 2048;
const SEND_SAMPLES = INPUT_SAMPLE_RATE / 10; // 160 samples per 100ms

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
  connectionState: ConnectionState = 'idle';
  isMicMuted = false;

  private audioBuffer: Float32Array = new Float32Array(0);
  private playbackQueue: Int16Array[] = [];
  private isPlaying = false;
  private currentInstructions = '';
  private connectionResolved = false;

  onToolCall: ((name: string, args: Record<string, unknown>, callId: string) => void) | null = null;
  onTranscript: ((text: string, speaker: 'ai' | 'user') => void) | null = null;
  onStateChange: ((state: ConnectionState) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  setInstructions(instructions: string) {
    this.currentInstructions = instructions;
  }

  private setState(state: ConnectionState) {
    this.connectionState = state;
    console.log('[GeminiLive] State:', state);
    this.onStateChange?.(state);
  }

  async connect() {
    try {
      this.setState('connecting');
      this.connectionResolved = false;

      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('NEXT_PUBLIC_GEMINI_API_KEY is missing');
      }

      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      console.log('[GeminiLive] Connecting...');
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      await new Promise<void>((resolve, reject) => {
        if (!this.ws) return reject(new Error('WebSocket not created'));

        const timeout = setTimeout(() => {
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            reject(new Error('Connection timeout'));
          }
        }, 10000);

        this.ws.onopen = () => {
          console.log('[GeminiLive] WebSocket open');
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            clearTimeout(timeout);
            resolve();
          }
        };

        this.ws.onerror = (err) => {
          console.error('[GeminiLive] WebSocket error:', err);
        };

        this.ws.onclose = (event) => {
          console.log('[GeminiLive] Closed:', event.code, event.reason);
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            clearTimeout(timeout);
            reject(new Error(`Closed (${event.code}): ${event.reason}`));
          } else {
            this.setState('disconnected');
          }
        };
      });

      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            this.handleJsonMessage(msg);
          } catch (e) {
            console.error('[GeminiLive] JSON parse error:', e);
          }
        } else if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          console.log('[GeminiLive] Binary audio chunk:', bytes.byteLength, 'bytes');
          this.handleAudioChunk(bytes);
        }
      };

      // Send setup
      const currentPhase = useSessionStore.getState().phase;
      const instructions = this.currentInstructions || getPromptForState(currentPhase);

      const setupMessage = {
        setup: {
          model: GEMINI_MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Puck' },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: instructions }],
          },
          tools: {
            functionDeclarations: TOOL_SCHEMAS,
          },
        },
      };

      this.ws.send(JSON.stringify(setupMessage));
      console.log('[GeminiLive] Setup sent');
      this.setState('awaiting_setup');

      // Initialize audio capture
      await this.initAudioCapture();

    } catch (error: any) {
      console.error('[GeminiLive] Connect failed:', error.message);
      this.setState('error');
      this.onError?.(error.message);
      this.disconnect();
    }
  }

  private handleJsonMessage(msg: any) {
    console.log('[GeminiLive] JSON:', Object.keys(msg).join(', '));

    if (msg.setupComplete) {
      console.log('[GeminiLive] Setup complete, sending initial prompt...');
      this.setState('ready');

      // Trigger initial AI response — Gemini does NOT speak first
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          clientContent: {
            turns: [{
              role: 'user',
              parts: [{ text: 'Begin the IADC session. Introduce yourself briefly and ask me to think about the person I have lost.' }],
            }],
            turnComplete: true,
          },
        }));
      }
    }

    if (msg.serverContent?.modelTurn?.parts) {
      this.setState('streaming');
      for (const part of msg.serverContent.modelTurn.parts) {
        // Audio from Gemini (base64 encoded in inlineData)
        if (part.inlineData?.data && part.inlineData?.mimeType?.startsWith('audio/')) {
          const binary = Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0));
          this.handleAudioChunk(binary);
        }
        // Text transcript
        if (part.text) {
          console.log('[GeminiLive] AI:', part.text);
          this.onTranscript?.(part.text, 'ai');
        }
      }
    }

    if (msg.serverContent?.inputTranscription) {
      const text = msg.serverContent.inputTranscription.text;
      if (text) {
        this.onTranscript?.(text, 'user');
      }
    }

    if (msg.serverContent?.turnComplete) {
      console.log('[GeminiLive] Turn complete');
      this.setState('ready');
    }

    if (msg.serverContent?.interrupted) {
      console.log('[GeminiLive] Interrupted');
      this.stopPlayback();
    }

    if (msg.toolCall?.functionCalls) {
      for (const call of msg.toolCall.functionCalls) {
        const result = executeTool(call.name, call.args || {});
        this.onToolCall?.(call.name, call.args || {}, call.id);

        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            toolResponse: {
              functionResponses: [{
                name: call.name,
                id: call.id,
                response: { result: result.message },
              }],
            },
          }));
        }
      }
    }

    if (msg.error) {
      console.error('[GeminiLive] Server error:', msg.error);
      this.onError?.(msg.error.message || 'Server error');
    }
  }

  // ===== AUDIO PLAYBACK =====
  private handleAudioChunk(bytes: Uint8Array) {
    // Convert Uint8Array to Int16Array (PCM16 little-endian from Gemini)
    const pcm16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    this.playbackQueue.push(pcm16);
    this.playNextChunk();
  }

  private playNextChunk() {
    if (this.isPlaying || this.playbackQueue.length === 0) return;
    this.isPlaying = true;

    if (!this.playbackCtx) {
      this.playbackCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    }

    // Resume context if suspended (browser autoplay policy)
    if (this.playbackCtx.state === 'suspended') {
      this.playbackCtx.resume();
    }

    const chunk = this.playbackQueue.shift()!;
    const float32 = new Float32Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      float32[i] = chunk[i] / 32768.0;
    }

    const buffer = this.playbackCtx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const source = this.playbackCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.playbackCtx.destination);
    source.onended = () => {
      this.isPlaying = false;
      this.playNextChunk();
    };
    source.start();
  }

  private stopPlayback() {
    this.playbackQueue = [];
    this.isPlaying = false;
  }

  // ===== AUDIO CAPTURE =====
  private async initAudioCapture() {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });

    // Create audio context at mic's native rate, then resample to 16kHz
    this.audioCtx = new AudioContext();
    const micSampleRate = this.audioCtx.sampleRate; // typically 44100 or 48000
    this.sourceNode = this.audioCtx.createMediaStreamSource(this.micStream);

    const processor = this.audioCtx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
    const downsampleRatio = micSampleRate / INPUT_SAMPLE_RATE;

    processor.onaudioprocess = (e) => {
      if (this.isMicMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const inputData = e.inputBuffer.getChannelData(0);

      // Downsample: pick every Nth sample
      const downsampled: number[] = [];
      for (let i = 0; i < inputData.length; i += downsampleRatio) {
        downsampled.push(inputData[Math.floor(i)]);
      }

      // Accumulate
      const newBuffer = new Float32Array(this.audioBuffer.length + downsampled.length);
      newBuffer.set(this.audioBuffer);
      newBuffer.set(downsampled, this.audioBuffer.length);
      this.audioBuffer = newBuffer;

      // Send 100ms chunks (1600 samples)
      while (this.audioBuffer.length >= SEND_SAMPLES) {
        const chunk = this.audioBuffer.slice(0, SEND_SAMPLES);
        this.audioBuffer = this.audioBuffer.slice(SEND_SAMPLES);

        // Convert float32 to PCM16
        const pcm16 = new Int16Array(chunk.length);
        for (let i = 0; i < chunk.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, chunk[i] * 32767));
        }

        const base64 = int16ArrayToBase64(pcm16);

        this.ws.send(JSON.stringify({
          realtimeInput: {
            audio: {
              mimeType: 'audio/pcm;rate=16000',
              data: base64,
            },
          },
        }));
      }
    };

    this.sourceNode.connect(processor);
    processor.connect(this.audioCtx.destination);
    this.processorNode = processor;

    console.log('[GeminiLive] Audio capture ready (mic:', micSampleRate, '→ 16kHz)');
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
    this.audioBuffer = new Float32Array(0);
    this.playbackQueue = [];

    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
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
    this.setState('disconnected');
  }
}
