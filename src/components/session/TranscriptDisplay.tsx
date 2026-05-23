'use client';

import { useEffect, useRef } from 'react';

interface TranscriptEntry {
  id: string;
  speaker: 'CLIENT' | 'AI_THERAPIST' | 'SYSTEM';
  content: string;
  timestamp: Date;
}

interface TranscriptDisplayProps {
  entries: TranscriptEntry[];
}

export function TranscriptDisplay({ entries }: TranscriptDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
        <p>Session transcript will appear here...</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex flex-col gap-3 overflow-y-auto max-h-64 pr-2">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`flex flex-col ${
            entry.speaker === 'CLIENT' ? 'items-end' : 'items-start'
          }`}
        >
          <div
            className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
              entry.speaker === 'CLIENT'
                ? 'bg-violet-600/20 text-violet-100 rounded-br-md'
                : entry.speaker === 'SYSTEM'
                ? 'bg-white/5 text-slate-400 text-xs italic'
                : 'bg-white/10 text-slate-200 rounded-bl-md'
            }`}
          >
            {entry.content}
          </div>
          <span className="text-[10px] text-slate-600 mt-1 px-2">
            {entry.speaker === 'CLIENT' ? 'You' : entry.speaker === 'AI_THERAPIST' ? 'Emet' : 'System'} · {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      ))}
    </div>
  );
}
