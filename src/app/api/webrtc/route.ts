/**
 * WebRTC SDP exchange proxy for Inworld Realtime API.
 * Keeps the API key server-side. Browser sends SDP offer, we forward it
 * to Inworld and return the SDP answer.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const sdpOffer = await req.text();

  const apiKey = (process.env.NEXT_PUBLIC_INWORLD_API_KEY || process.env.INWORLD_API_KEY || '').trim();

  if (!apiKey) {
    return new NextResponse('API key not configured', { status: 500 });
  }

  const response = await fetch('https://api.inworld.ai/v1/realtime/calls', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${apiKey}`,
      'Content-Type': 'application/sdp',
    },
    body: sdpOffer,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[WebRTC] Inworld API error:', response.status, errText);
    return new NextResponse(`Inworld API Error: ${response.status} ${errText}`, {
      status: response.status,
    });
  }

  const sdpAnswer = await response.text();
  return new NextResponse(sdpAnswer, {
    headers: { 'Content-Type': 'application/sdp' },
  });
}
