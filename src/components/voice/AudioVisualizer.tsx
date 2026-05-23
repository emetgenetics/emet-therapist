'use client';

import { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  level: number; // 0-1
  isActive: boolean;
  barCount?: number;
  className?: string;
}

export function AudioVisualizer({ level, isActive, barCount = 24, className = '' }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const levelsRef = useRef<number[]>(new Array(barCount).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;

      ctx.fillStyle = 'rgba(2, 6, 23, 0.3)';
      ctx.fillRect(0, 0, w, h);

      const barWidth = (w / barCount) * 0.7;
      const gap = (w / barCount) * 0.3;

      // Shift levels
      if (isActive) {
        levelsRef.current.pop();
        levelsRef.current.unshift(level);
      } else {
        levelsRef.current = levelsRef.current.map((l) => l * 0.9);
      }

      for (let i = 0; i < barCount; i++) {
        const barHeight = levelsRef.current[i] * h * 0.8;
        const x = i * (barWidth + gap) + gap / 2;
        const y = h - barHeight;

        // Gradient per bar
        const gradient = ctx.createLinearGradient(x, h, x, y);
        const hue = 250 + (i / barCount) * 40; // violet to fuchsia
        gradient.addColorStop(0, `hsla(${hue}, 80%, 60%, 0.3)`);
        gradient.addColorStop(1, `hsla(${hue}, 80%, 70%, 0.9)`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationRef.current);
  }, [level, isActive, barCount]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={60}
      className={`w-full h-16 rounded-xl ${className}`}
      style={{ background: 'rgba(2, 6, 23, 0.5)' }}
    />
  );
}
