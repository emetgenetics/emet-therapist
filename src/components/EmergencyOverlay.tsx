'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSessionStore } from '@/lib/store';
import { GeminiLiveClient } from '@/lib/gemini-live';

interface EmergencyOverlayProps {
  client: GeminiLiveClient;
}

export default function EmergencyOverlay({ client }: EmergencyOverlayProps) {
  const resolveEmergency = useSessionStore((s) => s.resolveEmergency);
  const [scale, setScale] = useState(0.6);
  const resolveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Breathing pacer: 4 second cycle
  useEffect(() => {
    const duration = 4000;
    const animate = (now: number) => {
      const elapsed = (now % duration);
      const progress = elapsed / duration;
      setScale(0.6 + 0.4 * (0.5 + 0.5 * Math.sin(progress * Math.PI * 2 - Math.PI / 2)));
      requestAnimationFrame(animate);
    };
    const frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Hard-mute on mount — immediate, no AI involvement
  useEffect(() => {
    client.muteMic();
    // Stop sending audio to Gemini by closing the mic stream tracks
    if (client.micStream) {
      client.micStream.getTracks().forEach((t) => t.stop());
    }

    return () => {
      if (resolveTimeoutRef.current) {
        clearTimeout(resolveTimeoutRef.current);
      }
    };
  }, [client]);

  const handleResolve = useCallback(() => {
    resolveEmergency();

    // Send context to Gemini after a short delay
    resolveTimeoutRef.current = setTimeout(() => {
      if (client.ws?.readyState === WebSocket.OPEN) {
        // Send a text message to Gemini explaining the situation
        client.ws.send(
          JSON.stringify({
            clientContent: {
              turns: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: 'I experienced some distress but I am calmer now. Please help me ground and close the session.',
                    },
                  ],
                },
              ],
              turnComplete: true,
            },
          })
        );
      }
    }, 500);
  }, [client, resolveEmergency]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center">
      <div className="max-w-lg w-full px-8 text-center">
        <h2 className="text-2xl font-light text-white mb-2">You are safe.</h2>
        <p className="text-gray-400 mb-10">You are here. Take your time.</p>

        {/* Breathing Pacer */}
        <div className="flex justify-center mb-10">
          <div
            className="rounded-full bg-violet-500/20 border border-violet-500/30 transition-transform"
            style={{
              width: 120,
              height: 120,
              transform: `scale(${scale})`,
            }}
          />
        </div>

        {/* Grounding Instructions */}
        <div className="space-y-3 mb-10 text-gray-300 text-sm">
          <p>Name 5 things you can see</p>
          <p>Feel your feet on the floor</p>
          <p>Breathe slowly</p>
        </div>

        <button
          onClick={handleResolve}
          className="px-8 py-3 rounded-xl bg-violet-600/80 text-white hover:bg-violet-500 transition-colors text-sm font-medium"
        >
          I feel calmer now
        </button>
      </div>
    </div>
  );
}
