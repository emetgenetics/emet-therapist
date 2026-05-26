'use client';

import { useState, useEffect } from 'react';

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState(false);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionStorage.getItem('emet_auth') === 'true') {
      setAuth(true);
    }
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (auth) return <>{children}</>;

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pwd === (process.env.NEXT_PUBLIC_APP_PASSWORD || 'emet2024')) {
            sessionStorage.setItem('emet_auth', 'true');
            setAuth(true);
          } else {
            setErr('Wrong password');
            setPwd('');
          }
        }}
        className="w-80 space-y-4"
      >
        <h1 className="text-2xl text-white text-center">EMET</h1>
        <p className="text-sm text-white/40 text-center">IADC Therapeutic Session</p>
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full bg-white/10 text-white px-4 py-3 rounded"
        />
        {err && <p className="text-red-400 text-sm">{err}</p>}
        <button
          type="submit"
          className="w-full bg-white/20 text-white py-3 rounded hover:bg-white/30 transition-colors"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
