import { TOOL_SCHEMAS, executeTool } from './tools';
import { getPromptForState } from './prompts';
import { useSessionStore } from './store';

export type ConnectionState = 'idle' | 'connecting' | 'awaiting_setup' | 'ready' | 'streaming' | 'disconnected' | 'error';

const GEMINI_MODEL = 'models/gemini-3.1-flash-live-preview';
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

      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
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

      // Handle BOTH text (JSON) and binary (protobuf audio) messages
      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            this.handleJsonMessage(JSON.parse(event.data));
          } catch (e) {
            console.error('[GeminiLive] JSON parse error:', e);
          }
        } else if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
          this.handleBinaryMessage(event.data);
        }
      };

      // Send setup
      const currentPhase = useSessionStore.getState().phase;
      const instructions = this.currentInstructions || getPromptForState(currentPhase);

      this.ws.send(JSON.stringify({
        setup: {
          model: GEMINI_MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          },
          systemInstruction: { parts: [{ text: instructions }] },
          tools: { functionDeclarations: TOOL_SCHEMAS },
        },
      }));
      console.log('[GeminiLive] Setup sent');
      this.setState('awaiting_setup');

      await this.initAudioCapture();

    } catch (error: any) {
      console.error('[GeminiLive] Connect failed:', error.message);
      this.setState('error');
      this.onError?.(error.message);
      this.disconnect();
    }
  }

  private handleJsonMessage(msg: any) {
    // AGGRESSIVE LOGGING — log everything
    const msgStr = JSON.stringify(msg);
    console.log('[GeminiLive] RAW JSON:', msgStr.substring(0, 800));

    // Check ALL possible message types
    if (msg.setupComplete !== undefined) {
      console.log('[GeminiLive] ✅ setupComplete detected');
      this.setState('ready');
      setTimeout(() => {
        this.sendClientContent('Begin the IADC session. Introduce yourself briefly and ask me to think about the person I have lost.');
      }, 500);
      return;
    }

    if (msg.serverContent?.modelTurn?.parts) {
      console.log('[GeminiLive] modelTurn parts:', msg.serverContent.modelTurn.parts.length);
      if (this.connectionState === 'ready' || this.connectionState === 'awaiting_setup') {
        this.setState('streaming');
      }
      for (const part of msg.serverContent.modelTurn.parts) {
        if (part.text) {
          console.log('[GeminiLive] AI TEXT:', part.text);
          this.onTranscript?.(part.text, 'ai');
        }
        // Audio comes via binary frames, not inlineData
      }
    }

    if (msg.serverContent?.inputTranscription?.text) {
      this.onTranscript?.(msg.serverContent.inputTranscription.text, 'user');
    }

    if (msg.serverContent?.turnComplete) {
      console.log('[GeminiLive] Turn complete');
      if (this.connectionState === 'streaming') this.setState('ready');
    }

    if (msg.serverContent?.interrupted) {
      console.log('[GeminiLive] Interrupted');
      this.nextPlayTime = 0;
    }

    if (msg.toolCall?.functionCalls) {
      console.log('[GeminiLive] Tool calls:', msg.toolCall.functionCalls.length);
      for (const call of msg.toolCall.functionCalls) {
        console.log('[GeminiLive] Tool:', call.name, JSON.stringify(call.args));
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
      console.error('[GeminiLive] ❌ SERVER ERROR:', JSON.stringify(msg.error));
      this.onError?.(msg.error.message || JSON.stringify(msg.error));
      this.setState('error');
    }
  }

  private async handleBinaryMessage(data: ArrayBuffer | Blob) {
    try {
      let bytes: Uint8Array;
      if (data instanceof Blob) {
        bytes = new Uint8Array(await data.arrayBuffer());
      } else {
        bytes = new Uint8Array(data);
      }
      console.log('[GeminiLive] Binary audio chunk:', bytes.length, 'bytes');
      if (bytes.length >= 2) {
        this.playAudioChunk(bytes);
      }
    } catch (error: any) {
      console.error('[GeminiLive] Binary error:', error.message);
    }
  }

  private sendClientContent(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true },
      }));
      console.log('[GeminiLive] Sent clientContent:', text.substring(0, 60));
    }
  }

  private playAudioChunk(bytes: Uint8Array) {
    try {
      if (!this.playbackCtx) {
        this.playbackCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
        this.nextPlayTime = 0;
      }
      if (this.playbackCtx.state === 'suspended') {
        this.playbackCtx.resume();
      }

      const pcm16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
      if (pcm16.length === 0) return;

      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      const buffer = this.playbackCtx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);

      const source = this.playbackCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.playbackCtx.destination);

      const now = this.playbackCtx.currentTime;
      if (this.nextPlayTime < now) this.nextPlayTime = now;
      source.start(this.nextPlayTime);
      this.nextPlayTime += buffer.duration;

      if (this.connectionState !== 'streaming') {
        this.setState('streaming');
      }
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
    // CRITICAL: Do NOT connect processor to destination — prevents feedback loop
    // processor.connect(this.audioCtx.destination);  // REMOVED
    this.processorNode = processor;

    console.log('[GeminiLive] Capture ready (mic:', micRate, '→ 16kHz, no local playback)');
  }

  muteMic() { this.isMicMuted = true; console.log('[GeminiLive] Mic muted'); }
  unmuteMic() { this.isMicMuted = false; console.log('[GeminiLive] Mic unmuted'); }

  disconnect() {
    console.log('[GeminiLive] Disconnecting...');
    this.audioBuffer = new Float32Array(0);
    this.nextPlayTime = 0;
    if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
    if (this.audioCtx) { this.audioCtx.close().catch(() => {}); this.audioCtx = null; }
    if (this.playbackCtx) { this.playbackCtx.close().catch(() => {}); this.playbackCtx = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.setState('disconnected');
  }
}
