/**
 * Return the Inworld API key for Realtime API connections.
 * The Realtime API uses the API key directly for auth — no token generation needed.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const apiKey = process.env.INWORLD_API_KEY || process.env.NEXT_PUBLIC_INWORLD_API_KEY || '';

  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  return NextResponse.json({ apiKey });
}
