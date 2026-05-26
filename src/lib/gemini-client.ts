/**
 * Gemini Live Client — based on Google's live-api-web-console reference
 * https://github.com/google-gemini/live-api-web-console
 *
 * Uses @google/genai SDK live.connect() with proper AudioWorklet capture
 * and AudioStreamer playback matching the reference implementation.
 */

import { GoogleGenAI, Modality, LiveConnectConfig, LiveServerMessage, LiveServerToolCall, LiveClientToolResponse, Part } from '@google/genai';
import { useSessionStore } from './store';
import { getPromptForState } from './prompts';
import { TOOL_SCHEMAS, executeTool } from './tools';
import type { ConnectionState } from '@/types';

// ── Audio Worklet source (from reference repo) ──────────────────────────
const AudioRecordingWorklet = `
class AudioProcessingWorklet extends AudioWorkletProcessor {
  buffer = new Int16Array(2048);
  bufferWriteIndex = 0;

  constructor() {
    super();
    this.hasAudio = false;
  }

  process(inputs) {
    if (inputs[0].length) {
      const channel0 = inputs[0][0];
      this.processChunk(channel0);
    }
    return true;
  }

  sendAndClearBuffer() {
    this.port.postMessage({
      event: "chunk",
      data: {
        int16arrayBuffer: this.buffer.slice(0, this.bufferWriteIndex).buffer,
      },
    });
    this.bufferWriteIndex = 0;
  }

  processChunk(float32Array) {
    const l = float32Array.length;
    for (let i = 0; i < l; i++) {
      const int16Value = float32Array[i] * 32768;
      this.buffer[this.bufferWriteIndex++] = int16Value;
      if (this.bufferWriteIndex >= this.buffer.length) {
        this.sendAndClearBuffer();
      }
    }
    if (this.bufferWriteIndex >= this.buffer.length) {
      this.sendAndClearBuffer();
    }
  }
}
`;

// ── Audio Streamer (from reference repo, adapted) ────────────────────────
class AudioStreamer {
  private sampleRate: number = 24000;
  private bufferSize: number = 7680;
  private audioQueue: Float32Array[] = [];
  private isPlaying: boolean = false;
  private isStreamComplete: boolean = false;
  private checkInterval: number | null = null;
  private scheduledTime: number = 0;
  private initialBufferTime: number = 0.1;

  public gainNode: GainNode;
  public source: AudioBufferSourceNode;
  private endOfQueueAudioSource: AudioBufferSourceNode | null = null;

  public onComplete = () => {};

  constructor(public context: AudioContext) {
    this.gainNode = this.context.createGain();
    this.source = this.context.createBufferSource();
    this.gainNode.connect(this.context.destination);
    this.addPCM16 = this.addPCM16.bind(this);
  }

  private processPCM16Chunk(chunk: Uint8Array): Float32Array {
    const float32Array = new Float32Array(chunk.length / 2);
    const dataView = new DataView(chunk.buffer);
    for (let i = 0; i < chunk.length / 2; i++) {
      try {
        const int16 = dataView.getInt16(i * 2, true);
        float32Array[i] = int16 / 32768;
      } catch (e) {
        console.error(e);
      }
    }
    return float32Array;
  }

  addPCM16(chunk: Uint8Array) {
    this.isStreamComplete = false;
    let processingBuffer = this.processPCM16Chunk(chunk);
    while (processingBuffer.length >= this.bufferSize) {
      const buffer = processingBuffer.slice(0, this.bufferSize);
      this.audioQueue.push(buffer);
      processingBuffer = processingBuffer.slice(this.bufferSize);
    }
    if (processingBuffer.length > 0) {
      this.audioQueue.push(processingBuffer);
    }
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

    while (
      this.audioQueue.length > 0 &&
      this.scheduledTime < this.context.currentTime + SCHEDULE_AHEAD_TIME
    ) {
      const audioData = this.audioQueue.shift()!;
      const audioBuffer = this.createAudioBuffer(audioData);
      const source = this.context.createBufferSource();

      if (this.audioQueue.length === 0) {
        if (this.endOfQueueAudioSource) {
          this.endOfQueueAudioSource.onended = null;
        }
        this.endOfQueueAudioSource = source;
        source.onended = () => {
          if (!this.audioQueue.length && this.endOfQueueAudioSource === source) {
            this.endOfQueueAudioSource = null;
            this.onComplete();
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
        if (this.checkInterval) {
          clearInterval(this.checkInterval);
          this.checkInterval = null;
        }
      } else {
        if (!this.checkInterval) {
          this.checkInterval = window.setInterval(() => {
            if (this.audioQueue.length > 0) {
              this.scheduleNextBuffer();
            }
          }, 100) as unknown as number;
        }
      }
    } else {
      const nextCheckTime = (this.scheduledTime - this.context.currentTime) * 1000;
      setTimeout(() => this.scheduleNextBuffer(), Math.max(0, nextCheckTime - 50));
    }
  }

  stop() {
    this.isPlaying = false;
    this.isStreamComplete = true;
    this.audioQueue = [];
    this.scheduledTime = this.context.currentTime;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.gainNode.gain.linearRampToValueAtTime(0, this.context.currentTime + 0.1);
    setTimeout(() => {
      this.gainNode.disconnect();
      this.gainNode = this.context.createGain();
      this.gainNode.connect(this.context.destination);
    }, 200);
  }

  async resume() {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    this.isStreamComplete = false;
    this.scheduledTime = this.context.currentTime + this.initialBufferTime;
    this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
  }

  complete() {
    this.isStreamComplete = true;
    this.onComplete();
  }
}

// ── Audio Recorder using AudioWorklet (from reference repo) ──────────────
class AudioRecorder {
  stream: MediaStream | undefined;
  audioContext: AudioContext | undefined;
  source: MediaStreamAudioSourceNode | undefined;
  recording: boolean = false;
  recordingWorklet: AudioWorkletNode | undefined;
  private starting: Promise<void> | null = null;
  private onDataCallback: ((base64: string) => void) | null = null;

  constructor(public sampleRate = 16000) {}

  onData(callback: (base64: string) => void) {
    this.onDataCallback = callback;
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Could not request user media');
    }

    this.starting = new Promise(async (resolve, reject) => {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        });
        this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
        this.source = this.audioContext.createMediaStreamSource(this.stream);

        // Create worklet from source
        const workletName = 'audio-recorder-worklet';
        const script = new Blob(
          [`registerProcessor("${workletName}", ${AudioRecordingWorklet})`],
          { type: 'application/javascript' }
        );
        const src = URL.createObjectURL(script);

        await this.audioContext.audioWorklet.addModule(src);
        this.recordingWorklet = new AudioWorkletNode(this.audioContext, workletName);

        this.recordingWorklet.port.onmessage = async (ev: MessageEvent) => {
          const arrayBuffer = ev.data.data.int16arrayBuffer;
          if (arrayBuffer && this.onDataCallback) {
            // Convert ArrayBuffer to base64
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            this.onDataCallback(btoa(binary));
          }
        };

        this.source.connect(this.recordingWorklet);
        this.recording = true;
        resolve();
        this.starting = null;
      } catch (e) {
        reject(e);
        this.starting = null;
      }
    });

    return this.starting;
  }

  stop() {
    const handleStop = () => {
      this.source?.disconnect();
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = undefined;
      this.recordingWorklet = undefined;
    };
    if (this.starting) {
      this.starting.then(handleStop);
      return;
    }
    handleStop();
  }
}

// ── Gemini Live Client (based on reference repo's GenAILiveClient) ───────
const GEMINI_MODEL = 'gemini-2.0-flash-live-preview-04-09';

export class GeminiClient {
  private client: GoogleGenAI | null = null;
  private session: any = null;
  private audioStreamer: AudioStreamer | null = null;
  private audioRecorder: AudioRecorder | null = null;
  private isMuted = false;
  private audioOutCtx: AudioContext | null = null;

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

      const config: LiveConnectConfig = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' },
          },
        },
        systemInstruction: { parts: [{ text: instructions }] },
        tools: [{ functionDeclarations: TOOL_SCHEMAS as any }],
      };

      // Set up audio streamer for playback
      this.audioOutCtx = new AudioContext({ sampleRate: 24000 });
      this.audioStreamer = new AudioStreamer(this.audioOutCtx);

      this.session = await this.client.live.connect({
        model: GEMINI_MODEL,
        config,
        callbacks: {
          onopen: () => {
            console.log('[Gemini] Connected');
            this.setState('ready');
          },
          onmessage: (message: LiveServerMessage) => {
            this.handleMessage(message);
          },
          onerror: (e: ErrorEvent) => {
            console.error('[Gemini] Error:', e.message);
            this.onError?.(e.message || 'Session error');
            this.setState('error');
          },
          onclose: (e: CloseEvent) => {
            console.log('[Gemini] Closed:', e.reason);
            this.setState('disconnected');
          },
        },
      });

      // Start audio capture
      this.audioRecorder = new AudioRecorder(16000);
      this.audioRecorder.onData((base64) => {
        this.sendAudioChunk(base64);
      });
      await this.audioRecorder.start();
      console.log('[Gemini] Audio capture started');

      // Send initial prompt
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

  private async handleMessage(message: LiveServerMessage) {
    // Setup complete
    if (message.setupComplete) {
      console.log('[Gemini] Setup complete');
      this.setState('ready');
      return;
    }

    // Tool call
    if (message.toolCall) {
      this.handleToolCall(message.toolCall);
      return;
    }

    // Tool call cancellation
    if (message.toolCallCancellation) {
      console.log('[Gemini] Tool call cancelled');
      return;
    }

    // Server content
    if (message.serverContent) {
      const { serverContent } = message;

      // Interrupted
      if ('interrupted' in serverContent) {
        console.log('[Gemini] Interrupted');
        this.audioStreamer?.stop();
        return;
      }

      // Turn complete
      if ('turnComplete' in serverContent) {
        this.setState('ready');
      }

      // Model turn with parts
      if ('modelTurn' in serverContent) {
        this.setState('streaming');
        let parts: Part[] = serverContent.modelTurn?.parts || [];

        // Extract audio parts
        const audioParts = parts.filter(
          (p) => p.inlineData?.mimeType?.startsWith('audio/pcm')
        );
        const otherParts = parts.filter(
          (p) => !p.inlineData?.mimeType?.startsWith('audio/pcm')
        );

        // Play audio
        for (const part of audioParts) {
          if (part.inlineData?.data) {
            const data = base64ToArrayBuffer(part.inlineData.data);
            this.audioStreamer?.addPCM16(new Uint8Array(data));
          }
        }

        // Handle non-audio parts (text)
        if (otherParts.length > 0) {
          for (const part of otherParts) {
            if (part.text) {
              this.onTranscript?.(part.text, 'ai');
            }
          }
        }
      }

      // Input transcription (what user said)
      if (serverContent.inputTranscription?.text) {
        this.onTranscript?.(serverContent.inputTranscription.text, 'user');
      }
    }
  }

  private handleToolCall(toolCall: LiveServerToolCall) {
    if (!toolCall.functionCalls) return;

    for (const call of toolCall.functionCalls) {
      if (!call.name) continue;
      const result = executeTool(call.name, call.args || {});

      // Send tool response back
      if (this.session) {
        this.session.sendToolResponse({
          functionResponses: [
            {
              name: call.name,
              id: call.id,
              response: { result: result.message },
            },
          ],
        } as LiveClientToolResponse);
      }
    }
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

  sendText(text: string, turnComplete: boolean = true) {
    if (!this.session) return;
    this.session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete,
    });
  }

  muteMic() {
    this.isMuted = true;
  }

  unmuteMic() {
    this.isMuted = false;
  }

  disconnect() {
    this.audioRecorder?.stop();
    this.audioRecorder = null;
    this.audioStreamer?.stop();
    this.audioStreamer = null;
    this.session?.close();
    this.session = null;
    this.audioOutCtx?.close();
    this.audioOutCtx = null;
    this.setState('disconnected');
  }
}

// Utility (from reference repo)
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
