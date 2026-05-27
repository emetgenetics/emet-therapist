/**
 * Inworld Realtime API Client
 * Uses the OpenAI Realtime API JSON schema over WebSocket.
 *
 * Flow:
 * 1. Fetch API key from /api/token
 * 2. Connect to wss://api.inworld.ai/api/v1/realtime/session?key=<key>&protocol=realtime
 * 3. Send/receive OpenAI Realtime JSON events (session.update, input_audio_buffer.append, response.create, etc.)
 */

import { useSessionStore } from './store';
import type { ConnectionState } from '@/types';

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const REALTIME_URL = 'wss://api.inworld.ai/api/v1/realtime/session';

// ── Audio Streamer (plays PCM16 audio from AI) ──────────────────────────────
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

// ── Audio Recorder (captures mic audio and sends as PCM16) ───────────────────
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

// ── Main Inworld Realtime Client ─────────────────────────────────────────────
export class InworldClient {
  ws: WebSocket | null = null;
  private audioStreamer: AudioStreamer | null = null;
  private audioRecorder: AudioRecorder | null = null;
  private audioOutCtx: AudioContext | null = null;
  private isMuted = false;
  private connectionResolved = false;
  private apiKey: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: number | null = null;

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

  // ── Convert ArrayBuffer to base64 ──────────────────────────────────────────
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // ── Send a JSON event to the Realtime API ───────────────────────────────────
  sendEvent(event: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  // ── Connect to Inworld Realtime API ─────────────────────────────────────────
  async connect() {
    try {
      this.setState('connecting');
      this.connectionResolved = false;
      this.reconnectAttempts = 0;

      // Step 1: Get API key from our backend
      console.log('[Inworld] Getting API key...');
      const tokenRes = await fetch('/api/token');
      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        throw new Error(err.error || 'Failed to get API key');
      }
      const tokenData = await tokenRes.json();
      this.apiKey = tokenData.apiKey;
      console.log('[Inworld] API key received');

      // Step 2: Connect to Inworld Realtime WebSocket
      await this.connectWebSocket();

      // Step 3: Configure the session
      this.sendEvent({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          voice: 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: { type: 'server_vad' },
          instructions: 'You are a compassionate IADC therapy assistant. Help the user through their therapy session with empathy and care.',
        },
      });

      // Step 4: Start audio capture
      this.audioRecorder = new AudioRecorder(INPUT_SAMPLE_RATE);
      this.audioRecorder.onData((data) => {
        this.sendAudioRaw(data);
      });
      await this.audioRecorder.start();
      console.log('[Inworld] Audio capture started');

      this.setState('ready');

    } catch (error: any) {
      console.error('[Inworld] Connect failed:', error.message);
      this.onError?.(error.message || 'Connection failed');
      this.setState('error');
      this.disconnect();
    }
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${REALTIME_URL}?key=${this.apiKey}&protocol=realtime`;
      console.log('[Inworld] Connecting to:', url.substring(0, 80) + '...');

      this.ws = new WebSocket(url);

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
          this.reconnectAttempts = 0;
          resolve();
        }
      };

      this.ws.onerror = () => {
        console.error('[Inworld] WebSocket error');
        if (!this.connectionResolved) {
          this.connectionResolved = true;
          clearTimeout(timeout);
          reject(new Error('WebSocket connection failed'));
        }
      };

      this.ws.onclose = (event) => {
        console.log('[Inworld] WebSocket closed:', event.code, event.reason);
        if (!this.connectionResolved) {
          this.connectionResolved = true;
          clearTimeout(timeout);
          reject(new Error(`Closed (${event.code}): ${event.reason || 'Unknown'}`));
        } else {
          this.setState('disconnected');
          this.attemptReconnect();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('[Inworld] JSON parse error:', e);
        }
      };
    });
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Inworld] Max reconnect attempts reached');
      this.onError?.('Connection lost. Please try again.');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    console.log(`[Inworld] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.setState('disconnected');

    this.reconnectTimeout = window.setTimeout(async () => {
      try {
        await this.connectWebSocket();
        this.setState('ready');
      } catch (err: any) {
        console.error('[Inworld] Reconnect failed:', err.message);
        this.attemptReconnect();
      }
    }, delay);
  }

  // ── Handle incoming Realtime API events ─────────────────────────────────────
  private handleMessage(msg: any) {
    const eventType = msg.type;
    console.log('[Inworld] Event:', eventType);

    // Session created/updated
    if (eventType === 'session.created' || eventType === 'session.updated') {
      console.log('[Inworld] Session ready:', msg.session?.id);
    }

    // Audio delta from AI
    if (eventType === 'response.audio.delta') {
      const audioBase64 = msg.delta;
      if (audioBase64) {
        const binary = atob(audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        this.getOrCreateAudioStreamer().addPCM16(bytes);
      }
    }

    // AI text transcript
    if (eventType === 'response.audio_transcript.delta') {
      if (msg.delta) {
        this.onTranscript?.(msg.delta, 'ai');
      }
    }

    // User transcription
    if (eventType === 'conversation.item.input_audio_transcription.completed') {
      if (msg.transcript) {
        this.onTranscript?.(msg.transcript, 'user');
      }
    }

    // Response complete
    if (eventType === 'response.done') {
      console.log('[Inworld] Response complete');
    }

    // Error
    if (eventType === 'error') {
      console.error('[Inworld] API error:', msg.error);
      this.onError?.(msg.error?.message || 'Unknown error');
    }
  }

  // ── Send audio data ─────────────────────────────────────────────────────────
  sendAudioRaw(arrayBuffer: ArrayBuffer) {
    if (this.isMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const base64 = this.arrayBufferToBase64(arrayBuffer);
    this.sendEvent({
      type: 'input_audio_buffer.append',
      audio: base64,
    });
  }

  // ── Send text message ───────────────────────────────────────────────────────
  sendText(text: string) {
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });
    this.sendEvent({ type: 'response.create' });
    console.log('[Inworld] Sent text:', text.substring(0, 80));
  }

  // ── Controls ────────────────────────────────────────────────────────────────
  muteMic() { this.isMuted = true; this.audioRecorder?.setMuted(true); }
  unmuteMic() { this.isMuted = false; this.audioRecorder?.setMuted(false); }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.audioRecorder?.stop();
    this.audioRecorder = null;
    this.audioStreamer?.stop();
    this.audioStreamer = null;
    if (this.ws) {
      this.ws.onclose = null; // prevent reconnect
      this.ws.close();
      this.ws = null;
    }
    this.audioOutCtx?.close();
    this.audioOutCtx = null;
    this.setState('disconnected');
  }
}
