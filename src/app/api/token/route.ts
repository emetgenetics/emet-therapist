/**
 * Generate an Inworld session token
 * Implements the IW1-HMAC-SHA256 auth scheme manually
 * Uses gRPC to call GenerateToken on api-engine.inworld.ai
 */

import { NextResponse } from 'next/server';
import * as crypto from 'crypto';

const INWORLD_API_KEY = process.env.NEXT_PUBLIC_INWORLD_API_KEY || '';
const ENGINE_HOST = 'api-engine.inworld.ai:443';

function parseApiKey(base64Key: string) {
  const decoded = Buffer.from(base64Key, 'base64').toString();
  const [key, secret] = decoded.split(':');
  return { key, secret };
}

function getDateTime() {
  const now = new Date();
  const date = now.toISOString().split('T')[0].replace(/-/g, '');
  const time = now.toISOString().split('T')[1].replace(/:/g, '').substring(0, 6);
  return `${date}${time}`;
}

function hmacSha256(key: string | Buffer, data: string): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function getAuthorization(apiKey: { key: string; secret: string }, host: string, method: string) {
  const datetime = getDateTime();
  const nonce = crypto.randomBytes(16).toString('hex').slice(1, 12);
  
  // Build signature
  let sig = `IW1${apiKey.secret}`;
  for (const p of [datetime, host.replace(':443', ''), method, nonce]) {
    sig = hmacSha256(sig, p);
  }
  sig = hmacSha256(sig, 'iw1_request');
  
  return `IW1-HMAC-SHA256 ApiKey=${apiKey.key},DateTime=${datetime},Nonce=${nonce},Signature=${sig}`;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!INWORLD_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  try {
    const apiKey = parseApiKey(INWORLD_API_KEY);
    const host = ENGINE_HOST.replace(':443', '');
    const method = 'ai.inworld.engine.WorldEngine/GenerateToken';
    const auth = getAuthorization(apiKey, host, method);

    // Make gRPC-Web HTTP request to generate token
    // Inworld uses gRPC-Web which can be called via HTTP POST
    const url = `https://${ENGINE_HOST}/ai.inworld.engine.WorldEngine/GenerateToken`;
    
    // Build the protobuf request for GenerateToken
    // GenerateTokenRequest has: key (string), resources (repeated string)
    const workspaceId = 'default'; // Extract from scene or use default
    const resource = `workspaces/${workspaceId}`;
    
    // Simple protobuf encoding for GenerateTokenRequest
    // field 1 (key) = string, field 2 (resources) = repeated string
    const requestBody = JSON.stringify({
      key: apiKey.key,
      resources: [resource],
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth,
        'Accept': 'application/json',
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Token] gRPC error:', response.status, errorText);
      return NextResponse.json(
        { error: `Token generation failed: ${response.status} ${errorText.substring(0, 200)}` },
        { status: 500 }
      );
    }

    const data = await response.json();
    console.log('[Token] Response:', JSON.stringify(data).substring(0, 200));

    return NextResponse.json({
      sessionId: data.sessionId || data.session_id,
      token: data.token,
      type: data.type || 'Bearer',
    });
  } catch (err: any) {
    console.error('[Token] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to generate token' },
      { status: 500 }
    );
  }
}
