'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useSessionStore } from '@/lib/store';

const COLOR_FREQ: Record<string, number> = {
  white: 440,
  amber: 330,
  emerald: 220,
  blue: 196,
};

export default function AudioPanner() {
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const pannerRef = useRef<StereoPannerNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const animRef = useRef<number>(0);
  const blsStartTime = useSessionStore((s) => s.bls.startTime);

  const stopAudio = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = 0;
    }

    const gain = gainRef.current;
    const osc = oscRef.current;
    const ctx = ctxRef.current;

    if (gain && ctx) {
      try {
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
      } catch {
        // Ignore if already stopped
      }
    }

    setTimeout(() => {
      try {
        osc?.stop();
        osc?.disconnect();
        pannerRef.current?.disconnect();
        gain?.disconnect();
      } catch {
        // Ignore
      }
      oscRef.current = null;
      pannerRef.current = null;
      gainRef.current = null;
    }, 600);
  }, []);

  const startAudio = useCallback(() => {
    const { bls } = useSessionStore.getState();

    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    const ctx = ctxRef.current;

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = COLOR_FREQ[bls.color] || 440;

    const panner = ctx.createStereoPanner();
    const gain = ctx.createGain();
    gain.gain.value = 0.08; // Very quiet

    osc.connect(panner);
    panner.connect(gain);
    gain.connect(ctx.destination);

    osc.start();

    oscRef.current = osc;
    pannerRef.current = panner;
    gainRef.current = gain;

    // Animate panner using shared timebase
    const animate = () => {
      const { bls: currentBls } = useSessionStore.getState();
      if (!currentBls.isRunning) return;

      const elapsed = (performance.now() - blsStartTime) / 1000;
      if (pannerRef.current) {
        pannerRef.current.pan.value = Math.sin(2 * Math.PI * currentBls.speedHz * elapsed);
      }
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
  }, [blsStartTime]);

  useEffect(() => {
    const { bls } = useSessionStore.getState();

    if (bls.isRunning) {
      startAudio();
    } else {
      stopAudio();
    }

    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
      }
    };
  }, [startAudio, stopAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      ctxRef.current?.close();
    };
  }, [stopAudio]);

  return null; // Non-visual component
}
