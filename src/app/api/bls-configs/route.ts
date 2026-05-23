import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/db';

// GET /api/bls-configs — list user's BLS configurations
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const configs = await prisma.bLSConfiguration.findMany({
    where: { userId: session.user.id },
    orderBy: { isDefault: 'desc' },
  });

  return NextResponse.json(configs);
}

// POST /api/bls-configs — create new BLS configuration
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    name,
    visualPattern,
    visualSpeed,
    visualIntensity,
    visualColorPrimary,
    visualColorSecondary,
    auditoryFrequency,
    auditoryVolume,
    auditoryWaveform,
    isDefault,
  } = body;

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  // If setting as default, unset other defaults
  if (isDefault) {
    await prisma.bLSConfiguration.updateMany({
      where: { userId: session.user.id, isDefault: true },
      data: { isDefault: false },
    });
  }

  const config = await prisma.bLSConfiguration.create({
    data: {
      userId: session.user.id,
      name,
      visualPattern: visualPattern || 'horizontal',
      visualSpeed: visualSpeed || 60,
      visualIntensity: visualIntensity ?? 0.7,
      visualColorPrimary: visualColorPrimary || '#8B5CF6',
      visualColorSecondary: visualColorSecondary || '#C4B5FD',
      auditoryFrequency: auditoryFrequency || 440,
      auditoryVolume: auditoryVolume ?? 0.15,
      auditoryWaveform: auditoryWaveform || 'sine',
      isDefault: isDefault || false,
    },
  });

  return NextResponse.json(config, { status: 201 });
}
