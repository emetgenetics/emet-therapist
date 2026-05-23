import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error('[Token Route] OPENAI_API_KEY is missing');
      return NextResponse.json(
        { error: 'Server configuration error: API key missing' },
        { status: 500 }
      );
    }

    if (!apiKey.startsWith('sk-')) {
      console.error('[Token Route] API key format looks invalid');
      return NextResponse.json(
        { error: 'Server configuration error: Invalid API key format' },
        { status: 500 }
      );
    }

    const requestBody = {
      model: 'gpt-4o-realtime-preview-2024-12-17',
      voice: 'alloy',
    };

    console.log('[Token Route] Requesting ephemeral token from OpenAI...');

    const res = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Token Route] OpenAI returned ${res.status}: ${errText}`);
      return NextResponse.json(
        { error: `OpenAI API error (${res.status}): ${errText}` },
        { status: 502 }
      );
    }

    const data = await res.json();

    if (!data.client_secret?.value) {
      console.error('[Token Route] Unexpected response shape:', JSON.stringify(data));
      return NextResponse.json(
        { error: 'Invalid token response from OpenAI' },
        { status: 502 }
      );
    }

    console.log('[Token Route] Token acquired successfully');

    return NextResponse.json({
      token: data.client_secret.value,
      expires_at: data.client_secret.expires_at || null,
    });
  } catch (error: any) {
    console.error('[Token Route] Unexpected error:', error?.message || error);
    return NextResponse.json(
      { error: `Internal error: ${error?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}
