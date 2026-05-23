import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/db';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

// GET /api/auth/mfa — get MFA status
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mfaEnabled: true, mfaSecret: true },
  });

  return NextResponse.json({
    enabled: user?.mfaEnabled || false,
    hasSecret: !!user?.mfaSecret,
  });
}

// POST /api/auth/mfa/setup — generate MFA secret and QR code
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  if (action === 'setup') {
    // Generate new secret
    const secret = speakeasy.generateSecret({
      name: `Emet:${session.user.email}`,
      issuer: 'Emet',
      length: 32,
    });

    // Store secret temporarily (not enabled until verified)
    await prisma.user.update({
      where: { id: session.user.id },
      data: { mfaSecret: secret.base32 },
    });

    // Generate QR code
    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url || '');

    return NextResponse.json({
      secret: secret.base32,
      qrCode: qrCodeDataUrl,
    });
  }

  if (action === 'verify') {
    const { token } = body;
    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mfaSecret: true },
    });

    if (!user?.mfaSecret) {
      return NextResponse.json({ error: 'MFA not set up' }, { status: 400 });
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (!verified) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    // Enable MFA
    await prisma.user.update({
      where: { id: session.user.id },
      data: { mfaEnabled: true },
    });

    return NextResponse.json({ success: true, enabled: true });
  }

  if (action === 'disable') {
    const { token } = body;
    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mfaSecret: true, mfaEnabled: true },
    });

    if (!user?.mfaEnabled || !user?.mfaSecret) {
      return NextResponse.json({ error: 'MFA not enabled' }, { status: 400 });
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (!verified) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { mfaEnabled: false, mfaSecret: null },
    });

    return NextResponse.json({ success: true, enabled: false });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
