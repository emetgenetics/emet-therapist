/**
 * Inworld AI Realtime Client
 * Uses @inworld/web-core SDK for browser-based WebSocket connection
 * 
 * Flow:
 * 1. Call /api/token to get a session token (server-side gRPC)
 * 2. Connect to wss://studio.inworld.ai/v1/session/open via WebSocket
 * 3. Send/receive JSON-serialized InworldPacket messages
 */

import { useSessionStore } from './store';
import { getPromptForState } from './prompts';
import { TOOL_SCHEMAS, executeTool } from './tools';
import type { ConnectionState } from '@/types';

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const INWORLD_WS_HOSTNAME = 'studio.inworld.ai';
const SESSION_PATH = '/v1/session/open';

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
  private onDataCallback: ((data: ArrayBuffer) => void) | null = null;
  private buffer: Float32Array = new Float32Array(0);
  private muted = false;

  constructor(public sampleRate = INPUT_SAMPLE_RATE) {}

  onData(callback: (data: ArrayBuffer) => void) { this.onDataCallback = callback; }

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
        this.onDataCallback(pcm16.buffer);
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

// ── Main Inworld Client ─────────────────────────────────────────────────────
export class InworldClient {
  ws: WebSocket | null = null;
  private audioStreamer: AudioStreamer | null = null;
  private audioRecorder: AudioRecorder | null = null;
  private audioOutCtx: AudioContext | null = null;
  private isMuted = false;
  private connectionResolved = false;
  private sessionId: string | null = null;
  private sessionToken: string | null = null;
  private sessionType: string | null = null;

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

      // Step 1: Get session token from our backend
      console.log('[Inworld] Getting session token...');
      const tokenRes = await fetch('/api/token');
      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        throw new Error(err.error || 'Failed to get session token');
      }
      const tokenData = await tokenRes.json();
      this.sessionId = tokenData.sessionId;
      this.sessionToken = tokenData.token;
      this.sessionType = tokenData.type;
      console.log('[Inworld] Token received, sessionId:', this.sessionId);

      // Step 2: Connect to Inworld WebSocket
      const wsUrl = `wss://${INWORLD_WS_HOSTNAME}${SESSION_PATH}?session_id=${this.sessionId}`;
      console.log('[Inworld] Connecting to:', wsUrl);
      this.ws = new WebSocket(wsUrl, [this.sessionType!, this.sessionToken!]);

      await new Promise<void>((resolve, reject) => {
        if (!this.ws) return reject(new Error('WebSocket not created'));
        const timeout = setTimeout(() => {
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            reject(new Error('Connection timeout after 15s'));
          }
        }, 15000);

        this.ws.onopen = () => {
          console.log('[Inworld] WebSocket open');
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
            reject(new Error('WebSocket connection failed'));
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
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('[Inworld] JSON parse error:', e);
        }
      };

      // Start audio capture
      this.audioRecorder = new AudioRecorder(INPUT_SAMPLE_RATE);
      this.audioRecorder.onData((data) => { this.sendAudioRaw(data); });
      await this.audioRecorder.start();
      console.log('[Inworld] Audio capture started');

      this.setState('ready');

      // Send initial text to start the session
      setTimeout(() => {
        this.sendText('Hello, I am here for an IADC therapy session.');
      }, 500);

    } catch (error: any) {
      console.error('[Inworld] Connect failed:', error.message);
      this.onError?.(error.message || 'Connection failed');
      this.setState('error');
      this.disconnect();
    }
  }

  private handleMessage(msg: any) {
    console.log('[Inworld] Message:', JSON.stringify(msg).substring(0, 200));

    // Text response from AI
    if (msg.text?.text) {
      this.onTranscript?.(msg.text.text, 'ai');
    }

    // Audio response
    if (msg.audio?.chunk) {
      // Audio chunk is base64 encoded PCM16
      const binary = atob(msg.audio.chunk);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      this.getOrCreateAudioStreamer().addPCM16(bytes);
    }

    // Control events
    if (msg.control?.action) {
      console.log('[Inworld] Control:', msg.control.action);
    }

    // Tool/function calls
    if (msg.tool_call || msg.function_call) {
      this.handleToolCall(msg);
    }

    // User transcription
    if (msg.transcription?.text) {
      this.onTranscript?.(msg.transcription.text, 'user');
    }
  }

  private handleToolCall(msg: any) {
    const call = msg.tool_call || msg.function_call;
    if (!call?.name) return;

    try {
      const args = typeof call.arguments === 'string' 
        ? JSON.parse(call.arguments) 
        : (call.arguments || {});
      const result = executeTool(call.name, args);

      // Send tool response
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          tool_result: {
            call_id: call.id || call.call_id,
            output: JSON.stringify(result),
          },
        }));
      }
    } catch (e) {
      console.error('[Inworld] Tool call error:', e);
    }
  }

  sendText(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        text: { text },
      }));
      console.log('[Inworld] Sent text:', text.substring(0, 80));
    }
  }

  sendAudioRaw(arrayBuffer: ArrayBuffer) {
    if (this.isMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Convert ArrayBuffer to base64
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    this.ws.send(JSON.stringify({
      audio: { chunk: base64 },
    }));
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
