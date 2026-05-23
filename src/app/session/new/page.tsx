'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { EmetLogo } from '@/components/ui/EmetLogo';

export default function NewSessionPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionGoals, setSessionGoals] = useState('');

  const handleStartSession = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionGoals: sessionGoals || undefined }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409 && data.sessionId) {
          router.push(`/session/${data.sessionId}`);
          return;
        }
        throw new Error(data.error || 'Failed to create session');
      }

      const session = await res.json();
      router.push(`/session/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="fixed inset-0 bg-gradient-to-br from-violet-900/10 via-slate-950 to-fuchsia-900/10 pointer-events-none" />

      <nav className="relative z-10 flex items-center justify-between px-8 py-6 border-b border-white/5">
        <Link href="/dashboard">
          <EmetLogo size="sm" />
        </Link>
        <Link href="/dashboard" className="btn-ghost text-sm">
          ← Back to Dashboard
        </Link>
      </nav>

      <main className="relative z-10 flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-lg">
          <div className="text-center mb-10">
            <div className="w-20 h-20 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white mb-3">Begin New Session</h1>
            <p className="text-slate-400 leading-relaxed">
              Create a safe space for your healing journey. You can stop at any time.
            </p>
          </div>

          <div className="card-emet space-y-6">
            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Session Goals <span className="text-slate-500">(optional)</span>
              </label>
              <textarea
                value={sessionGoals}
                onChange={(e) => setSessionGoals(e.target.value)}
                className="input-emet min-h-[100px] resize-none"
                placeholder="What would you like to work on today? (e.g., process grief around a specific loss, find closure, explore a memory...)"
              />
            </div>

            <div className="p-4 bg-violet-500/5 border border-violet-500/10 rounded-xl">
              <h3 className="text-sm font-medium text-violet-300 mb-2">Before you begin</h3>
              <ul className="text-xs text-slate-400 space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="text-violet-400 mt-0.5">•</span>
                  Find a quiet, private space where you feel safe
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-violet-400 mt-0.5">•</span>
                  Use headphones for the best experience
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-violet-400 mt-0.5">•</span>
                  Ensure your microphone is working
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-violet-400 mt-0.5">•</span>
                  You can pause or stop at any time
                </li>
              </ul>
            </div>

            <button
              onClick={handleStartSession}
              disabled={loading}
              className="btn-primary w-full text-lg py-4 disabled:opacity-50"
            >
              {loading ? 'Creating Session...' : 'Start Session'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
