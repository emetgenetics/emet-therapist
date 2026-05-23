import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/db';
import { EmetLogo } from '@/components/ui/EmetLogo';
import Link from 'next/link';

interface AdminEvent {
  id: string;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  createdAt: Date;
  session: { id: string; user: { email: string } } | null;
}

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    redirect('/dashboard');
  }

  const user = session.user;

  const [userCount, sessionCount, recentEventsRaw] = await Promise.all([
    prisma.user.count(),
    prisma.therapySession.count(),
    prisma.sessionEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        session: { select: { id: true, user: { select: { email: true } } } },
      },
    }),
  ]);

  const recentEvents: AdminEvent[] = recentEventsRaw;

  const activeSessions = await prisma.therapySession.count({
    where: { currentState: { notIn: ['COMPLETED', 'ABANDONED'] } },
  });

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="fixed inset-0 bg-gradient-to-br from-violet-900/10 via-slate-950 to-fuchsia-900/10 pointer-events-none" />

      <nav className="relative z-10 flex items-center justify-between px-8 py-6 border-b border-white/5">
        <Link href="/dashboard">
          <EmetLogo size="sm" />
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-slate-400 text-sm">{user.email}</span>
          <span className="px-2 py-1 bg-violet-500/20 text-violet-400 text-xs rounded-md font-medium">Admin</span>
          <Link href="/dashboard" className="btn-ghost text-sm">Dashboard</Link>
        </div>
      </nav>

      <main className="relative z-10 max-w-6xl mx-auto px-8 py-12">
        <h1 className="text-3xl font-bold text-white mb-2">Admin Dashboard</h1>
        <p className="text-slate-400 mb-10">System overview and monitoring</p>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-6 mb-12">
          <div className="card-emet">
            <div className="text-3xl font-bold text-white mb-1">{userCount}</div>
            <div className="text-sm text-slate-400">Total Users</div>
          </div>
          <div className="card-emet">
            <div className="text-3xl font-bold text-white mb-1">{sessionCount}</div>
            <div className="text-sm text-slate-400">Total Sessions</div>
          </div>
          <div className="card-emet">
            <div className="text-3xl font-bold text-emerald-400 mb-1">{activeSessions}</div>
            <div className="text-sm text-slate-400">Active Sessions</div>
          </div>
          <div className="card-emet">
            <div className="text-3xl font-bold text-violet-400 mb-1">
              {sessionCount > 0 ? Math.round((activeSessions / sessionCount) * 100) : 0}%
            </div>
            <div className="text-sm text-slate-400">Active Rate</div>
          </div>
        </div>

        {/* Recent Events */}
        <div>
          <h2 className="text-xl font-semibold text-white mb-6">Recent Events</h2>
          <div className="card-emet overflow-hidden p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-6 py-3">Event</th>
                  <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-6 py-3">User</th>
                  <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-6 py-3">From</th>
                  <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-6 py-3">To</th>
                  <th className="text-left text-xs text-slate-500 uppercase tracking-wider px-6 py-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((event: AdminEvent) => (
                  <tr key={event.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-6 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        event.eventType === 'EMERGENCY_TRIGGERED' ? 'bg-red-500/20 text-red-400' :
                        event.eventType === 'STATE_TRANSITION' ? 'bg-violet-500/20 text-violet-400' :
                        event.eventType === 'DISTRESS_DETECTED' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-white/5 text-slate-400'
                      }`}>
                        {event.eventType}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-300">
                      {event.session?.user?.email || 'Unknown'}
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-400">{event.fromState || '—'}</td>
                    <td className="px-6 py-3 text-sm text-slate-400">{event.toState || '—'}</td>
                    <td className="px-6 py-3 text-sm text-slate-500">
                      {new Date(event.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
