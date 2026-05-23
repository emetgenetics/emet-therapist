'use client';

import type { SessionState } from '@/lib/store/session-store';

interface SessionStateIndicatorProps {
  state: SessionState;
}

const STATE_CONFIG: Record<SessionState, { label: string; color: string; icon: string }> = {
  PRE_FLIGHT: { label: 'Pre-Flight', color: 'text-slate-400', icon: '✈️' },
  INTAKE: { label: 'Intake', color: 'text-blue-400', icon: '📝' },
  DESENSITIZATION: { label: 'Desensitization', color: 'text-amber-400', icon: '🌊' },
  PIVOT: { label: 'Pivot', color: 'text-purple-400', icon: '🔄' },
  RECONNECTION: { label: 'Reconnection', color: 'text-fuchsia-400', icon: '💫' },
  INTEGRATION: { label: 'Integration', color: 'text-emerald-400', icon: '🌿' },
  EMERGENCY_GROUNDING: { label: 'Grounding', color: 'text-red-400', icon: '🛟' },
  COMPLETED: { label: 'Completed', color: 'text-green-400', icon: '✅' },
  ABANDONED: { label: 'Ended', color: 'text-slate-500', icon: '⏹' },
};

export function SessionStateIndicator({ state }: SessionStateIndicatorProps) {
  const config = STATE_CONFIG[state] || STATE_CONFIG.PRE_FLIGHT;

  return (
    <div className="flex items-center gap-2">
      <span className="text-lg">{config.icon}</span>
      <span className={`text-sm font-semibold ${config.color}`}>{config.label}</span>
    </div>
  );
}
