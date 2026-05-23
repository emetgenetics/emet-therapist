'use client';

interface EmetLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

export function EmetLogo({ size = 'md', showText = true, className = '' }: EmetLogoProps) {
  const sizes = {
    sm: { icon: 32, text: 'text-lg' },
    md: { icon: 48, text: 'text-2xl' },
    lg: { icon: 64, text: 'text-3xl' },
    xl: { icon: 96, text: 'text-5xl' },
  };

  const { icon, text } = sizes[size];

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative">
        <svg
          width={icon}
          height={icon}
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-lg"
        >
          <circle
            cx="50"
            cy="50"
            r="45"
            stroke="url(#emet-gradient)"
            strokeWidth="2"
            className="opacity-60"
          />
          <path
            d="M30 25 L30 75 L70 75 M30 50 L60 50 M30 25 L70 25"
            stroke="url(#emet-gradient)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle
            cx="75"
            cy="50"
            r="6"
            fill="url(#emet-dot-gradient)"
            className="animate-pulse"
          />
          <defs>
            <linearGradient id="emet-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#8B5CF6" />
              <stop offset="50%" stopColor="#A78BFA" />
              <stop offset="100%" stopColor="#C4B5FD" />
            </linearGradient>
            <radialGradient id="emet-dot-gradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#F0ABFC" />
              <stop offset="100%" stopColor="#A855F7" />
            </radialGradient>
          </defs>
        </svg>
      </div>
      
      {showText && (
        <div className="flex flex-col">
          <span className={`${text} font-bold tracking-tight bg-gradient-to-r from-violet-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent`}>
            Emet
          </span>
          <span className="text-xs text-slate-400 tracking-widest uppercase">
            Truth • Connection • Healing
          </span>
        </div>
      )}
    </div>
  );
}

export function EmetSymbol({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle
        cx="50"
        cy="50"
        r="45"
        stroke="url(#symbol-gradient)"
        strokeWidth="2"
        className="opacity-40"
      />
      <path
        d="M30 25 L30 75 L70 75 M30 50 L60 50 M30 25 L70 25"
        stroke="url(#symbol-gradient)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="75" cy="50" r="6" fill="url(#symbol-dot)" />
      <defs>
        <linearGradient id="symbol-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#F0ABFC" />
        </linearGradient>
        <radialGradient id="symbol-dot" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F0ABFC" />
          <stop offset="100%" stopColor="#A855F7" />
        </radialGradient>
      </defs>
    </svg>
  );
}
