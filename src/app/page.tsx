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
    // Set client first, then phase — ensures both are updated together
    setClient(geminiClient);
    // Small delay to ensure client state is set before phase changes
    // This prevents the flash of "Connecting..." state
    useSessionStore.getState().setPhase('INTAKE');
  }, []);

  // Show session only when BOTH client is set AND phase is not PRE_FLIGHT
  const showSession = client !== null && phase !== 'PRE_FLIGHT';

  const app = (
    <>
      {showSession ? (
        <Session client={client} />
      ) : (
        <PreFlight onReady={handlePreFlightReady} />
      )}
    </>
  );

  return <PasswordGate>{app}</PasswordGate>;
}
