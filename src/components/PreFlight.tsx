'use client';

import { useState, useEffect } from 'react';
import { useSessionStore } from '@/lib/store';

interface PreFlightProps {
  onStart: () => void;
}

export default function PreFlight({ onStart }: PreFlightProps) {
  const [checks, setChecks] = useState([false, false, false]);
  const [headphonesTested, setHeadphonesTested] = useState(false);
  const [eyeTrackingEnabled, setEyeTrackingEnabled] = useState(false);
  const [dayInfo, setDayInfo] = useState<{
    day: number | null;
    hoursRemaining?: number;
    context?: { targetImage?: string; bodyLocation?: string; finalSuds?: number | null };
  }>({ day: null });
  const store = useSessionStore();

  useEffect(() => {
    const day1Completed = localStorage.getItem('emet_day1_completed');
    if (!day1Completed) {
      // Day 1 — first session
      setDayInfo({ day: 1 });
      store.setDay(1);
      store.setPhase('INTAKE');
    } else {
      const hoursSince = (Date.now() - parseInt(day1Completed)) / 3600000;
      const contextRaw = localStorage.getItem('emet_day1_context');
      const context = contextRaw ? JSON.parse(contextRaw) : null;

      if (hoursSince < 12) {
        // Too soon — enforce 12-hour lockout
        setDayInfo({ day: 2, hoursRemaining: Math.ceil(12 - hoursSince) });
      } else {
        // Day 2 — ready
        setDayInfo({ day: 2, context });
        store.setDay(2);
        store.setPhase('CHECK_IN');
      }
    }
  }, []);

  async function testHeadphones() {
    try {
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') await ctx.resume();

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;

      const panner = ctx.createStereoPanner();
      panner.pan.value = -1; // Left ear

      const gain = ctx.createGain();
      gain.gain.value = 0.3;

      osc.connect(panner);
      panner.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 2);

      setHeadphonesTested(true);
    } catch (err) {
      console.error('[PreFlight] Headphone test failed:', err);
    }
  }

  const allChecked = checks.every(Boolean);
  const canStart = allChecked && headphonesTested && dayInfo.day !== null && dayInfo.hoursRemaining === undefined;

  const checklistLabels = [
    'I am in a quiet, private room',
    'I am wearing stereo headphones',
    'I will not be interrupted',
  ];

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-3xl font-light">Emet</h1>
      <p className="text-white/50 text-sm">Pre-Session Checklist</p>

      {/* Day indicator */}
      {dayInfo.day === 1 && (
        <div className="text-amber-400 text-sm">Day 1: Desensitization</div>
      )}
      {dayInfo.day === 2 && dayInfo.hoursRemaining === undefined && (
        <div className="text-emerald-400 text-sm">Day 2: Reconnection</div>
      )}
      {dayInfo.hoursRemaining !== undefined && (
        <div className="text-red-400 text-sm">
          Please wait {dayInfo.hoursRemaining} more hour{dayInfo.hoursRemaining > 1 ? 's' : ''} before Day 2
        </div>
      )}

      {/* Day 2 context */}
      {dayInfo.day === 2 && dayInfo.context && (
        <div className="text-white/30 text-xs text-center max-w-md">
          Returning from Day 1. Your brain has processed the grief work. Today we continue.
        </div>
      )}

      {/* Checklist */}
      {checklistLabels.map((text, i) => (
        <label key={i} className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={checks[i]}
            onChange={(e) => {
              const newChecks = [...checks];
              newChecks[i] = e.target.checked;
              setChecks(newChecks);
            }}
            className="w-5 h-5 accent-violet-500"
          />
          <span className="text-sm">{text}</span>
        </label>
      ))}

      {/* Eye tracking toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={eyeTrackingEnabled}
          onChange={(e) => {
            setEyeTrackingEnabled(e.target.checked);
            store.setEyeTracking({ enabled: e.target.checked });
          }}
          className="w-5 h-5 accent-violet-500"
        />
        <span className="text-sm">Enable adaptive eye tracking (webcam)</span>
      </label>

      {/* Headphone test */}
      <button
        onClick={testHeadphones}
        disabled={!allChecked}
        className={`px-6 py-3 rounded text-sm transition-all ${
          allChecked
            ? 'bg-white/10 hover:bg-white/20'
            : 'bg-white/5 text-white/30 cursor-not-allowed'
        }`}
      >
        {headphonesTested ? '✓ Headphones confirmed' : '🔊 Test Headphones'}
      </button>

      {/* Start button */}
      <button
        onClick={onStart}
        disabled={!canStart}
        className={`px-8 py-4 rounded text-lg transition-all ${
          canStart
            ? 'bg-violet-600 hover:bg-violet-500 text-white'
            : 'bg-white/5 text-white/30 cursor-not-allowed'
        }`}
      >
        {dayInfo.hoursRemaining !== undefined ? 'Locked — Wait Required' : 'Start Session'}
      </button>

      <p className="text-white/20 text-xs text-center mt-4">
        This is a voice-only session. Your microphone will be active.
      </p>
    </div>
  );
}
