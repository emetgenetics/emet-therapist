import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/db';

// GET /api/consent — get user's consent status
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Return required consent types and their status
  const requiredConsents = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'THERAPY_CONSENT', 'DATA_PROCESSING'];

  const consents = await prisma.consentRecord.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
  });

  const latestByType = new Map<string, { granted: boolean; version: string; createdAt: string }>();
  for (const c of consents) {
    if (!latestByType.has(c.consentType)) {
      latestByType.set(c.consentType, {
        granted: c.granted,
        version: c.version,
        createdAt: c.createdAt.toISOString(),
      });
    }
  }

  const result: Record<string, { granted: boolean; version: string; createdAt: string; required: boolean }> = {};
  for (const type of requiredConsents) {
    const existing = latestByType.get(type);
    result[type] = {
      granted: existing?.granted ?? false,
      version: existing?.version ?? '1.0',
      createdAt: existing?.createdAt ?? '',
      required: true,
    };
  }

  return NextResponse.json(result);
}

// POST /api/consent — grant or revoke consent
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { consentType, granted, version } = body;

  if (!consentType || granted === undefined) {
    return NextResponse.json({ error: 'consentType and granted are required' }, { status: 400 });
  }

  // Get IP and user agent
  const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null;
  const userAgent = req.headers.get('user-agent') || null;

  const consent = await prisma.consentRecord.create({
    data: {
      userId: session.user.id,
      consentType,
      granted,
      version: version || '1.0',
      ipAddress,
      userAgent,
    },
  });

  return NextResponse.json(consent);
}
