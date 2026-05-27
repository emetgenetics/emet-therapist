/**
 * Generate an Inworld session token
 * Uses gRPC with IW1-HMAC-SHA256 auth to call GenerateToken
 */

import { NextResponse } from 'next/server';
import * as crypto from 'crypto';
import * as cryptoJs from 'crypto-js';
import * as grpc from '@grpc/grpc-js';

const INWORLD_API_KEY = process.env.NEXT_PUBLIC_INWORLD_API_KEY || '';
const ENGINE_HOST = 'api-engine.inworld.ai';

// Dynamic imports for protobuf classes
let WorldEngineClient: any;
let GenerateTokenRequest: any;

function loadProtos() {
  if (!WorldEngineClient) {
    const worldEngineGrpc = require('@inworld/nodejs-sdk/proto/ai/inworld/engine/world-engine_grpc_pb');
    const worldEnginePb = require('@inworld/nodejs-sdk/proto/ai/inworld/engine/world-engine_pb');
    WorldEngineClient = worldEngineGrpc.WorldEngineClient;
    GenerateTokenRequest = worldEnginePb.GenerateTokenRequest;
  }
}

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

function generateToken(apiKey: { key: string; secret: string }): Promise<{ token: string; type: string; sessionId: string }> {
  return new Promise((resolve, reject) => {
    loadProtos();

    const host = ENGINE_HOST;
    const method = '/ai.inworld.engine.WorldEngine/GenerateToken';
    const auth = getAuthorization(apiKey, host, method);

    const client = new WorldEngineClient(`${host}:443`, grpc.credentials.createSsl());

    const request = new GenerateTokenRequest();
    request.setKey(apiKey.key);
    // Don't set resources - server determines workspace from key

    const metadata = new grpc.Metadata();
    metadata.add('authorization', auth);

    client.generateToken(request, metadata, (err: any, response: any) => {
      if (err) {
        reject(new Error(`Token generation failed: ${err.message}`));
        return;
      }
      const obj = response.toObject();
      resolve({
        token: obj.token,
        type: obj.type || 'Bearer',
        sessionId: obj.sessionId,
      });
    });
  });
}

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!INWORLD_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  try {
    const apiKey = parseApiKey(INWORLD_API_KEY);
    const tokenData = await generateToken(apiKey);
    return NextResponse.json(tokenData);
  } catch (err: any) {
    console.error('[Token] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to generate token' },
      { status: 500 }
    );
  }
}
