'use client';

import { useState, useCallback } from 'react';
import { useSessionStore } from '@/lib/store';
import { RealtimeClient } from '@/lib/realtime';
import PasswordGate from '@/components/PasswordGate';
import PreFlight from '@/components/PreFlight';
import Session from '@/components/Session';

export default function Home() {
  const phase = useSessionStore((s) => s.phase);
  const [client, setClient] = useState<RealtimeClient | null>(null);

  const handlePreFlightReady = useCallback((realtimeClient: RealtimeClient) => {
    setClient(realtimeClient);
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
