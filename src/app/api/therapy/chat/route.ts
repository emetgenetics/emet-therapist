import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/db';
import { getSystemPrompt, type TherapyState } from '@/lib/openrouter';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { sessionId, message, sessionState, distressLevel, sessionGoals, transcriptHistory } = body;

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

  // Use provided state or fall back to DB state
  const currentState = (sessionState as TherapyState) || therapySession.currentState as TherapyState;
  const currentDistress = distressLevel ?? therapySession.distressLevel ?? 0;
  const goals = sessionGoals || therapySession.sessionGoals;

  // Build messages for AI
  const systemPrompt = getSystemPrompt(currentState);
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  if (goals) {
    messages.push({ role: 'system', content: `Session goals: ${goals}` });
  }

  messages.push({ role: 'system', content: `Current distress level: ${currentDistress}/10` });

  // Use provided transcript history or fetch from DB
  if (transcriptHistory && Array.isArray(transcriptHistory)) {
    for (const t of transcriptHistory) {
      messages.push({
        role: t.speaker === 'CLIENT' ? 'user' : 'assistant',
        content: t.content,
      });
    }
  } else {
    const transcripts = await prisma.transcript.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
      take: 40,
    });
    for (const t of transcripts) {
      messages.push({
        role: t.speaker === 'CLIENT' ? 'user' : 'assistant',
        content: t.content,
      });
    }
  }

  try {
    const { openrouter } = await import('@/lib/openrouter');

    const completion = await openrouter.chat.completions.create({
      model: 'google/gemma-2-9b-it:free',
      messages,
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

    // Determine if AI is suggesting a state transition based on response content
    let newState: string | undefined;
    const responseLower = aiResponse.toLowerCase();
    
    // Simple heuristic: check if AI mentions moving to next phase
    if (currentState === 'INTAKE' && (responseLower.includes('desensitization') || responseLower.includes('ready to begin'))) {
      newState = 'DESENSITIZATION';
    } else if (currentState === 'DESENSITIZATION' && (responseLower.includes('pivot') || responseLower.includes('let go of the memory'))) {
      newState = 'PIVOT';
    } else if (currentState === 'PIVOT' && (responseLower.includes('reconnection') || responseLower.includes('open to'))) {
      newState = 'RECONNECTION';
    } else if (currentState === 'RECONNECTION' && (responseLower.includes('integration') || responseLower.includes('process your experience'))) {
      newState = 'INTEGRATION';
    } else if (currentState === 'INTEGRATION' && (responseLower.includes('complete') || responseLower.includes('grounded and stable'))) {
      newState = 'COMPLETED';
    }

    // Detect distress level changes
    let newDistressLevel: number | undefined;
    if (responseLower.includes('distress') && responseLower.includes('high')) {
      newDistressLevel = Math.min(10, currentDistress + 2);
    } else if (responseLower.includes('calm') || responseLower.includes('relaxed') || responseLower.includes('peaceful')) {
      newDistressLevel = Math.max(0, currentDistress - 1);
    }

    return NextResponse.json({
      response: aiResponse,
      newState,
      distressLevel: newDistressLevel,
    });
  } catch (error) {
    console.error('AI response error:', error);
    return NextResponse.json(
      { error: 'Failed to get AI response', response: 'I apologize, I am having a moment of difficulty. Please take a breath and try again.' },
      { status: 500 }
    );
  }
}
