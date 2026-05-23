import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/db';

// GET /api/sessions/[sessionId] — get session details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;

  const therapySession = await prisma.therapySession.findFirst({
    where: { id: sessionId, userId: session.user.id },
    include: {
      transcripts: { orderBy: { timestamp: 'asc' }, take: 200 },
      events: { orderBy: { createdAt: 'asc' }, take: 100 },
    },
  });

  if (!therapySession) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json(therapySession);
}

// PATCH /api/sessions/[sessionId] — update session state
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;
  const body = await req.json().catch(() => ({}));
  const { currentState, distressLevel, therapistNotes, sessionGoals } = body;

  const therapySession = await prisma.therapySession.findFirst({
    where: { id: sessionId, userId: session.user.id },
  });

  if (!therapySession) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};

  if (currentState) {
    const oldState = therapySession.currentState;
    const newHistory = [...(therapySession.stateHistory as Array<Record<string, unknown>>), {
      from: oldState,
      to: currentState,
      timestamp: new Date().toISOString(),
    }];
    updateData.currentState = currentState;
    updateData.stateHistory = newHistory;

    // Log state transition event
    await prisma.sessionEvent.create({
      data: {
        sessionId,
        userId: session.user.id,
        eventType: 'STATE_TRANSITION',
        fromState: oldState,
        toState: currentState,
      },
    });
  }

  if (distressLevel !== undefined) {
    updateData.distressLevel = distressLevel;
    if (distressLevel >= 8) {
      await prisma.sessionEvent.create({
        data: {
          sessionId,
          userId: session.user.id,
          eventType: 'DISTRESS_DETECTED',
          fromState: therapySession.currentState,
          toState: therapySession.currentState,
          metadata: { level: distressLevel },
        },
      });
    }
  }

  if (therapistNotes !== undefined) updateData.therapistNotes = therapistNotes;
  if (sessionGoals !== undefined) updateData.sessionGoals = sessionGoals;

  const updated = await prisma.therapySession.update({
    where: { id: sessionId },
    data: updateData,
  });

  return NextResponse.json(updated);
}

// DELETE /api/sessions/[sessionId] — end/abandon session
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;

  const therapySession = await prisma.therapySession.findFirst({
    where: { id: sessionId, userId: session.user.id },
  });

  if (!therapySession) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const updated = await prisma.therapySession.update({
    where: { id: sessionId },
    data: {
      currentState: 'ABANDONED',
      endedAt: new Date(),
    },
  });

  return NextResponse.json(updated);
}
