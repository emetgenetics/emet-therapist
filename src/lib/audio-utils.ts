export function createAudioCapture(onChunk: (base64: string) => void) {
  let audioCtx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let buffer: Float32Array = new Float32Array(0);
  const SAMPLE_RATE = 16000;
  const CHUNK_SIZE = 1600; // 100ms at 16kHz

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });

    audioCtx = new AudioContext();
    const micRate = audioCtx.sampleRate;
    const ratio = micRate / SAMPLE_RATE;

    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(2048, 1, 1);

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const downsampled: number[] = [];
      for (let i = 0; i < input.length; i += ratio) {
        downsampled.push(input[Math.floor(i)]);
      }

      const newBuf = new Float32Array(buffer.length + downsampled.length);
      newBuf.set(buffer);
      newBuf.set(downsampled, buffer.length);
      buffer = newBuf;

      while (buffer.length >= CHUNK_SIZE) {
        const chunk = buffer.slice(0, CHUNK_SIZE);
        buffer = buffer.slice(CHUNK_SIZE);

        // Convert to PCM16
        const pcm16 = new Int16Array(chunk.length);
        for (let i = 0; i < chunk.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(chunk[i] * 32767)));
        }

        // Convert to base64
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        onChunk(btoa(binary));
      }
    };

    source.connect(processor);
    // NO processor.connect(audioCtx.destination) — prevents feedback loop

    return { stream, audioCtx };
  }

  function stop() {
    processor?.disconnect();
    source?.disconnect();
    audioCtx?.close();
    buffer = new Float32Array(0);
  }

  return { start, stop };
}
