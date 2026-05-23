'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useSessionStore } from '@/lib/store';

interface LightbarProps {
  isRunning: boolean;
  speedHz: number;
  color: string;
}

const COLOR_MAP: Record<string, { r: number; g: number; b: number }> = {
  white: { r: 255, g: 255, b: 255 },
  amber: { r: 255, g: 191, b: 0 },
  emerald: { r: 16, g: 185, b: 129 },
  blue: { r: 96, g: 165, b: 250 },
};

export default function Lightbar({ isRunning, speedHz, color }: LightbarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const opacityRef = useRef<number>(0);
  const fadeDirectionRef = useRef<'in' | 'out' | 'none'>('none');
  // Read shared start time from store (set by startBls)
  const blsStartTime = useSessionStore((s) => s.blsStartTime);

  const draw = useCallback(
    (timestamp: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Handle fade in/out
      if (isRunning && fadeDirectionRef.current !== 'in') {
        fadeDirectionRef.current = 'in';
      } else if (!isRunning && fadeDirectionRef.current !== 'out') {
        fadeDirectionRef.current = 'out';
      }

      const fadeSpeed = 1 / 500; // 500ms fade
      if (fadeDirectionRef.current === 'in') {
        opacityRef.current = Math.min(1, opacityRef.current + fadeSpeed * 16);
        if (opacityRef.current >= 1) {
          fadeDirectionRef.current = 'none';
        }
      } else if (fadeDirectionRef.current === 'out') {
        opacityRef.current = Math.max(0, opacityRef.current - fadeSpeed * 16);
        if (opacityRef.current <= 0) {
          fadeDirectionRef.current = 'none';
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          return;
        }
      }

      if (opacityRef.current <= 0) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // Resize canvas to match display
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const amplitude = canvas.width * 0.35;

      // Use shared timebase from store — same startTime as AudioPanner
      const elapsedSeconds = (timestamp - blsStartTime) / 1000;

      const x = centerX + amplitude * Math.sin(2 * Math.PI * speedHz * elapsedSeconds);

      const rgb = COLOR_MAP[color] || COLOR_MAP.white;
      const circleRadius = 40;
      const glowRadius = 80;

      // Glow
      const glowGradient = ctx.createRadialGradient(
        x, centerY, circleRadius * 0.5,
        x, centerY, glowRadius
      );
      glowGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.3 * opacityRef.current})`);
      glowGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(x, centerY, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Core circle
      const coreGradient = ctx.createRadialGradient(
        x, centerY, 0,
        x, centerY, circleRadius
      );
      coreGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacityRef.current})`);
      coreGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.6 * opacityRef.current})`);
      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(x, centerY, circleRadius, 0, Math.PI * 2);
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    },
    [isRunning, speedHz, color, blsStartTime]
  );

  useEffect(() => {
    if (isRunning) {
      fadeDirectionRef.current = 'in';
    } else {
      fadeDirectionRef.current = 'out';
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
      }
    };
  }, [isRunning, draw]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: 'block' }}
    />
  );
}
