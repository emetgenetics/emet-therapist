// Audio recording utility using Web Audio API + MediaRecorder

export interface RecorderState {
  isRecording: boolean;
  isPaused: boolean;
  durationMs: number;
  audioLevel: number;
}

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startTime = 0;
  private pausedDuration = 0;
  private animationFrame = 0;
  private _onLevelUpdate: ((level: number) => void) | null = null;
  private _onStateChange: ((state: RecorderState) => void) | null = null;

  get isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  get isPaused(): boolean {
    return this.mediaRecorder?.state === 'paused';
  }

  async start(): Promise<void> {
    if (this.mediaRecorder?.state === 'recording') return;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 24000,
      },
    });

    // Set up audio analysis
    this.audioContext = new AudioContext({ sampleRate: 24000 });
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    source.connect(this.analyser);

    // Set up recorder
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });
    this.chunks = [];

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.start(100); // Collect data every 100ms
    this.startTime = Date.now();
    this.pausedDuration = 0;

    this.startLevelMonitoring();
    this.notifyState();
  }

  pause(): void {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
      this.pausedDuration += Date.now() - this.startTime;
      this.stopLevelMonitoring();
      this.notifyState();
    }
  }

  resume(): void {
    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume();
      this.startTime = Date.now();
      this.startLevelMonitoring();
      this.notifyState();
    }
  }

  async stop(): Promise<Blob> {
    this.stopLevelMonitoring();

    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(new Blob(this.chunks));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        this.cleanup();
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  getDurationMs(): number {
    if (!this.startTime) return this.pausedDuration;
    if (this.isPaused) return this.pausedDuration;
    return this.pausedDuration + (Date.now() - this.startTime);
  }

  onLevelUpdate(callback: (level: number) => void): void {
    this._onLevelUpdate = callback;
  }

  onStateChange(callback: (state: RecorderState) => void): void {
    this._onStateChange = callback;
  }

  private startLevelMonitoring(): void {
    if (!this.analyser) return;
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    const monitor = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const level = average / 255;
      this._onLevelUpdate?.(level);
      this.animationFrame = requestAnimationFrame(monitor);
    };
    monitor();
  }

  private stopLevelMonitoring(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
  }

  private notifyState(): void {
    this._onStateChange?.({
      isRecording: this.isRecording,
      isPaused: this.isPaused,
      durationMs: this.getDurationMs(),
      audioLevel: 0,
    });
  }

  private cleanup(): void {
    this.stopLevelMonitoring();
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.audioContext?.close();
    this.mediaStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.startTime = 0;
    this.pausedDuration = 0;
    this.notifyState();
  }

  destroy(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.cleanup();
  }
}

// Type declarations for Web Speech API
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

// Speech recognition wrapper
export class SpeechRecognizer {
  private recognition: SpeechRecognitionInstance | null = null;
  private _onResult: ((text: string, isFinal: boolean) => void) | null = null;
  private _onError: ((error: Error) => void) | null = null;

  get isSupported(): boolean {
    return typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
  }

  start(language: string = 'en-US'): void {
    if (!this.isSupported) {
      this._onError?.(new Error('Speech recognition not supported'));
      return;
    }

    const w = window as unknown as Record<string, unknown>;
    const SpeechRecognitionAPI = w.SpeechRecognition || w.webkitSpeechRecognition;
    const recognition = new (SpeechRecognitionAPI as new () => SpeechRecognitionInstance)();
    this.recognition = recognition;

    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        this._onResult?.(finalTranscript, true);
      } else if (interimTranscript) {
        this._onResult?.(interimTranscript, false);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== 'no-speech') {
        this._onError?.(new Error(`Speech recognition error: ${event.error}`));
      }
    };

    recognition.onend = () => {
      if (this.recognition) {
        try {
          recognition.start();
        } catch {
          // Already started
        }
      }
    };

    recognition.start();
  }

  stop(): void {
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }
  }

  onResult(callback: (text: string, isFinal: boolean) => void): void {
    this._onResult = callback;
  }

  onError(callback: (error: Error) => void): void {
    this._onError = callback;
  }
}
