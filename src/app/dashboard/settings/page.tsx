'use client';

import { useState, useEffect } from 'react';
import { getServerSession } from 'next-auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { EmetLogo } from '@/components/ui/EmetLogo';

interface BLSConfig {
  id: string;
  name: string;
  visualPattern: string;
  visualSpeed: number;
  visualIntensity: number;
  visualColorPrimary: string;
  visualColorSecondary: string;
  auditoryFrequency: number;
  auditoryVolume: number;
  auditoryWaveform: string;
  isDefault: boolean;
}

export default function SettingsPage() {
  const router = useRouter();
  const [configs, setConfigs] = useState<BLSConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'bls' | 'consent'>('bls');

  // BLS form state
  const [formData, setFormData] = useState({
    name: 'My Configuration',
    visualPattern: 'horizontal',
    visualSpeed: 60,
    visualIntensity: 0.7,
    visualColorPrimary: '#8B5CF6',
    visualColorSecondary: '#C4B5FD',
    auditoryFrequency: 440,
    auditoryVolume: 0.15,
    auditoryWaveform: 'sine',
  });

  useEffect(() => {
    fetch('/api/bls-configs')
      .then((r) => r.json())
      .then((data) => setConfigs(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSaveBLS = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/bls-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        const newConfig = await res.json();
        setConfigs((prev) => [...prev, newConfig]);
      }
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/bls-configs/${id}`, { method: 'DELETE' });
      setConfigs((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await fetch(`/api/bls-configs/${id}/default`, { method: 'POST' });
      setConfigs((prev) =>
        prev.map((c) => ({ ...c, isDefault: c.id === id }))
      );
    } catch (err) {
      console.error('Set default error:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="fixed inset-0 bg-gradient-to-br from-violet-900/10 via-slate-950 to-fuchsia-900/10 pointer-events-none" />

      <nav className="relative z-10 flex items-center justify-between px-8 py-6 border-b border-white/5">
        <Link href="/dashboard">
          <EmetLogo size="sm" />
        </Link>
        <Link href="/dashboard" className="btn-ghost text-sm">← Dashboard</Link>
      </nav>

      <main className="relative z-10 max-w-4xl mx-auto px-8 py-12">
        <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
        <p className="text-slate-400 mb-10">Configure your therapy experience</p>

        {/* Tabs */}
        <div className="flex gap-2 mb-8">
          <button
            onClick={() => setActiveTab('bls')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'bls'
                ? 'bg-violet-600 text-white'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            BLS Configuration
          </button>
          <button
            onClick={() => setActiveTab('consent')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'consent'
                ? 'bg-violet-600 text-white'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            Consent Management
          </button>
        </div>

        {activeTab === 'bls' && (
          <div className="space-y-8">
            {/* Existing configs */}
            {configs.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-white mb-4">Your Configurations</h2>
                <div className="space-y-3">
                  {configs.map((config) => (
                    <div key={config.id} className="card-emet flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div
                          className="w-8 h-8 rounded-lg"
                          style={{ background: `linear-gradient(135deg, ${config.visualColorPrimary}, ${config.visualColorSecondary})` }}
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-medium">{config.name}</span>
                            {config.isDefault && (
                              <span className="px-2 py-0.5 bg-violet-500/20 text-violet-400 text-xs rounded">Default</span>
                            )}
                          </div>
                          <span className="text-xs text-slate-500">
                            {config.visualPattern} · {config.visualSpeed} BPM · {config.visualColorPrimary}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!config.isDefault && (
                          <button
                            onClick={() => handleSetDefault(config.id)}
                            className="btn-ghost text-xs"
                          >
                            Set Default
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(config.id)}
                          className="btn-ghost text-xs text-red-400"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Create new */}
            <div className="card-emet">
              <h2 className="text-lg font-semibold text-white mb-6">Create New Configuration</h2>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Name</label>
                  <input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input-emet"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Pattern</label>
                  <select
                    value={formData.visualPattern}
                    onChange={(e) => setFormData({ ...formData, visualPattern: e.target.value })}
                    className="input-emet"
                  >
                    <option value="horizontal">Horizontal Bar</option>
                    <option value="circular">Circular</option>
                    <option value="butterfly">Butterfly</option>
                    <option value="dotfield">Dot Field</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Speed: {formData.visualSpeed} BPM</label>
                  <input
                    type="range"
                    min="20"
                    max="120"
                    value={formData.visualSpeed}
                    onChange={(e) => setFormData({ ...formData, visualSpeed: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Intensity: {Math.round(formData.visualIntensity * 100)}%</label>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={formData.visualIntensity * 100}
                    onChange={(e) => setFormData({ ...formData, visualIntensity: Number(e.target.value) / 100 })}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Primary Color</label>
                  <input
                    type="color"
                    value={formData.visualColorPrimary}
                    onChange={(e) => setFormData({ ...formData, visualColorPrimary: e.target.value })}
                    className="w-full h-10 rounded-lg cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Secondary Color</label>
                  <input
                    type="color"
                    value={formData.visualColorSecondary}
                    onChange={(e) => setFormData({ ...formData, visualColorSecondary: e.target.value })}
                    className="w-full h-10 rounded-lg cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Audio Frequency: {formData.auditoryFrequency}Hz</label>
                  <input
                    type="range"
                    min="100"
                    max="1000"
                    value={formData.auditoryFrequency}
                    onChange={(e) => setFormData({ ...formData, auditoryFrequency: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Audio Volume: {Math.round(formData.auditoryVolume * 100)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={formData.auditoryVolume * 100}
                    onChange={(e) => setFormData({ ...formData, auditoryVolume: Number(e.target.value) / 100 })}
                    className="w-full"
                  />
                </div>
              </div>
              <button
                onClick={handleSaveBLS}
                disabled={saving}
                className="btn-primary mt-6 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'consent' && (
          <ConsentManager />
        )}
      </main>
    </div>
  );
}

function ConsentManager() {
  const [consents, setConsents] = useState<Record<string, { granted: boolean; version: string; required: boolean }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/consent')
      .then((r) => r.json())
      .then((data) => setConsents(data || {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleConsent = async (type: string, granted: boolean) => {
    try {
      await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consentType: type, granted, version: '1.0' }),
      });
      setConsents((prev) => ({
        ...prev,
        [type]: { ...prev[type], granted, version: '1.0' },
      }));
    } catch (err) {
      console.error('Consent error:', err);
    }
  };

  if (loading) return <div className="text-slate-400">Loading...</div>;

  const consentLabels: Record<string, { title: string; description: string }> = {
    TERMS_OF_SERVICE: { title: 'Terms of Service', description: 'Agreement to the terms and conditions of using Emet.' },
    PRIVACY_POLICY: { title: 'Privacy Policy', description: 'Acknowledgment of how your data is collected and used.' },
    THERAPY_CONSENT: { title: 'Therapy Consent', description: 'Consent to participate in AI-guided IADC therapy sessions.' },
    DATA_PROCESSING: { title: 'Data Processing', description: 'Consent to process session transcripts and therapeutic data.' },
  };

  return (
    <div className="space-y-4">
      {Object.entries(consents).map(([type, data]) => {
        const label = consentLabels[type] || { title: type, description: '' };
        return (
          <div key={type} className="card-emet flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-medium">{label.title}</span>
                {data.required && (
                  <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs rounded">Required</span>
                )}
              </div>
              <p className="text-sm text-slate-400 mt-1">{label.description}</p>
              {data.version && (
                <span className="text-xs text-slate-600">Version {data.version}</span>
              )}
            </div>
            <button
              onClick={() => toggleConsent(type, !data.granted)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                data.granted
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
              }`}
            >
              {data.granted ? 'Granted ✓' : 'Grant'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
