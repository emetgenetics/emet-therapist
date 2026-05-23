'use client';

import { useState, useCallback } from 'react';
import { useSessionStore } from '@/lib/store';
import { GeminiLiveClient } from '@/lib/gemini-live';
import PasswordGate from '@/components/PasswordGate';
import PreFlight from '@/components/PreFlight';
import Session from '@/components/Session';

export default function Home() {
  const phase = useSessionStore((s) => s.phase);
  const [client, setClient] = useState<GeminiLiveClient | null>(null);

  const handlePreFlightReady = useCallback((geminiClient: GeminiLiveClient) => {
    setClient(geminiClient);
  }, []);

  const app = (
    <>
      {client && phase !== 'PRE_FLIGHT' ? (
        <Session client={client} />
      ) : (
        <PreFlight onReady={handlePreFlightReady} />
      )}
    </>
  );

  return <PasswordGate>{app}</PasswordGate>;
}
