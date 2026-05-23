'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useSessionStore } from '@/lib/store';

interface AudioPannerProps {
  isRunning: boolean;
  speedHz: number;
  frequency?: number;
}

export default function AudioPanner({
  isRunning,
  speedHz,
  frequency = 440,
}: AudioPannerProps) {
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const pannerRef = useRef<StereoPannerNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const animRef = useRef<number>(0);
  // Read shared start time from store — same as Lightbar
  const blsStartTime = useSessionStore((s) => s.blsStartTime);

  const stopAudio = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = 0;
    }

    const gain = gainRef.current;
    const osc = oscRef.current;
    const ctx = ctxRef.current;

    if (gain && ctx) {
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    }

    setTimeout(() => {
      osc?.stop();
      osc?.disconnect();
      pannerRef.current?.disconnect();
      gain?.disconnect();
      oscRef.current = null;
      pannerRef.current = null;
      gainRef.current = null;
    }, 600);
  }, []);

  const startAudio = useCallback(() => {
    // Create AudioContext on first user interaction (browser policy)
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    const ctx = ctxRef.current;

    // Resume if suspended
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;

    const panner = ctx.createStereoPanner();
    const gain = ctx.createGain();
    gain.gain.value = 0.08; // very quiet

    osc.connect(panner);
    panner.connect(gain);
    gain.connect(ctx.destination);

    osc.start();

    oscRef.current = osc;
    pannerRef.current = panner;
    gainRef.current = gain;

    // Use shared timebase from store — same startTime as Lightbar
    const animate = () => {
      const elapsed = (performance.now() - blsStartTime) / 1000;
      if (pannerRef.current) {
        pannerRef.current.pan.value = Math.sin(
          2 * Math.PI * speedHz * elapsed
        );
      }
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
  }, [frequency, speedHz, blsStartTime]);

  useEffect(() => {
    if (isRunning) {
      startAudio();
    } else {
      stopAudio();
    }

    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
      }
    };
  }, [isRunning, startAudio, stopAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      ctxRef.current?.close();
    };
  }, [stopAudio]);

  return null; // This is a non-visual component
}
