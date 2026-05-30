import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) {
    return new NextResponse('INWORLD_API_KEY not set', { status: 500 });
  }

  const sdpOffer = await req.text();

  const res = await fetch('https://api.inworld.ai/v1/realtime/calls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sdp',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: sdpOffer,
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[SDP] Inworld error:', res.status, body);
    return new NextResponse(body, { status: res.status });
  }

  const sdpAnswer = await res.text();
  return new NextResponse(sdpAnswer, {
    headers: { 'Content-Type': 'application/sdp' },
  });
}
