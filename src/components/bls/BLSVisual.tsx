'use client';

import { useEffect, useRef, useCallback } from 'react';

interface BLSConfig {
  visualPattern: 'horizontal' | 'circular' | 'butterfly' | 'dotfield';
  visualSpeed: number;
  visualIntensity: number;
  visualColorPrimary: string;
  visualColorSecondary: string;
}

interface BLSVisualProps {
  isRunning: boolean;
  config: BLSConfig;
  className?: string;
}

export function BLSVisual({ isRunning, config, className = '' }: BLSVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const configRef = useRef<BLSConfig>(config);
  const phaseRef = useRef(0);

  configRef.current = config;

  const render = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { visualPattern, visualSpeed, visualIntensity, visualColorPrimary, visualColorSecondary } = configRef.current;
    const cyclesPerMs = visualSpeed / 60000;
    phaseRef.current = (timestamp * cyclesPerMs) % 1;

    const w = canvas.width;
    const h = canvas.height;

    // Clear with dark background
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, w, h);

    switch (visualPattern) {
      case 'horizontal':
        renderHorizontalBar(ctx, phaseRef.current, visualIntensity, visualColorPrimary, visualColorSecondary, w, h);
        break;
      case 'circular':
        renderCircular(ctx, phaseRef.current, visualIntensity, visualColorPrimary, visualColorSecondary, w, h);
        break;
      case 'butterfly':
        renderButterfly(ctx, phaseRef.current, visualIntensity, visualColorPrimary, visualColorSecondary, w, h);
        break;
      case 'dotfield':
        renderDotField(ctx, phaseRef.current, visualIntensity, visualColorPrimary, visualColorSecondary, w, h);
        break;
      default:
        renderHorizontalBar(ctx, phaseRef.current, visualIntensity, visualColorPrimary, visualColorSecondary, w, h);
    }

    animationRef.current = requestAnimationFrame(render);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  useEffect(() => {
    if (isRunning) {
      animationRef.current = requestAnimationFrame(render);
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#020617';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isRunning, render]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full rounded-2xl ${className}`}
      style={{ background: '#020617' }}
    />
  );
}

function renderHorizontalBar(
  ctx: CanvasRenderingContext2D,
  phase: number,
  intensity: number,
  color1: string,
  color2: string,
  w: number,
  h: number
) {
  const barHeight = h * 0.12 * intensity;
  const y = h / 2 - barHeight / 2;
  const x = (Math.sin(phase * Math.PI * 2) + 1) / 2 * (w * 0.7) + w * 0.15;

  // Glow
  const gradient = ctx.createLinearGradient(x - 80, y, x + 80, y);
  gradient.addColorStop(0, 'transparent');
  gradient.addColorStop(0.2, color1 + '80');
  gradient.addColorStop(0.5, color2);
  gradient.addColorStop(0.8, color1 + '80');
  gradient.addColorStop(1, 'transparent');

  ctx.shadowColor = color1;
  ctx.shadowBlur = 30 * intensity;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(x - 80, y, 160, barHeight, barHeight / 2);
  ctx.fill();

  // Core bright line
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.6 * intensity;
  ctx.beginPath();
  ctx.roundRect(x - 60, y + barHeight * 0.3, 120, barHeight * 0.4, barHeight * 0.2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function renderCircular(
  ctx: CanvasRenderingContext2D,
  phase: number,
  intensity: number,
  color1: string,
  color2: string,
  w: number,
  h: number
) {
  const cx = w / 2;
  const cy = h / 2;
  const maxRadius = Math.min(w, h) * 0.35 * intensity;
  const radius = (Math.sin(phase * Math.PI * 2) + 1) / 2 * maxRadius + 20;

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, 'transparent');
  gradient.addColorStop(0.6, color1 + '30');
  gradient.addColorStop(1, color2);

  ctx.shadowColor = color1;
  ctx.shadowBlur = 40 * intensity;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function renderButterfly(
  ctx: CanvasRenderingContext2D,
  phase: number,
  intensity: number,
  color1: string,
  _color2: string,
  w: number,
  h: number
) {
  const cx = w / 2;
  const cy = h / 2;
  const amp = Math.sin(phase * Math.PI * 2) * intensity;

  ctx.strokeStyle = color1;
  ctx.lineWidth = 3 * intensity;
  ctx.lineCap = 'round';
  ctx.shadowColor = color1;
  ctx.shadowBlur = 15 * intensity;

  // Left wing
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.quadraticCurveTo(cx - 120 * intensity, cy - 80 * amp * intensity, cx - 180 * intensity, cy + 40 * amp * intensity);
  ctx.stroke();

  // Right wing
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.quadraticCurveTo(cx + 120 * intensity, cy + 80 * amp * intensity, cx + 180 * intensity, cy - 40 * amp * intensity);
  ctx.stroke();

  ctx.shadowBlur = 0;
}

function renderDotField(
  ctx: CanvasRenderingContext2D,
  phase: number,
  intensity: number,
  color1: string,
  color2: string,
  w: number,
  h: number
) {
  const cols = 10;
  const rows = 6;
  const sx = w / (cols + 1);
  const sy = h / (rows + 1);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = sx * (col + 1);
      const y = sy * (row + 1);
      const offset = (row + col) % 2 === 0
        ? Math.sin(phase * Math.PI * 2) * 25 * intensity
        : -Math.sin(phase * Math.PI * 2) * 25 * intensity;
      const alpha = 0.3 + Math.abs(Math.sin(phase * Math.PI * 2 + col * 0.3)) * 0.7;
      const color = (row + col) % 3 === 0 ? color1 : color2;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * intensity;
      ctx.beginPath();
      ctx.arc(x + offset, y, 3 * intensity, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}
