import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/db';

// POST /api/sessions/[sessionId]/transcript — save transcript entries
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;
  const body = await req.json().catch(() => ({}));
  const { entries } = body;

  if (!entries || !Array.isArray(entries)) {
    return NextResponse.json({ error: 'Entries array required' }, { status: 400 });
  }

  const therapySession = await prisma.therapySession.findFirst({
    where: { id: sessionId, userId: session.user.id },
  });

  if (!therapySession) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const created = await prisma.transcript.createMany({
    data: entries.map((entry: Record<string, unknown>) => ({
      sessionId,
      speaker: entry.speaker as 'CLIENT' | 'AI_THERAPIST' | 'SYSTEM',
      content: entry.content as string,
      wordCount: ((entry.content as string)?.split(/\s+/).length) || 0,
      durationMs: entry.durationMs as number | undefined,
    })),
  });

  return NextResponse.json({ saved: created.count });
}
