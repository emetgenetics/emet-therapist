'use client';

import { useState, useCallback } from 'react';
import { useSessionStore } from '@/lib/store';
import { RealtimeClient } from '@/lib/realtime';
import PreFlight from '@/components/PreFlight';
import Session from '@/components/Session';

export default function Home() {
  const phase = useSessionStore((s) => s.phase);
  const [client, setClient] = useState<RealtimeClient | null>(null);

  const handlePreFlightReady = useCallback((realtimeClient: RealtimeClient) => {
    setClient(realtimeClient);
  }, []);

  // Show session if we have a client connected
  if (client && phase !== 'PRE_FLIGHT') {
    return <Session client={client} />;
  }

  // Default: show pre-flight
  return <PreFlight onReady={handlePreFlightReady} />;
}
