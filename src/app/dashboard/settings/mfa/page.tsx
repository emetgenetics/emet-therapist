'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function MFASettingsPage() {
  const [status, setStatus] = useState<{ enabled: boolean; hasSecret: boolean }>({ enabled: false, hasSecret: false });
  const [loading, setLoading] = useState(true);
  const [setupData, setSetupData] = useState<{ secret: string; qrCode: string } | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/auth/mfa')
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSetup = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setup' }),
      });
      if (!res.ok) throw new Error('Failed to setup MFA');
      const data = await res.json();
      setSetupData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!token || token.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', token }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Verification failed');
      }
      setSuccess('MFA enabled successfully!');
      setSetupData(null);
      setToken('');
      setStatus({ enabled: true, hasSecret: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    if (!token || token.length !== 6) {
      setError('Please enter your current 6-digit code');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable', token }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to disable MFA');
      }
      setSuccess('MFA disabled successfully');
      setToken('');
      setStatus({ enabled: false, hasSecret: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="fixed inset-0 bg-gradient-to-br from-violet-900/10 via-slate-950 to-fuchsia-900/10 pointer-events-none" />

      <nav className="relative z-10 flex items-center justify-between px-8 py-6 border-b border-white/5">
        <Link href="/dashboard" className="text-xl font-bold emet-gradient-text">Emet</Link>
        <Link href="/dashboard/settings" className="btn-ghost text-sm">← Settings</Link>
      </nav>

      <main className="relative z-10 max-w-lg mx-auto px-8 py-12">
        <h1 className="text-3xl font-bold text-white mb-2">Multi-Factor Authentication</h1>
        <p className="text-slate-400 mb-10">Add an extra layer of security to your account</p>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm mb-6">{error}</div>
        )}
        {success && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm mb-6">{success}</div>
        )}

        <div className="card-emet">
          {status.enabled ? (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">MFA is Enabled</h2>
                  <p className="text-sm text-slate-400">Your account is protected with TOTP</p>
                </div>
              </div>

              <div className="border-t border-white/5 pt-6">
                <h3 className="text-sm font-medium text-slate-300 mb-4">Disable MFA</h3>
                <p className="text-xs text-slate-500 mb-4">Enter your current authenticator code to disable MFA</p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="input-emet w-32 text-center text-lg tracking-widest"
                    maxLength={6}
                  />
                  <button
                    onClick={handleDisable}
                    disabled={saving || token.length !== 6}
                    className="btn-secondary text-red-400 border-red-500/20 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {saving ? 'Disabling...' : 'Disable MFA'}
                  </button>
                </div>
              </div>
            </div>
          ) : setupData ? (
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">Scan QR Code</h2>
              <p className="text-sm text-slate-400 mb-6">
                Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
              </p>

              <div className="flex justify-center mb-6">
                <img src={setupData.qrCode} alt="MFA QR Code" className="w-48 h-48 rounded-xl" />
              </div>

              <div className="p-3 bg-white/5 rounded-lg mb-6">
                <p className="text-xs text-slate-500 mb-1">Manual entry code:</p>
                <code className="text-sm text-violet-300 font-mono break-all">{setupData.secret}</code>
              </div>

              <div className="border-t border-white/5 pt-6">
                <h3 className="text-sm font-medium text-slate-300 mb-4">Verify Setup</h3>
                <p className="text-xs text-slate-500 mb-4">Enter the 6-digit code from your authenticator app</p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="input-emet w-32 text-center text-lg tracking-widest"
                    maxLength={6}
                  />
                  <button
                    onClick={handleVerify}
                    disabled={saving || token.length !== 6}
                    className="btn-primary disabled:opacity-50"
                  >
                    {saving ? 'Verifying...' : 'Verify & Enable'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">MFA is Not Enabled</h2>
                  <p className="text-sm text-slate-400">Protect your account with time-based one-time passwords</p>
                </div>
              </div>

              <button
                onClick={handleSetup}
                disabled={saving}
                className="btn-primary w-full disabled:opacity-50"
              >
                {saving ? 'Setting up...' : 'Setup MFA'}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
