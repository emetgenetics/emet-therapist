import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/db';

// GET /api/sessions — list user sessions
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessions = await prisma.therapySession.findMany({
    where: { userId: session.user.id },
    orderBy: { startedAt: 'desc' },
    take: 50,
  });

  return NextResponse.json(sessions);
}

// POST /api/sessions — create new session
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { sessionGoals } = body;

  // Check for active session
  const activeSession = await prisma.therapySession.findFirst({
    where: {
      userId: session.user.id,
      currentState: { notIn: ['COMPLETED', 'ABANDONED'] },
    },
  });

  if (activeSession) {
    return NextResponse.json({ error: 'An active session already exists', sessionId: activeSession.id }, { status: 409 });
  }

  const newSession = await prisma.therapySession.create({
    data: {
      userId: session.user.id,
      currentState: 'PRE_FLIGHT',
      sessionGoals: sessionGoals || null,
      stateHistory: [{ state: 'PRE_FLIGHT', enteredAt: new Date().toISOString() }],
    },
  });

  return NextResponse.json(newSession, { status: 201 });
}
