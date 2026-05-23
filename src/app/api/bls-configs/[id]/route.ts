import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/db';

// DELETE /api/bls-configs/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const config = await prisma.bLSConfiguration.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!config) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (config.isDefault) {
    return NextResponse.json({ error: 'Cannot delete default configuration' }, { status: 400 });
  }

  await prisma.bLSConfiguration.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

// POST /api/bls-configs/[id]/default — set as default
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const config = await prisma.bLSConfiguration.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!config) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Unset other defaults
  await prisma.bLSConfiguration.updateMany({
    where: { userId: session.user.id, isDefault: true },
    data: { isDefault: false },
  });

  // Set this as default
  await prisma.bLSConfiguration.update({
    where: { id },
    data: { isDefault: true },
  });

  return NextResponse.json({ success: true });
}
