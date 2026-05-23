import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/db';
import { getSystemPrompt, type TherapyState } from '@/lib/openrouter';

// POST /api/therapy/chat — send message and get AI response
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { sessionId, message, modelId } = body;

  if (!sessionId || !message) {
    return NextResponse.json({ error: 'sessionId and message required' }, { status: 400 });
  }

  // Verify session belongs to user
  const therapySession = await prisma.therapySession.findFirst({
    where: { id: sessionId, userId: session.user.id },
  });

  if (!therapySession) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Save user message
  await prisma.transcript.create({
    data: {
      sessionId,
      speaker: 'CLIENT',
      content: message,
      wordCount: message.split(/\s+/).length,
    },
  });

  // Get transcript history
  const transcripts = await prisma.transcript.findMany({
    where: { sessionId },
    orderBy: { timestamp: 'asc' },
    take: 40,
  });

  // Build messages for AI
  const systemPrompt = getSystemPrompt(therapySession.currentState as TherapyState);
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  if (therapySession.sessionGoals) {
    messages.push({ role: 'system', content: `Session goals: ${therapySession.sessionGoals}` });
  }

  messages.push({ role: 'system', content: `Current distress level: ${therapySession.distressLevel || 0}/10` });

  for (const t of transcripts) {
    messages.push({
      role: t.speaker === 'CLIENT' ? 'user' : 'assistant',
      content: t.content,
    });
  }

  try {
    const { openrouter } = await import('@/lib/openrouter');

    const completion = await openrouter.chat.completions.create({
      model: (modelId as string) || 'google/gemma-2-9b-it:free',
      messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      max_tokens: 300,
      temperature: 0.7,
    });

    const aiResponse = (completion.choices[0] as { message?: { content?: string } })?.message?.content || 'I apologize, I am having trouble responding right now. Take a moment to breathe.';

    // Save AI response
    await prisma.transcript.create({
      data: {
        sessionId,
        speaker: 'AI_THERAPIST',
        content: aiResponse,
        wordCount: aiResponse.split(/\s+/).length,
      },
    });

    return NextResponse.json({ response: aiResponse });
  } catch (error) {
    console.error('AI response error:', error);
    return NextResponse.json(
      { error: 'Failed to get AI response', response: 'I apologize, I am having a moment of difficulty. Please take a breath and try again.' },
      { status: 500 }
    );
  }
}
