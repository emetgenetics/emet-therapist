import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { EmetLogo } from '@/components/ui/EmetLogo';
import prisma from '@/lib/db';
import type { TherapySession } from '@prisma/client';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  
  if (!session) {
    redirect('/login');
  }

  const recentSessions: TherapySession[] = await prisma.therapySession.findMany({
    where: { userId: session.user.id },
    orderBy: { startedAt: 'desc' },
    take: 5,
  });

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="fixed inset-0 bg-gradient-to-br from-violet-900/10 via-slate-950 to-fuchsia-900/10 pointer-events-none" />
      
      <nav className="relative z-10 flex items-center justify-between px-8 py-6 border-b border-white/5">
        <EmetLogo size="sm" />
        <div className="flex items-center gap-4">
          <span className="text-slate-400 text-sm">{session.user.email}</span>
          <Link href="/dashboard/settings" className="btn-ghost text-sm">Settings</Link>
          <form action="/api/auth/signout" method="POST">
            <button type="submit" className="btn-ghost text-sm">
              Sign Out
            </button>
          </form>
        </div>
      </nav>

      <main className="relative z-10 max-w-6xl mx-auto px-8 py-12">
        <div className="mb-12">
          <h1 className="text-3xl font-bold text-white mb-2">Welcome back</h1>
          <p className="text-slate-400">Continue your healing journey with Emet</p>
        </div>

        <div className="mb-12">
          <Link
            href="/session/new"
            className="inline-flex items-center gap-3 btn-primary text-lg px-8 py-4"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Start New Session
          </Link>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-white mb-6">Recent Sessions</h2>
          
          {recentSessions.length === 0 ? (
            <div className="card-emet text-center py-12">
              <div className="w-16 h-16 rounded-full bg-violet-500/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-white mb-2">No sessions yet</h3>
              <p className="text-slate-400 mb-6">Start your first session to begin your healing journey</p>
              <Link href="/session/new" className="btn-secondary inline-block">
                Start Your First Session
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {recentSessions.map((s: TherapySession) => (
                <div key={s.id} className="card-emet flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        s.currentState === 'COMPLETED' ? 'bg-green-500/20 text-green-400' :
                        s.currentState === 'ABANDONED' ? 'bg-red-500/20 text-red-400' :
                        'bg-violet-500/20 text-violet-400'
                      }`}>
                        {s.currentState}
                      </span>
                      <span className="text-slate-500 text-sm">
                        {new Date(s.startedAt).toLocaleDateString()}
                      </span>
                    </div>
                    {s.sessionGoals && (
                      <p className="text-slate-400 text-sm">{s.sessionGoals}</p>
                    )}
                  </div>
                  <Link
                    href={`/session/${s.id}`}
                    className="btn-ghost"
                  >
                    View
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
