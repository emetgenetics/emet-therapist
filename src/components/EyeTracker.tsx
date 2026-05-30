'use client';

import { forwardRef, useEffect, useRef } from 'react';

interface EyeTrackerProps {
  onStreamReady?: (stream: MediaStream) => void;
}

const EyeTracker = forwardRef<HTMLVideoElement, EyeTrackerProps>(
  ({ onStreamReady }, ref) => {
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
      let cancelled = false;

      async function startCamera() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: 640, height: 480 },
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (ref && 'current' in ref && ref.current) {
            ref.current.srcObject = stream;
          }
          onStreamReady?.(stream);
        } catch (err) {
          console.error('[EyeTracker] Camera access denied:', err);
        }
      }

      startCamera();

      return () => {
        cancelled = true;
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };
    }, [ref, onStreamReady]);

    return (
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className="fixed top-0 left-0 w-1 h-1 opacity-0 pointer-events-none z-0"
      />
    );
  }
);

EyeTracker.displayName = 'EyeTracker';
export default EyeTracker;
