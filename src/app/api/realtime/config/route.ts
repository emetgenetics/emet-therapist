import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'INWORLD_API_KEY not set' }, { status: 500 });
  }

  let iceServers: unknown[] = [];
  try {
    const res = await fetch('https://api.inworld.ai/v1/realtime/ice-servers', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const data = await res.json();
      iceServers = data.ice_servers ?? [];
    }
  } catch (e) {
    console.warn('[Config] ICE server fetch failed, using defaults:', e);
    // Fallback to Google STUN — sessions will still work on most networks
    iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  }

  return NextResponse.json({ iceServers });
}
