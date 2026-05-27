/**
 * Inworld AI Realtime Client
 * Uses Inworld's Realtime API with Basic Auth
 * Connects to wss://api.inworld.ai/v1/realtime
 * 
 * API key format: base64 encoded "key:secret"
 * Auth: Basic Auth via WebSocket sub-protocol
 */

import { useSessionStore } from './store';
import { getPromptForState } from './prompts';
import { TOOL_SCHEMAS, executeTool } from './tools';
import type { ConnectionState } from '@/types';

const INWORLD_API_KEY = process.env.NEXT_PUBLIC_INWORLD_API_KEY || '';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// ── Audio Streamer ──────────────────────────────────────────────────────────
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
    this.gainNode.gain.value = 1.0;
    this.gainNode.connect(this.context.destination);
  }

  private processPCM16Chunk(chunk: Uint8Array): Float32Array {
    const float32Array = new Float32Array(chunk.length / 2);
    const dataView = new DataView(chunk.buffer);
    for (let i = 0; i < chunk.length / 2; i++) {
      float32Array[i] = dataView.getInt16(i * 2, true) / 32768;
    }
    return float32Array;
  }

  addPCM16(chunk: Uint8Array) {
    if (chunk.length === 0) return;
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

// ── Audio Recorder ──────────────────────────────────────────────────────────
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

    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;

    this.processor.onaudioprocess = (e) => {
      if (!this.onDataCallback || this.muted) return;
      const input = e.inputBuffer.getChannelData(0);
      const combined = new Float32Array(this.buffer.length + input.length);
      combined.set(this.buffer);
      combined.set(input, this.buffer.length);
      this.buffer = combined;

      const CHUNK_SAMPLES = 1600;
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

  setMuted(muted: boolean) { this.muted = muted; }
}

// ── Helper ───────────────────────────────────────────────────────────────────
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Main Inworld AI Realtime Client ─────────────────────────────────────────
export class InworldClient {
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

      if (!INWORLD_API_KEY) {
        throw new Error('NEXT_PUBLIC_INWORLD_API_KEY is not set');
      }

      // Inworld uses Basic Auth — the key IS the base64 encoded "key:secret"
      // WebSocket sub-protocol for auth
      this.ws = new WebSocket(`wss://api.inworld.ai/v1/realtime`, [
        'basic',
        INWORLD_API_KEY
      ]);

      await new Promise<void>((resolve, reject) => {
        if (!this.ws) return reject(new Error('WebSocket not created'));
        const timeout = setTimeout(() => {
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            reject(new Error('Connection timeout after 15s'));
          }
        }, 15000);

        this.ws.onopen = () => {
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            clearTimeout(timeout);
            resolve();
          }
        };
        this.ws.onerror = () => {
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            clearTimeout(timeout);
            reject(new Error('WebSocket connection failed — check API key'));
          }
        };
        this.ws.onclose = (event) => {
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            clearTimeout(timeout);
            reject(new Error(`Closed (${event.code}): ${event.reason || 'Unknown'}`));
          } else {
            this.setState('disconnected');
          }
        };
      });

      // Handle messages
      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            this.handleJsonMessage(msg);
          } catch (e) {
            console.error('[Inworld] JSON parse error:', e);
          }
        } else {
          const bytes = new Uint8Array(event.data as ArrayBuffer);
          if (bytes.length > 0) {
            this.getOrCreateAudioStreamer().addPCM16(bytes);
          }
        }
      };

      // Send session configuration
      const store = useSessionStore.getState();
      const instructions = getPromptForState(store.phase, store.day);

      const sessionConfig = {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: instructions,
          voice: 'default',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
          tools: TOOL_SCHEMAS.map(schema => ({
            type: 'function',
            ...schema,
          })),
        },
      };

      this.ws.send(JSON.stringify(sessionConfig));

      // Start audio capture
      this.audioRecorder = new AudioRecorder(INPUT_SAMPLE_RATE);
      this.audioRecorder.onData((base64) => { this.sendAudioChunk(base64); });
      await this.audioRecorder.start();

      // Send initial prompt
      setTimeout(() => {
        this.sendClientContent('Begin the IADC session. Introduce yourself briefly and ask me to think about the person I have lost.');
      }, 1000);

    } catch (error: any) {
      console.error('[Inworld] Connect failed:', error.message);
      this.onError?.(error.message || 'Connection failed');
      this.setState('error');
      this.disconnect();
    }
  }

  private handleJsonMessage(msg: any) {
    console.log('[Inworld] Message type:', msg.type);

    if (msg.type === 'session.created' || msg.type === 'session.ready') {
      this.setState('ready');
      return;
    }

    if (msg.type === 'response.done') {
      if (this.getState() === 'streaming') this.setState('ready');
      return;
    }

    if (msg.type === 'response.audio.delta') {
      if (msg.delta?.audio) {
        const bytes = base64ToUint8Array(msg.delta.audio);
        this.getOrCreateAudioStreamer().addPCM16(bytes);
      }
      if (this.getState() === 'ready') this.setState('streaming');
      return;
    }

    if (msg.type === 'response.audio_transcript.delta') {
      if (msg.delta?.text) this.onTranscript?.(msg.delta.text, 'ai');
      return;
    }

    if (msg.type === 'conversation.item.input_audio_transcription.completed') {
      if (msg.transcript) this.onTranscript?.(msg.transcript, 'user');
      return;
    }

    if (msg.type === 'response.function_call_arguments.done') {
      this.handleToolCall(msg);
      return;
    }

    if (msg.type === 'error') {
      console.error('[Inworld] Error:', msg.error);
      this.onError?.(msg.error?.message || 'Unknown error');
      this.setState('error');
    }
  }

  private handleToolCall(msg: any) {
    const callId = msg.call_id;
    const name = msg.name;
    const argsStr = msg.arguments;
    if (!name) return;

    try {
      const args = JSON.parse(argsStr || '{}');
      const result = executeTool(name, args);

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) },
        }));
        this.ws.send(JSON.stringify({ type: 'response.create' }));
      }
    } catch (e) {
      console.error('[Inworld] Tool call error:', e);
    }
  }

  private getState(): ConnectionState {
    return useSessionStore.getState().connectionState;
  }

  public sendClientContent(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      }));
      this.ws.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  sendAudioChunk(pcm16Base64: string) {
    if (this.isMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcm16Base64 }));
  }

  muteMic() { this.isMuted = true; this.audioRecorder?.setMuted(true); }
  unmuteMic() { this.isMuted = false; this.audioRecorder?.setMuted(false); }

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
