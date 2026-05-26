import { TOOL_SCHEMAS, executeTool } from './tools';
import { getPromptForState } from './prompts';
import { useSessionStore } from './store';

export type ConnectionState = 'idle' | 'connecting' | 'awaiting_setup' | 'ready' | 'streaming' | 'disconnected' | 'error';

const GEMINI_MODEL = 'gemini-3.1-flash-live-preview';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const PROCESSOR_BUFFER_SIZE = 2048;
const SEND_SAMPLES = INPUT_SAMPLE_RATE / 10;

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
  nextPlayTime = 0;
  connectionState: ConnectionState = 'idle';
  isMicMuted = false;

  private audioBuffer: Float32Array = new Float32Array(0);
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
      if (!apiKey) throw new Error('NEXT_PUBLIC_GEMINI_API_KEY missing');

      // FIX: Use v1beta, not v1alpha
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      console.log('[GeminiLive] Connecting...');
      this.ws = new WebSocket(wsUrl);

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
        this.ws.onerror = (err) => console.error('[GeminiLive] WS error:', err);
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

      // FIX: Use "config" not "setup", correct structure
      const currentPhase = useSessionStore.getState().phase;
      const instructions = this.currentInstructions || getPromptForState(currentPhase);

      const configMessage = {
        config: {
          model: `models/${GEMINI_MODEL}`,
          responseModalities: ['AUDIO'],
          systemInstruction: {
            parts: [{ text: instructions }]
          },
          generationConfig: {
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Puck'
                }
              }
            }
          },
          tools: [
            {
              functionDeclarations: TOOL_SCHEMAS
            }
          ]
        }
      };

      this.ws.send(JSON.stringify(configMessage));
      console.log('[GeminiLive] Config sent:', JSON.stringify(configMessage).substring(0, 200));
      this.setState('awaiting_setup');

      // Handle messages
      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            console.log('[GeminiLive] Received:', JSON.stringify(msg).substring(0, 500));
            this.handleJsonMessage(msg);
          } catch (e) {
            console.error('[GeminiLive] JSON parse error:', e);
          }
        } else {
          // Binary messages — log size, likely keepalive not audio
          const size = event.data instanceof ArrayBuffer ? event.data.byteLength : event.data.size;
          console.log('[GeminiLive] Binary:', size, 'bytes');
        }
      };

      await this.initAudioCapture();

    } catch (error: any) {
      console.error('[GeminiLive] Connect failed:', error.message);
      this.setState('error');
      this.onError?.(error.message);
      this.disconnect();
    }
  }

  private handleJsonMessage(msg: any) {
    if (msg.setupComplete !== undefined) {
      console.log('[GeminiLive] ✅ Setup confirmed');
      this.setState('ready');
      setTimeout(() => {
        this.sendClientContent('Begin the IADC session. Introduce yourself briefly and ask me to think about the person I have lost.');
      }, 500);
      return;
    }

    if (msg.serverContent?.modelTurn?.parts) {
      if (this.connectionState === 'ready' || this.connectionState === 'awaiting_setup') {
        this.setState('streaming');
      }
      for (const part of msg.serverContent.modelTurn.parts) {
        if (part.text) {
          console.log('[GeminiLive] AI:', part.text);
          this.onTranscript?.(part.text, 'ai');
        }
        // Audio arrives as base64 inlineData in JSON for this model
        if (part.inlineData?.data && part.inlineData?.mimeType?.startsWith('audio/')) {
          const binary = Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0));
          console.log('[GeminiLive] Audio part:', binary.length, 'bytes');
          this.playAudioChunk(binary);
        }
      }
    }

    if (msg.serverContent?.inputTranscription?.text) {
      this.onTranscript?.(msg.serverContent.inputTranscription.text, 'user');
    }

    if (msg.serverContent?.turnComplete && this.connectionState === 'streaming') {
      this.setState('ready');
    }

    if (msg.serverContent?.interrupted) {
      this.nextPlayTime = 0;
    }

    if (msg.toolCall?.functionCalls) {
      for (const call of msg.toolCall.functionCalls) {
        const result = executeTool(call.name, call.args || {});
        this.onToolCall?.(call.name, call.args || {}, call.id);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            toolResponse: {
              functionResponses: [{ name: call.name, id: call.id, response: { result: result.message } }],
            },
          }));
        }
      }
    }

    if (msg.error) {
      console.error('[GeminiLive] ❌ Server error:', JSON.stringify(msg.error));
      this.onError?.(msg.error.message || JSON.stringify(msg.error));
      this.setState('error');
    }
  }

  private sendClientContent(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true },
      }));
      console.log('[GeminiLive] Sent:', text.substring(0, 60));
    }
  }

  private playAudioChunk(bytes: Uint8Array) {
    try {
      if (!this.playbackCtx) {
        this.playbackCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
        this.nextPlayTime = 0;
      }
      if (this.playbackCtx.state === 'suspended') this.playbackCtx.resume();

      const pcm16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
      if (pcm16.length === 0) return;

      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

      const buffer = this.playbackCtx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);

      const source = this.playbackCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.playbackCtx.destination);

      const now = this.playbackCtx.currentTime;
      if (this.nextPlayTime < now) this.nextPlayTime = now;
      source.start(this.nextPlayTime);
      this.nextPlayTime += buffer.duration;
    } catch (error: any) {
      console.error('[GeminiLive] Playback error:', error.message);
    }
  }

  private async initAudioCapture() {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });

    this.audioCtx = new AudioContext();
    const micRate = this.audioCtx.sampleRate;
    this.sourceNode = this.audioCtx.createMediaStreamSource(this.micStream);

    const processor = this.audioCtx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
    const ratio = micRate / INPUT_SAMPLE_RATE;

    processor.onaudioprocess = (e) => {
      if (this.isMicMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      const downsampled: number[] = [];
      for (let i = 0; i < input.length; i += ratio) {
        downsampled.push(input[Math.floor(i)]);
      }

      const newBuf = new Float32Array(this.audioBuffer.length + downsampled.length);
      newBuf.set(this.audioBuffer);
      newBuf.set(downsampled, this.audioBuffer.length);
      this.audioBuffer = newBuf;

      while (this.audioBuffer.length >= SEND_SAMPLES) {
        const chunk = this.audioBuffer.slice(0, SEND_SAMPLES);
        this.audioBuffer = this.audioBuffer.slice(SEND_SAMPLES);

        const pcm16 = new Int16Array(chunk.length);
        for (let i = 0; i < chunk.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(chunk[i] * 32767)));
        }

        this.ws.send(JSON.stringify({
          realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: int16ArrayToBase64(pcm16) } },
        }));
      }
    };

    this.sourceNode.connect(processor);
    // NO connect to destination — prevents feedback loop
    this.processorNode = processor;
    console.log('[GeminiLive] Capture ready');
  }

  muteMic() { this.isMicMuted = true; }
  unmuteMic() { this.isMicMuted = false; }

  disconnect() {
    this.audioBuffer = new Float32Array(0);
    this.nextPlayTime = 0;
    if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
    if (this.audioCtx) { this.audioCtx.close().catch(() => {}); this.audioCtx = null; }
    if (this.playbackCtx) { this.playbackCtx.close().catch(() => {}); this.playbackCtx = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.setState('disconnected');
  }
}
