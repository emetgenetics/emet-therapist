"use client";

import { useRef, useEffect, useCallback } from "react";
import { useSessionStore } from "@/lib/store";
import { getAdaptiveSpeed } from "@/lib/eye-tracking";

const COLOR_MAP: Record<string, { r: number; g: number; b: number }> = {
  white: { r: 255, g: 255, b: 255 },
  amber: { r: 255, g: 191, b: 0 },
  emerald: { r: 16, g: 185, b: 129 },
  blue: { r: 96, g: 165, b: 250 },
};

export default function Lightbar() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const opacityRef = useRef<number>(0);
  const fadeDirectionRef = useRef<"in" | "out" | "none">("none");
  const blsStartTime = useSessionStore((s) => s.bls.startTime);

  const draw = useCallback(
    (timestamp: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { isRunning, speedHz, color } = useSessionStore.getState().bls;
      const { eyeTracking } = useSessionStore.getState();

      // Handle fade in/out
      if (isRunning && fadeDirectionRef.current !== "in") {
        fadeDirectionRef.current = "in";
      } else if (!isRunning && fadeDirectionRef.current !== "out") {
        fadeDirectionRef.current = "out";
      }

      const fadeSpeed = 1 / 500; // 500ms fade
      if (fadeDirectionRef.current === "in") {
        opacityRef.current = Math.min(1, opacityRef.current + fadeSpeed * 16);
        if (opacityRef.current >= 1) fadeDirectionRef.current = "none";
      } else if (fadeDirectionRef.current === "out") {
        opacityRef.current = Math.max(0, opacityRef.current - fadeSpeed * 16);
        if (opacityRef.current <= 0) {
          fadeDirectionRef.current = "none";
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          return;
        }
      }

      if (opacityRef.current <= 0) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // Resize canvas to full screen
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        ctx.scale(dpr, dpr);
      }

      ctx.clearRect(0, 0, w, h);

      const centerY = h / 2;
      const amplitude = w * 0.35;

      // Use shared timebase from store
      const elapsedSeconds = (timestamp - blsStartTime) / 1000;

      // Adaptive speed if eye tracking is active
      let currentSpeed = speedHz;
      if (eyeTracking.enabled && eyeTracking.state === "TRACKING") {
        const lightbarX = 0.5 + 0.5 * Math.sin(2 * Math.PI * speedHz * elapsedSeconds);
        currentSpeed = getAdaptiveSpeed(speedHz, eyeTracking.position.x, lightbarX);
      }

      const x = w / 2 + amplitude * Math.sin(2 * Math.PI * currentSpeed * elapsedSeconds);

      const rgb = COLOR_MAP[color] || COLOR_MAP.white;
      const circleRadius = Math.min(w, h) * 0.06; // 6% of screen
      const glowRadius = circleRadius * 3;

      // Outer glow
      const glowGradient = ctx.createRadialGradient(
        x, centerY, circleRadius * 0.3,
        x, centerY, glowRadius
      );
      glowGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.4 * opacityRef.current})`);
      glowGradient.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.1 * opacityRef.current})`);
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
      coreGradient.addColorStop(0.7, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.8 * opacityRef.current})`);
      coreGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.4 * opacityRef.current})`);
      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(x, centerY, circleRadius, 0, Math.PI * 2);
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    },
    [blsStartTime]
  );

  useEffect(() => {
    if (useSessionStore.getState().bls.isRunning) {
      fadeDirectionRef.current = "in";
    } else {
      fadeDirectionRef.current = "out";
    }
    animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-10 pointer-events-none"
      style={{ display: "block" }}
    />
  );
}
