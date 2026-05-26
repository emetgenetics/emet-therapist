'use client';

import { useEffect, useRef } from 'react';
import { useSessionStore } from '@/lib/store';

const COLOR_FREQ: Record<string, number> = {
  white: 440,
  amber: 330,
  emerald: 220,
  blue: 196,
};

export default function AudioPanner() {
  const bls = useSessionStore((s) => s.bls);
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const pannerRef = useRef<StereoPannerNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const animRef = useRef<number>(0);

  // BUG 5 fix: Only trigger on isRunning change, read other values inside
  useEffect(() => {
    if (bls.isRunning) {
      // Start audio
      if (!ctxRef.current) ctxRef.current = new AudioContext();
      const ctx = ctxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = COLOR_FREQ[bls.color] || 440;

      const panner = ctx.createStereoPanner();
      const gain = ctx.createGain();
      gain.gain.value = 0.06;

      osc.connect(panner);
      panner.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      oscRef.current = osc;
      pannerRef.current = panner;
      gainRef.current = gain;

      // Animate panner using shared timebase from store
      const startTime = bls.startTime;
      const speed = bls.speedHz;

      const animate = () => {
        const elapsed = (performance.now() - startTime) / 1000;
        if (pannerRef.current) {
          pannerRef.current.pan.value = Math.sin(2 * Math.PI * speed * elapsed);
        }
        animRef.current = requestAnimationFrame(animate);
      };
      animRef.current = requestAnimationFrame(animate);

    } else {
      // Stop audio — fade out
      cancelAnimationFrame(animRef.current);
      const gain = gainRef.current;
      const ctx = ctxRef.current;
      if (gain && ctx) {
        try {
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
        } catch {
          // Ignore if already stopped
        }
      }
      setTimeout(() => {
        try { oscRef.current?.stop(); } catch { /* ignore */ }
        oscRef.current?.disconnect();
        pannerRef.current?.disconnect();
        gainRef.current?.disconnect();
        oscRef.current = null;
        pannerRef.current = null;
        gainRef.current = null;
      }, 600);
    }

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [bls.isRunning]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      try { oscRef.current?.stop(); } catch { /* ignore */ }
      ctxRef.current?.close();
    };
  }, []);

  return null;
}
