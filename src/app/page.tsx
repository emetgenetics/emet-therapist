'use client';

import { useState } from 'react';
import PasswordGate from '@/components/PasswordGate';
import PreFlight from '@/components/PreFlight';
import Session from '@/components/Session';

export default function Home() {
  const [started, setStarted] = useState(false);

  return (
    <PasswordGate>
      {started ? <Session /> : <PreFlight onStart={() => setStarted(true)} />}
    </PasswordGate>
  );
}
