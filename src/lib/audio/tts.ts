// Text-to-Speech utility using Web Speech API
// Falls back to browser's built-in synthesis

let currentUtterance: SpeechSynthesisUtterance | null = null;

export interface TTSOptions {
  text: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  voice?: SpeechSynthesisVoice;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
}

export function speak(options: TTSOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(new Error('Speech synthesis not supported'));
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(options.text);
    currentUtterance = utterance;

    utterance.rate = options.rate ?? 0.85;
    utterance.pitch = options.pitch ?? 0.95;
    utterance.volume = options.volume ?? 1.0;

    if (options.voice) {
      utterance.voice = options.voice;
    } else {
      // Try to find a warm, calm voice
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) =>
          v.name.toLowerCase().includes('samantha') ||
          v.name.toLowerCase().includes('karen') ||
          v.name.toLowerCase().includes('moira') ||
          v.name.toLowerCase().includes('female')
      );
      if (preferred) utterance.voice = preferred;
    }

    utterance.onstart = () => {
      options.onStart?.();
    };

    utterance.onend = () => {
      currentUtterance = null;
      options.onEnd?.();
      resolve();
    };

    utterance.onerror = (event) => {
      currentUtterance = null;
      const error = new Error(`TTS error: ${event.error}`);
      options.onError?.(error);
      reject(error);
    };

    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    currentUtterance = null;
  }
}

export function isSpeaking(): boolean {
  return 'speechSynthesis' in window && window.speechSynthesis.speaking;
}

export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices();
}

// Preload voices (needed for some browsers)
export function preloadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve([]);
      return;
    }
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }
    window.speechSynthesis.onvoiceschanged = () => {
      resolve(window.speechSynthesis.getVoices());
    };
    // Timeout fallback
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
  });
}
