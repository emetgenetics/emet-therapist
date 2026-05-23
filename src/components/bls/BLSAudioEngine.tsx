'use client';

import { useEffect, useRef } from 'react';

interface BLSAudioConfig {
  auditoryFrequency: number;
  auditoryVolume: number;
  auditoryWaveform: OscillatorType;
}

interface BLSAudioEngineProps {
  isRunning: boolean;
  config: BLSAudioConfig;
}

export function BLSAudioEngine({ isRunning, config }: BLSAudioEngineProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const lfoRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const pannerRef = useRef<StereoPannerNode | null>(null);

  useEffect(() => {
    if (isRunning) {
      startBLS(config);
    } else {
      stopBLS();
    }
    return () => stopBLS();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  useEffect(() => {
    if (isRunning && audioContextRef.current) {
      // Update parameters in real-time
      if (oscRef.current) {
        oscRef.current.frequency.value = config.auditoryFrequency;
        oscRef.current.type = config.auditoryWaveform;
      }
      if (gainRef.current) {
        gainRef.current.gain.value = config.auditoryVolume;
      }
    }
  }, [config, isRunning]);

  const startBLS = (cfg: BLSAudioConfig) => {
    stopBLS();

    try {
      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      const masterGain = ctx.createGain();
      masterGain.gain.value = cfg.auditoryVolume;
      gainRef.current = masterGain;

      const panner = ctx.createStereoPanner();
      pannerRef.current = panner;

      // LFO for stereo panning
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = cfg.auditoryFrequency / 60;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 1;
      lfo.connect(lfoGain);
      lfoGain.connect(panner.pan);
      lfo.start();
      lfoRef.current = lfo;

      // Main tone
      const osc = ctx.createOscillator();
      osc.type = cfg.auditoryWaveform;
      osc.frequency.value = cfg.auditoryFrequency;
      osc.connect(panner);
      panner.connect(masterGain);
      masterGain.connect(ctx.destination);
      osc.start();
      oscRef.current = osc;
    } catch {
      // Audio context not available
    }
  };

  const stopBLS = () => {
    try {
      oscRef.current?.stop();
      lfoRef.current?.stop();
      audioContextRef.current?.close();
    } catch {
      // Already stopped
    }
    oscRef.current = null;
    lfoRef.current = null;
    audioContextRef.current = null;
    gainRef.current = null;
    pannerRef.current = null;
  };

  return null;
}
