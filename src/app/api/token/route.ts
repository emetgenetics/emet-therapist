/**
 * Generate an Inworld session token via gRPC
 * Reads INWORLD_API_KEY at runtime (not build-time inlined)
 * Supports both base64-encoded and raw key formats
 */

import { NextResponse } from 'next/server';
import * as grpc from '@grpc/grpc-js';

const ENGINE_HOST = 'api-engine.inworld.ai';

function parseApiKey(rawKey: string) {
  // Try base64 decode first
  try {
    const decoded = Buffer.from(rawKey, 'base64').toString();
    if (decoded.includes(':')) {
      const [key, secret] = decoded.split(':');
      if (key && secret) return { key, secret, wasBase64: true };
    }
  } catch (e) {
    // Not valid base64, fall through
  }

  // Try raw format (key:secret)
  if (rawKey.includes(':')) {
    const [key, secret] = rawKey.split(':');
    if (key && secret) return { key, secret, wasBase64: false };
  }

  throw new Error('Invalid API key format — expected base64-encoded or raw key:secret');
}

export const dynamic = 'force-dynamic';

export async function GET() {
  // IMPORTANT: Read at runtime, not at module level (avoids Next.js inlining)
  const rawKey = process.env.INWORLD_API_KEY || process.env.NEXT_PUBLIC_INWORLD_API_KEY || '';

  console.log('[Token] Env check:', {
    hasInworldKey: !!process.env.INWORLD_API_KEY,
    hasNextPublic: !!process.env.NEXT_PUBLIC_INWORLD_API_KEY,
    rawKeyLength: rawKey.length,
    rawKeyPrefix: rawKey.substring(0, 15),
  });

  if (!rawKey) {
    return NextResponse.json({
      error: 'API key not configured',
      debug: {
        hasInworldKey: !!process.env.INWORLD_API_KEY,
        hasNextPublic: !!process.env.NEXT_PUBLIC_INWORLD_API_KEY,
        envKeys: Object.keys(process.env).filter(k => k.toUpperCase().includes('INWORLD')),
      }
    }, { status: 500 });
  }

  try {
    const apiKey = parseApiKey(rawKey);
    console.log('[Token] Key prefix:', apiKey.key.substring(0, 8) + '...', 'wasBase64:', apiKey.wasBase64);

    // Use SDK's KeySignature directly (no module-alias triggered)
    const { KeySignature } = require('@inworld/nodejs-sdk/build/src/auth/key_signature');
    const auth = KeySignature.getAuthorization({
      apiKey,
      host: `${ENGINE_HOST}:443`,
    });

    // Use raw protobuf (no module-alias triggered)
    const worldEngineGrpc = require('@inworld/nodejs-sdk/proto/ai/inworld/engine/world-engine_grpc_pb');
    const worldEnginePb = require('@inworld/nodejs-sdk/proto/ai/inworld/engine/world-engine_pb');

    const client = new worldEngineGrpc.WorldEngineClient(
      `${ENGINE_HOST}:443`,
      grpc.credentials.createSsl()
    );

    const request = new worldEnginePb.GenerateTokenRequest();
    request.setKey(apiKey.key);

    const metadata = new grpc.Metadata();
    metadata.add('authorization', auth);

    const tokenData = await new Promise<{ token: string; type: string; sessionId: string }>((resolve, reject) => {
      client.generateToken(request, metadata, (err: any, response: any) => {
        if (err) {
          reject(new Error(`Token generation failed: ${err.code} ${err.message}`));
          return;
        }
        const obj = response.toObject();
        console.log('[Token] Success! SessionId:', obj.sessionId?.substring(0, 40));
        resolve({
          token: obj.token,
          type: obj.type || 'Bearer',
          sessionId: obj.sessionId,
        });
      });
    });

    return NextResponse.json(tokenData);
  } catch (err: any) {
    console.error('[Token] Error:', err.message);
    return NextResponse.json(
      { error: err.message || 'Failed to generate token' },
      { status: 500 }
    );
  }
}
