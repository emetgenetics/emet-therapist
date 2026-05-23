'use client';

import { useState, useRef, useCallback } from 'react';
import { useSessionStore } from '@/lib/store';
import { RealtimeClient } from '@/lib/realtime';

interface PreFlightProps {
  onReady: (client: RealtimeClient) => void;
}

export default function PreFlight({ onReady }: PreFlightProps) {
  const [checked, setChecked] = useState({
    quiet: false,
    headphones: false,
    uninterrupted: false,
  });
  const [headphoneTested, setHeadphoneTested] = useState(false);
  const [headphoneError, setHeadphoneError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const setPhase = useSessionStore((s) => s.setPhase);

  const allChecked =
    checked.quiet && checked.headphones && checked.uninterrupted;

  const playHeadphoneTest = useCallback(async () => {
    setHeadphoneError('');

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;

    const panner = ctx.createStereoPanner();
    panner.pan.value = -1; // hard left

    const gain = ctx.createGain();
    gain.gain.value = 0.3;

    osc.connect(panner);
    panner.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 2);

    // Wait for test to finish
    await new Promise((r) => setTimeout(r, 2500));

    const confirmed = window.confirm(
      'Did you hear the tone in your LEFT ear?\n\nClick OK if yes, Cancel if no.'
    );

    if (confirmed) {
      setHeadphoneTested(true);
    } else {
      setHeadphoneError(
        'Please ensure you are wearing stereo headphones and try again.'
      );
    }
  }, []);

  const startSession = useCallback(async () => {
    if (!allChecked || !headphoneTested) return;

    setConnecting(true);

    try {
      const client = new RealtimeClient();
      await client.connect();
      setPhase('INTAKE');
      onReady(client);
    } catch (err) {
      setConnecting(false);
      alert(
        `Failed to connect: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }, [allChecked, headphoneTested, setPhase, onReady]);

  const canStart = allChecked && headphoneTested && !connecting;

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <div className="max-w-md w-full px-8">
        <h1 className="text-3xl font-light text-white text-center mb-2">
          Emet
        </h1>
        <p className="text-gray-500 text-center text-sm mb-10">
          Pre-Session Checklist
        </p>

        <div className="space-y-4 mb-8">
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={checked.quiet}
              onChange={(e) =>
                setChecked((c) => ({ ...c, quiet: e.target.checked }))
              }
              className="w-5 h-5 rounded border-gray-600 bg-gray-800 text-violet-500 focus:ring-violet-500 accent-violet-500"
            />
            <span className="text-gray-300 group-hover:text-white transition-colors">
              I am in a quiet, private room
            </span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={checked.headphones}
              onChange={(e) =>
                setChecked((c) => ({ ...c, headphones: e.target.checked }))
              }
              className="w-5 h-5 rounded border-gray-600 bg-gray-800 text-violet-500 focus:ring-violet-500 accent-violet-500"
            />
            <span className="text-gray-300 group-hover:text-white transition-colors">
              I am wearing stereo headphones
            </span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={checked.uninterrupted}
              onChange={(e) =>
                setChecked((c) => ({ ...c, uninterrupted: e.target.checked }))
              }
              className="w-5 h-5 rounded border-gray-600 bg-gray-800 text-violet-500 focus:ring-violet-500 accent-violet-500"
            />
            <span className="text-gray-300 group-hover:text-white transition-colors">
              I will not be interrupted
            </span>
          </label>
        </div>

        {/* Headphone Test */}
        <div className="mb-8">
          <button
            onClick={playHeadphoneTest}
            disabled={!allChecked}
            className={`w-full py-3 rounded-lg text-sm font-medium transition-all ${
              allChecked
                ? 'bg-gray-800 text-white hover:bg-gray-700 border border-gray-700'
                : 'bg-gray-900 text-gray-600 border border-gray-800 cursor-not-allowed'
            }`}
          >
            🔊 Test Headphones
          </button>
          {headphoneError && (
            <p className="text-red-400 text-xs mt-2">{headphoneError}</p>
          )}
          {headphoneTested && (
            <p className="text-emerald-400 text-xs mt-2">
              ✓ Headphones confirmed
            </p>
          )}
        </div>

        {/* Start Button */}
        <button
          onClick={startSession}
          disabled={!canStart}
          className={`w-full py-4 rounded-xl text-lg font-medium transition-all ${
            canStart
              ? 'bg-violet-600 text-white hover:bg-violet-500 shadow-lg shadow-violet-900/30'
              : 'bg-gray-900 text-gray-600 cursor-not-allowed'
          }`}
        >
          {connecting ? 'Connecting...' : 'Begin Session'}
        </button>

        <p className="text-gray-600 text-xs text-center mt-6">
          This is a voice-only session. Your microphone will be active.
        </p>
      </div>
    </div>
  );
}
