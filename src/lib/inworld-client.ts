/**
 * Inworld Realtime API Client — WebRTC
 *
 * Uses WebRTC for audio streaming + data channel for OpenAI Realtime JSON events.
 * SDP exchange is proxied through /api/webrtc to keep the API key server-side.
 *
 * Flow:
 * 1. Create RTCPeerConnection
 * 2. Add microphone track (audio input handled natively by WebRTC)
 * 3. Create data channel 'oai-events' for JSON events
 * 4. Create SDP offer → send to /api/webrtc proxy → get answer
 * 5. Set remote description → connected!
 * 6. Send/receive JSON events over data channel
 */

import { useSessionStore } from './store';
import type { ConnectionState } from '@/types';

// ── Main Inworld WebRTC Client ──────────────────────────────────────────────
export class InworldClient {
  pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private micStream: MediaStream | null = null;
  private connectionResolved = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: number | null = null;

  onTranscript: ((text: string, speaker: 'ai' | 'user') => void) | null = null;
  onStateChange: ((state: ConnectionState) => void) | null = null;
  onError: ((msg: string) => void) | null = null;

  private setState(state: ConnectionState) {
    useSessionStore.getState().setConnectionState(state);
    this.onStateChange?.(state);
  }

  // ── Send a JSON event over the data channel ─────────────────────────────────
  sendEvent(event: Record<string, unknown>) {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(event));
    }
  }

  // ── Connect to Inworld Realtime API via WebRTC ──────────────────────────────
  async connect() {
    try {
      this.setState('connecting');
      this.connectionResolved = false;
      this.reconnectAttempts = 0;

      // 1. Create peer connection
      this.pc = new RTCPeerConnection();

      // 2. Set up audio playback from AI
      this.audioEl = document.createElement('audio');
      this.audioEl.autoplay = true;
      document.body.appendChild(this.audioEl);

      this.pc.ontrack = (e) => {
        console.log('[Inworld] Received remote track:', e.track.kind);
        if (e.streams[0] && this.audioEl) {
          this.audioEl.srcObject = e.streams[0];
        }
      };

      // 3. Set up data channel for JSON events
      this.dataChannel = this.pc.createDataChannel('oai-events');

      this.dataChannel.onopen = () => {
        console.log('[Inworld] Data channel open — connected!');
        this.connectionResolved = true;
        this.reconnectAttempts = 0;
        this.setState('ready');

        // Send session configuration
        this.sendEvent({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            voice: 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: { type: 'server_vad' },
            instructions: 'You are a compassionate IADC therapy assistant. Help the user through their therapy session with empathy and care. Be warm, supportive, and ask open-ended questions to guide the user through their feelings.',
          },
        });
      };

      this.dataChannel.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          this.handleMessage(msg);
        } catch (err) {
          console.error('[Inworld] JSON parse error:', err);
        }
      };

      this.dataChannel.onclose = () => {
        console.log('[Inworld] Data channel closed');
        this.setState('disconnected');
      };

      this.dataChannel.onerror = (err) => {
        console.error('[Inworld] Data channel error:', err);
      };

      // 4. Add microphone track
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });

      for (const track of this.micStream.getAudioTracks()) {
        this.pc.addTrack(track, this.micStream);
      }
      console.log('[Inworld] Microphone track added');

      // 5. Create SDP offer
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      console.log('[Inworld] SDP offer created');

      // 6. Send offer to our proxy, get answer
      const res = await fetch('/api/webrtc', {
        method: 'POST',
        body: offer.sdp,
        headers: { 'Content-Type': 'application/sdp' },
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`SDP exchange failed: ${res.status} ${errText}`);
      }

      const answerSdp = await res.text();
      console.log('[Inworld] SDP answer received');

      // 7. Set remote description
      await this.pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      console.log('[Inworld] WebRTC connection established');

      // 8. Handle connection state changes
      this.pc.onconnectionstatechange = () => {
        const state = this.pc?.connectionState;
        console.log('[Inworld] Connection state:', state);

        if (state === 'connected') {
          this.setState('ready');
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          this.setState('disconnected');
          this.attemptReconnect();
        }
      };

    } catch (error: any) {
      console.error('[Inworld] Connect failed:', error.message);
      this.onError?.(error.message || 'Connection failed');
      this.setState('error');
      this.cleanup();
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Inworld] Max reconnect attempts reached');
      this.onError?.('Connection lost. Please try again.');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    console.log(`[Inworld] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = window.setTimeout(async () => {
      try {
        await this.connect();
      } catch (err: any) {
        console.error('[Inworld] Reconnect failed:', err.message);
        this.attemptReconnect();
      }
    }, delay);
  }

  // ── Handle incoming Realtime API events ─────────────────────────────────────
  private handleMessage(msg: any) {
    const eventType = msg.type;
    console.log('[Inworld] Event:', eventType);

    // Session created/updated
    if (eventType === 'session.created' || eventType === 'session.updated') {
      console.log('[Inworld] Session ready:', msg.session?.id);
    }

    // Audio delta from AI (base64 PCM16)
    if (eventType === 'response.audio.delta') {
      // Audio is handled natively by WebRTC — no manual decoding needed
      // But we can log it for debugging
      if (msg.delta) {
        console.log('[Inworld] Audio delta received, length:', msg.delta.length);
      }
    }

    // AI text transcript
    if (eventType === 'response.audio_transcript.delta') {
      if (msg.delta) {
        this.onTranscript?.(msg.delta, 'ai');
      }
    }

    // User transcription
    if (eventType === 'conversation.item.input_audio_transcription.completed') {
      if (msg.transcript) {
        this.onTranscript?.(msg.transcript, 'user');
      }
    }

    // Response complete
    if (eventType === 'response.done') {
      console.log('[Inworld] Response complete');
    }

    // Error
    if (eventType === 'error') {
      console.error('[Inworld] API error:', msg.error);
      this.onError?.(msg.error?.message || 'Unknown error');
    }
  }

  // ── Send text message ───────────────────────────────────────────────────────
  sendText(text: string) {
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });
    this.sendEvent({ type: 'response.create' });
    console.log('[Inworld] Sent text:', text.substring(0, 80));
  }

  // ── Controls ────────────────────────────────────────────────────────────────
  muteMic() {
    this.micStream?.getAudioTracks().forEach(t => t.enabled = false);
    console.log('[Inworld] Microphone muted');
  }

  unmuteMic() {
    this.micStream?.getAudioTracks().forEach(t => t.enabled = true);
    console.log('[Inworld] Microphone unmuted');
  }

  disconnect() {
    this.cleanup();
    this.setState('disconnected');
  }

  private cleanup() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }

    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl.remove();
      this.audioEl = null;
    }
  }
}
