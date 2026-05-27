/**
 * Generate an Inworld session token
 * Uses gRPC with IW1-HMAC-SHA256 auth to call GenerateToken
 */

import { NextResponse } from 'next/server';
import * as crypto from 'crypto';
import * as cryptoJs from 'crypto-js';
import * as grpc from '@grpc/grpc-js';

const INWORLD_API_KEY = process.env.NEXT_PUBLIC_INWORLD_API_KEY || process.env.INWORLD_API_KEY || '';
const ENGINE_HOST = 'api-engine.inworld.ai';

function parseApiKey(base64Key: string) {
  const decoded = Buffer.from(base64Key, 'base64').toString();
  const [key, secret] = decoded.split(':');
  return { key, secret };
}

function getDateTime() {
  const parts = new Date().toISOString().split('T');
  const date = parts[0].replace(/-/g, '');
  const time = parts[1].replace(/:/g, '').substring(0, 6);
  return `${date}${time}`;
}

function getAuthorization(apiKey: { key: string; secret: string }, host: string, method: string) {
  const datetime = getDateTime();
  const nonce = crypto.randomBytes(16).toString('hex').slice(1, 12);

  let signature = `IW1${apiKey.secret}`;
  for (const p of [datetime, host.replace(':443', ''), method, nonce]) {
    signature = cryptoJs.HmacSHA256(p, signature) as any;
  }
  signature = cryptoJs.HmacSHA256('iw1_request', signature).toString();

  return `IW1-HMAC-SHA256 ApiKey=${apiKey.key},DateTime=${datetime},Nonce=${nonce},Signature=${signature}`;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  // Debug: check env vars
  const envKey = process.env.NEXT_PUBLIC_INWORLD_API_KEY;
  const envKeyAlt = process.env.INWORLD_API_KEY;
  
  console.log('[Token] NEXT_PUBLIC_INWORLD_API_KEY present:', !!envKey);
  console.log('[Token] INWORLD_API_KEY present:', !!envKeyAlt);
  console.log('[Token] Using key length:', INWORLD_API_KEY.length);
  console.log('[Token] Key prefix:', INWORLD_API_KEY.substring(0, 10) + '...');

  if (!INWORLD_API_KEY) {
    return NextResponse.json({ 
      error: 'API key not configured',
      debug: {
        hasNextPublic: !!envKey,
        hasAlt: !!envKeyAlt,
        envKeys: Object.keys(process.env).filter(k => k.includes('INWORLD')),
      }
    }, { status: 500 });
  }

  try {
    const apiKey = parseApiKey(INWORLD_API_KEY);
    console.log('[Token] Parsed key:', apiKey.key.substring(0, 10) + '...');
    console.log('[Token] Secret length:', apiKey.secret.length);

    const host = ENGINE_HOST;
    const method = '/ai.inworld.engine.WorldEngine/GenerateToken';
    const auth = getAuthorization(apiKey, host, method);
    console.log('[Token] Auth prefix:', auth.substring(0, 80) + '...');

    // Load protobuf classes directly (no SDK)
    const worldEngineGrpc = require('@inworld/nodejs-sdk/proto/ai/inworld/engine/world-engine_grpc_pb');
    const worldEnginePb = require('@inworld/nodejs-sdk/proto/ai/inworld/engine/world-engine_pb');

    console.log('[Token] Proto loaded, client:', typeof worldEngineGrpc.WorldEngineClient);

    const client = new worldEngineGrpc.WorldEngineClient(
      `${host}:443`,
      grpc.credentials.createSsl()
    );

    const request = new worldEnginePb.GenerateTokenRequest();
    request.setKey(apiKey.key);

    const metadata = new grpc.Metadata();
    metadata.add('authorization', auth);

    console.log('[Token] Calling GenerateToken...');

    const tokenData = await new Promise<{ token: string; type: string; sessionId: string }>((resolve, reject) => {
      client.generateToken(request, metadata, (err: any, response: any) => {
        if (err) {
          console.error('[Token] gRPC error:', err.code, err.message, err.details);
          reject(new Error(`Token generation failed: ${err.code} ${err.message}`));
          return;
        }
        const obj = response.toObject();
        console.log('[Token] Success! SessionId:', obj.sessionId?.substring(0, 30));
        resolve({
          token: obj.token,
          type: obj.type || 'Bearer',
          sessionId: obj.sessionId,
        });
      });
    });

    return NextResponse.json(tokenData);
  } catch (err: any) {
    console.error('[Token] Error:', err.message, err.stack);
    return NextResponse.json(
      { error: err.message || 'Failed to generate token' },
      { status: 500 }
    );
  }
}
