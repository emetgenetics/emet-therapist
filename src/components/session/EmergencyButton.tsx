'use client';

import { useState } from 'react';

interface EmergencyButtonProps {
  onActivate: () => void;
}

export function EmergencyButton({ onActivate }: EmergencyButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleClick = () => {
    if (showConfirm) {
      onActivate();
      setShowConfirm(false);
    } else {
      setShowConfirm(true);
      setTimeout(() => setShowConfirm(false), 5000);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        showConfirm
          ? 'bg-red-500 text-white animate-pulse'
          : 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20'
      }`}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      {showConfirm ? 'Confirm Emergency' : 'Emergency'}
    </button>
  );
}
