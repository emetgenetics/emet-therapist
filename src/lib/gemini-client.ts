/**
 * Gemini Live Client — raw WebSocket implementation
 * Uses ScriptProcessorNode for audio capture (proven reliable)
 * and AudioStreamer for gapless playback.
 */

import { useSessionStore } from './store';
import { getPromptForState } from './prompts';
import { TOOL_SCHEMAS, executeTool } from './tools';
import type { ConnectionState } from '@/types';

const GEMINI_MODEL = 'gemini-3.1-flash-live-preview';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// ── Audio Streamer (from Google reference repo) ──────────────────────────
class AudioStreamer {
  private sampleRate: number = OUTPUT_SAMPLE_RATE;
  private bufferSize: number = 7680;
  private audioQueue: Float32Array[] = [];
  private isPlaying: boolean = false;
  private isStreamComplete: boolean = false;
  private checkInterval: number | null = null;
  private scheduledTime: number = 0;
  private initialBufferTime: number = 0.1;
  public gainNode: GainNode;
  private endOfQueueAudioSource: AudioBufferSourceNode | null = null;
  public onComplete = () => {};

  constructor(public context: AudioContext) {
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);
  }

  private processPCM16Chunk(chunk: Uint8Array): Float32Array {
    const float32Array = new Float32Array(chunk.length / 2);
    const dataView = new DataView(chunk.buffer);
    for (let i = 0; i < chunk.length / 2; i++) {
      try { float32Array[i] = dataView.getInt16(i * 2, true) / 32768; } catch (e) { console.error(e); }
    }
    return float32Array;
  }

  addPCM16(chunk: Uint8Array) {
    this.isStreamComplete = false;
    let processingBuffer = this.processPCM16Chunk(chunk);
    while (processingBuffer.length >= this.bufferSize) {
      this.audioQueue.push(processingBuffer.slice(0, this.bufferSize));
      processingBuffer = processingBuffer.slice(this.bufferSize);
    }
    if (processingBuffer.length > 0) { this.audioQueue.push(processingBuffer); }
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.scheduledTime = this.context.currentTime + this.initialBufferTime;
      this.scheduleNextBuffer();
    }
  }

  private createAudioBuffer(audioData: Float32Array): AudioBuffer {
    const audioBuffer = this.context.createBuffer(1, audioData.length, this.sampleRate);
    audioBuffer.getChannelData(0).set(audioData);
    return audioBuffer;
  }

  private scheduleNextBuffer() {
    const SCHEDULE_AHEAD_TIME = 0.2;
    while (this.audioQueue.length > 0 && this.scheduledTime < this.context.currentTime + SCHEDULE_AHEAD_TIME) {
      const audioData = this.audioQueue.shift()!;
      const audioBuffer = this.createAudioBuffer(audioData);
      const source = this.context.createBufferSource();
      if (this.audioQueue.length === 0) {
        if (this.endOfQueueAudioSource) { this.endOfQueueAudioSource.onended = null; }
        this.endOfQueueAudioSource = source;
        source.onended = () => {
          if (!this.audioQueue.length && this.endOfQueueAudioSource === source) {
            this.endOfQueueAudioSource = null; this.onComplete();
          }
        };
      }
      source.buffer = audioBuffer;
      source.connect(this.gainNode);
      const startTime = Math.max(this.scheduledTime, this.context.currentTime);
      source.start(startTime);
      this.scheduledTime = startTime + audioBuffer.duration;
    }
    if (this.audioQueue.length === 0) {
      if (this.isStreamComplete) {
        this.isPlaying = false;
        if (this.checkInterval) { clearInterval(this.checkInterval); this.checkInterval = null; }
      } else if (!this.checkInterval) {
        this.checkInterval = window.setInterval(() => {
          if (this.audioQueue.length > 0) { this.scheduleNextBuffer(); }
        }, 100) as unknown as number;
      }
    } else {
      const nextCheckTime = (this.scheduledTime - this.context.currentTime) * 1000;
      setTimeout(() => this.scheduleNextBuffer(), Math.max(0, nextCheckTime - 50));
    }
  }

  stop() {
    this.isPlaying = false; this.isStreamComplete = true; this.audioQueue = [];
    this.scheduledTime = this.context.currentTime;
    if (this.checkInterval) { clearInterval(this.checkInterval); this.checkInterval = null; }
    this.gainNode.gain.linearRampToValueAtTime(0, this.context.currentTime + 0.1);
    setTimeout(() => {
      this.gainNode.disconnect();
      this.gainNode = this.context.createGain();
      this.gainNode.connect(this.context.destination);
    }, 200);
  }

  async resume() {
    if (this.context.state === 'suspended') { await this.context.resume(); }
    this.isStreamComplete = false;
    this.scheduledTime = this.context.currentTime + this.initialBufferTime;
    this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
  }
}

// ── Audio Recorder using ScriptProcessorNode (BUG 2 fix) ─────────────────
class AudioRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;
  private onDataCallback: ((base64: string) => void) | null = null;
  private buffer: Float32Array = new Float32Array(0);
  private muted = false;

  constructor(public sampleRate = INPUT_SAMPLE_RATE) {}

  onData(callback: (base64: string) => void) { this.onDataCallback = callback; }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    // Silent gain to force Chrome to run the processor without feedback
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;

    this.processor.onaudioprocess = (e) => {
      if (!this.onDataCallback || this.muted) return;
      const input = e.inputBuffer.getChannelData(0);
      const combined = new Float32Array(this.buffer.length + input.length);
      combined.set(this.buffer);
      combined.set(input, this.buffer.length);
      this.buffer = combined;

      const CHUNK_SAMPLES = 1600; // 100ms at 16kHz
      while (this.buffer.length >= CHUNK_SAMPLES) {
        const chunk = this.buffer.slice(0, CHUNK_SAMPLES);
        this.buffer = this.buffer.slice(CHUNK_SAMPLES);
        const pcm16 = new Int16Array(chunk.length);
        for (let i = 0; i < chunk.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(chunk[i] * 32767)));
        }
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        this.onDataCallback(btoa(binary));
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.audioContext.destination);
  }

  stop() {
    this.processor?.disconnect();
    this.silentGain?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.audioContext?.close();
    this.stream = null; this.audioContext = null; this.processor = null;
    this.silentGain = null; this.source = null; this.buffer = new Float32Array(0);
  }
}

// ── Helper ────────────────────────────────────────────────────────────────
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Main Gemini Live Client ──────────────────────────────────────────────
export class GeminiClient {
  ws: WebSocket | null = null;
  private audioStreamer: AudioStreamer | null = null;
  private audioRecorder: AudioRecorder | null = null;
  private audioOutCtx: AudioContext | null = null;
  private isMuted = false;
  private connectionResolved = false;

  onTranscript: ((text: string, speaker: 'ai' | 'user') => void) | null = null;
  onStateChange: ((state: ConnectionState) => void) | null = null;
  onError: ((msg: string) => void) | null = null;

  private setState(state: ConnectionState) {
    useSessionStore.getState().setConnectionState(state);
    this.onStateChange?.(state);
  }

  // BUG 3 fix: lazy AudioContext creation
  private getOrCreateAudioStreamer(): AudioStreamer {
    if (!this.audioOutCtx) {
      this.audioOutCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    }
    if (this.audioOutCtx.state === 'suspended') {
      this.audioOutCtx.resume();
    }
    if (!this.audioStreamer) {
      this.audioStreamer = new AudioStreamer(this.audioOutCtx);
    }
    return this.audioStreamer;
  }

  async connect() {
    try {
      this.setState('connecting');
      this.connectionResolved = false;

      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) throw new Error('NEXT_PUBLIC_GEMINI_API_KEY is not set');

      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      console.log('[Gemini] Connecting...');
      this.ws = new WebSocket(wsUrl);

      await new Promise<void>((resolve, reject) => {
        if (!this.ws) return reject(new Error('WebSocket not created'));
        const timeout = setTimeout(() => {
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            reject(new Error('Connection timeout'));
          }
        }, 15000);

        this.ws.onopen = () => {
          console.log('[Gemini] WebSocket open');
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            clearTimeout(timeout);
            resolve();
          }
        };
        this.ws.onerror = (err) => {
          console.error('[Gemini] WS error:', err);
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            clearTimeout(timeout);
            reject(new Error('WebSocket connection failed'));
          }
        };
        this.ws.onclose = (event) => {
          console.log('[Gemini] Closed:', event.code, event.reason);
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            clearTimeout(timeout);
            reject(new Error(`Closed (${event.code}): ${event.reason}`));
          } else {
            this.setState('disconnected');
          }
        };
      });

      // Handle messages - SET THIS UP BEFORE SENDING SETUP
      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            console.log('[Gemini] JSON message received:', JSON.stringify(msg).substring(0, 200));
            this.handleJsonMessage(msg);
          } catch (e) {
            console.error('[Gemini] JSON parse error:', e);
          }
        } else {
          console.log('[Gemini] Binary message:', event.data?.byteLength || event.data?.size, 'bytes');
        }
      };

      // Send setup message
      const store = useSessionStore.getState();
      const instructions = getPromptForState(store.phase, store.day);

      const setupMessage = {
        setup: {
          model: `models/${GEMINI_MODEL}`,
          generation_config: {
            response_modalities: ['AUDIO'],
            speech_config: {
              voice_config: {
                prebuilt_voice_config: { voice_name: 'Puck' },
              },
            },
          },
          system_instruction: { parts: [{ text: instructions }] },
          tools: [{ function_declarations: TOOL_SCHEMAS }],
        },
      };

      this.ws.send(JSON.stringify(setupMessage));
      console.log('[Gemini] Setup sent');

      // Start audio capture (BUG 2: ScriptProcessorNode)
      this.audioRecorder = new AudioRecorder(INPUT_SAMPLE_RATE);
      this.audioRecorder.onData((base64) => { this.sendAudioChunk(base64); });
      await this.audioRecorder.start();
      console.log('[Gemini] Audio capture started');

      // CRITICAL FIX: If we don't receive setupComplete within 2 seconds, assume ready
      // The Gemini API may not always send setupComplete, but if we're getting binary data, we're connected
      setTimeout(() => {
        if (this.getState() === 'connecting') {
          console.log('[Gemini] ⚠️ No setupComplete received, assuming ready');
          this.setState('ready');
          this.sendClientContent('Begin the IADC session. Introduce yourself briefly and ask me to think about the person I have lost.');
        }
      }, 2000);

    } catch (error: any) {
      console.error('[Gemini] Connect failed:', error.message);
      this.onError?.(error.message || 'Connection failed');
      this.setState('error');
      this.disconnect();
    }
  }

  // BUG 9 fix: Defensive message parsing
  private handleJsonMessage(msg: any) {
    console.log('[Gemini] Message keys:', Object.keys(msg).join(', '));

    // Setup complete — BUG 1: send initial prompt HERE
    if (msg.setupComplete !== undefined) {
      console.log('[Gemini] ✅ Setup confirmed');
      this.setState('ready');
      setTimeout(() => {
        this.sendClientContent('Begin the IADC session. Introduce yourself briefly and ask me to think about the person I have lost.');
      }, 500);
      return;
    }

    // Tool call — BUG 6 fix: update phase context
    if (msg.tool_call?.function_calls) {
      this.handleToolCall(msg.tool_call);
      return;
    }

    // Server content
    if (msg.server_content) {
      const content = msg.server_content;

      // Model turn with parts — BUG 9: defensive checks
      if (content.model_turn?.parts) {
        if (this.getState() === 'ready') { this.setState('streaming'); }
        for (const part of content.model_turn.parts) {
          if (part?.text) {
            console.log('[Gemini] AI:', part.text);
            this.onTranscript?.(part.text, 'ai');
          }
          if (part?.inline_data?.data) {
            const bytes = base64ToUint8Array(part.inline_data.data);
            console.log('[Gemini] Audio part:', bytes.length, 'bytes');
            // BUG 3: lazy AudioContext creation
            this.getOrCreateAudioStreamer().addPCM16(bytes);
          }
        }
      }

      // Input transcription
      if (content.input_transcription?.text) {
        this.onTranscript?.(content.input_transcription.text, 'user');
      }

      // Turn complete
      if (content.turn_complete && this.getState() === 'streaming') {
        this.setState('ready');
      }

      // Interrupted
      if (content.interrupted) {
        this.audioStreamer?.stop();
      }
    }

    // Error
    if (msg.error) {
      console.error('[Gemini] ❌ Server error:', JSON.stringify(msg.error));
      this.onError?.(msg.error.message || JSON.stringify(msg.error));
      this.setState('error');
    }
  }

  // BUG 6 fix: send phase context after transition_state
  private handleToolCall(toolCall: any) {
    if (!toolCall.function_calls) return;
    for (const call of toolCall.function_calls) {
      if (!call.name) continue;
      const result = executeTool(call.name, call.args || {});

      // BUG 6: After phase transition, send context update
      if (call.name === 'transition_state' && this.ws?.readyState === WebSocket.OPEN) {
        const store = useSessionStore.getState();
        setTimeout(() => {
          this.sendClientContent(
            `[SYSTEM: You are now in phase ${store.phase}. Follow the protocol for this phase exactly. Keep responses ultra-minimalist. Use tool calls for all actions.]`
          );
        }, 300);
      }

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          tool_response: {
            function_responses: [{
              name: call.name,
              id: call.id,
              response: { result: result.message },
            }],
          },
        }));
      }
    }
  }

  private getState(): ConnectionState {
    return useSessionStore.getState().connectionState;
  }

  private sendClientContent(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        client_content: { turns: [{ role: 'user', parts: [{ text }] }], turn_complete: true },
      }));
      console.log('[Gemini] Sent:', text.substring(0, 80));
    }
  }

  sendAudioChunk(pcm16Base64: string) {
    if (this.isMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      realtime_input: { audio: { mime_type: 'audio/pcm;rate=16000', data: pcm16Base64 } },
    }));
  }

  muteMic() { this.isMuted = true; }
  unmuteMic() { this.isMuted = false; }

  disconnect() {
    this.audioRecorder?.stop();
    this.audioRecorder = null;
    this.audioStreamer?.stop();
    this.audioStreamer = null;
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.audioOutCtx?.close();
    this.audioOutCtx = null;
    this.setState('disconnected');
  }
}
