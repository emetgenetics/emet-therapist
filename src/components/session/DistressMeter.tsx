'use client';

interface DistressMeterProps {
  level: number;
  onChange?: (level: number) => void;
  readonly?: boolean;
}

export function DistressMeter({ level, onChange, readonly = false }: DistressMeterProps) {
  const getColor = (l: number) => {
    if (l <= 3) return 'from-emerald-500 to-emerald-400';
    if (l <= 5) return 'from-amber-500 to-amber-400';
    if (l <= 7) return 'from-orange-500 to-orange-400';
    return 'from-red-500 to-red-400';
  };

  const getLabel = (l: number) => {
    if (l <= 1) return 'Calm';
    if (l <= 3) return 'Mild';
    if (l <= 5) return 'Moderate';
    if (l <= 7) return 'High';
    if (l <= 9) return 'Severe';
    return 'Extreme';
  };

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 uppercase tracking-wider">Distress</span>
        <span className={`text-xs font-bold ${
          level <= 3 ? 'text-emerald-400' :
          level <= 5 ? 'text-amber-400' :
          level <= 7 ? 'text-orange-400' : 'text-red-400'
        }`}>
          {level}/10
        </span>
      </div>

      {/* Meter bar */}
      <div className="w-32 h-2 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${getColor(level)} rounded-full transition-all duration-500`}
          style={{ width: `${level * 10}%` }}
        />
      </div>

      <span className="text-[10px] text-slate-500">{getLabel(level)}</span>

      {/* Interactive buttons */}
      {!readonly && onChange && (
        <div className="flex gap-1 mt-1">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => (
            <button
              key={l}
              onClick={() => onChange(l)}
              className={`w-5 h-5 rounded text-[10px] font-medium transition-all ${
                l === level
                  ? 'bg-violet-500 text-white scale-110'
                  : 'bg-white/5 text-slate-500 hover:bg-white/10'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
