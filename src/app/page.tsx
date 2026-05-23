import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { EmetLogo } from '@/components/ui/EmetLogo';
import { authOptions } from '@/lib/auth';

export default async function Home() {
  const session = await getServerSession(authOptions);
  
  if (session) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-violet-900/20 via-slate-950 to-fuchsia-900/20 pointer-events-none" />
      
      {/* Navigation */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-6">
        <EmetLogo size="md" />
        <div className="flex items-center gap-4">
          <Link href="/login" className="btn-ghost">
            Sign In
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-8 text-center">
        <div className="max-w-4xl mx-auto">
          {/* Animated symbol */}
          <div className="mb-8 animate-float">
            <svg
              width={120}
              height={120}
              viewBox="0 0 100 100"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="mx-auto"
            >
              <circle
                cx="50"
                cy="50"
                r="45"
                stroke="url(#hero-gradient)"
                strokeWidth="2"
                className="opacity-40"
              />
              <path
                d="M30 25 L30 75 L70 75 M30 50 L60 50 M30 25 L70 25"
                stroke="url(#hero-gradient)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <circle cx="75" cy="50" r="8" fill="url(#hero-dot)" className="animate-pulse" />
              <defs>
                <linearGradient id="hero-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#8B5CF6" />
                  <stop offset="50%" stopColor="#A78BFA" />
                  <stop offset="100%" stopColor="#F0ABFC" />
                </linearGradient>
                <radialGradient id="hero-dot" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#F0ABFC" />
                  <stop offset="100%" stopColor="#A855F7" />
                </radialGradient>
              </defs>
            </svg>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6 emet-gradient-text">
            Emet
          </h1>
          
          <p className="text-xl md:text-2xl text-slate-300 mb-4 font-light">
            Induced After-Death Communication Therapy
          </p>
          
          <p className="text-lg text-slate-400 mb-12 max-w-2xl mx-auto leading-relaxed">
            A safe, AI-guided therapeutic experience to help you process grief and connect with what matters most. 
            Powered by advanced voice AI and bilateral stimulation technology.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/login" className="btn-primary text-lg px-8 py-4">
              Begin Your Journey
            </Link>
          </div>

          {/* Features */}
          <div className="mt-20 grid md:grid-cols-3 gap-8">
            <div className="card-emet text-left">
              <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Compassionate AI</h3>
              <p className="text-slate-400 text-sm">Voice-first AI therapist trained in IADC protocols, providing steady guidance through your healing journey.</p>
            </div>

            <div className="card-emet text-left">
              <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Bilateral Stimulation</h3>
              <p className="text-slate-400 text-sm">Synchronized visual and auditory BLS to support natural processing and emotional regulation.</p>
            </div>

            <div className="card-emet text-left">
              <div className="w-12 h-12 rounded-xl bg-fuchsia-500/20 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-fuchsia-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Private & Secure</h3>
              <p className="text-slate-400 text-sm">Your sessions are encrypted and private. You have full control over your data at all times.</p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-8 text-center text-slate-500 text-sm">
        <p>© 2026 Emet. All rights reserved.</p>
        <p className="mt-2 text-xs text-slate-600">
          Emet means "truth" in Hebrew. This tool is designed to support, not replace, professional therapy.
        </p>
      </footer>
    </div>
  );
}
