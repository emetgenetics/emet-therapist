import { useSessionStore } from './store';
import { executeTool } from './tools';
import { getPromptForState } from './prompts';
import type { ConnectionState } from '@/types';

export class InworldClient {
  pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private micStream: MediaStream | null = null;

  onTranscript: ((text: string, speaker: 'ai' | 'user') => void) | null = null;
  onToolCall: ((name: string, args: Record<string, unknown>, callId: string) => void) | null = null;
  onStateChange: ((s: ConnectionState) => void) | null = null;
  onError: ((msg: string) => void) | null = null;

  private setState(s: ConnectionState) {
    useSessionStore.getState().setConnectionState(s);
    this.onStateChange?.(s);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async connect() {
    try {
      this.setState('connecting');

      // Step 1: Fetch ICE servers from our backend
      const cfgRes = await fetch('/api/realtime/config');
      if (!cfgRes.ok) throw new Error(`Config fetch failed: ${cfgRes.status}`);
      const { iceServers } = await cfgRes.json();

      // Step 2: Create peer connection with Inworld's ICE servers
      this.pc = new RTCPeerConnection({ iceServers });

      // Step 3: Wire up remote audio track → <audio> element
      this.remoteAudio = document.createElement('audio');
      this.remoteAudio.autoplay = true;
      document.body.appendChild(this.remoteAudio);

      this.pc.ontrack = (e) => {
        if (this.remoteAudio) {
          this.remoteAudio.srcObject = new MediaStream([e.track]);
        }
      };

      // Step 4: Create data channel (name must be exactly 'oai-events')
      this.dc = this.pc.createDataChannel('oai-events', { ordered: true });
      this.dc.onopen = () => this.onDataChannelOpen();
      this.dc.onmessage = (e) => {
        try { this.handleEvent(JSON.parse(e.data as string)); }
        catch { /* ignore malformed frames */ }
      };
      this.dc.onclose = () => this.setState('disconnected');

      // Step 5: Add microphone track
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      this.micStream.getAudioTracks().forEach(t => this.pc!.addTrack(t, this.micStream!));

      // Step 6: Create offer and set local description
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      // Step 7: WAIT for ICE gathering to complete before posting SDP
      await this.waitForIceGathering();

      // Step 8: Proxy the complete SDP through our backend
      const sdpRes = await fetch('/api/realtime/sdp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: this.pc.localDescription!.sdp,
      });

      if (!sdpRes.ok) {
        const err = await sdpRes.text();
        throw new Error(`SDP exchange failed (${sdpRes.status}): ${err}`);
      }

      // Step 9: Set the SDP answer — WebRTC handshake complete
      await this.pc.setRemoteDescription({
        type: 'answer',
        sdp: await sdpRes.text(),
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Inworld] connect() failed:', msg);
      this.onError?.(msg);
      this.setState('error');
      this.cleanup();
    }
  }

  muteMic() {
    this.micStream?.getAudioTracks().forEach(t => (t.enabled = false));
  }

  unmuteMic() {
    this.micStream?.getAudioTracks().forEach(t => (t.enabled = true));
  }

  sendEvent(event: Record<string, unknown>) {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify(event));
    }
  }

  sendToolOutput(callId: string, result: unknown) {
    this.sendEvent({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) },
    });
    this.sendEvent({ type: 'response.create' });
  }

  disconnect() {
    this.cleanup();
    this.setState('disconnected');
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private onDataChannelOpen() {
    this.setState('ready');
    const { phase, day } = useSessionStore.getState();

    this.sendEvent({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: 'openai/gpt-4o-mini',
        instructions: getPromptForState(phase, day),
        output_modalities: ['audio', 'text'],
        audio: {
          input: {
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'low',
              create_response: true,
              interrupt_response: false,
            },
          },
          output: {
            voice: 'Clive',
            model: 'inworld-tts-2',
            speed: 0.95,
          },
        },
        tools: TOOL_SCHEMAS_FOR_SESSION,
        providerData: {
          stt: {
            end_of_turn_confidence_threshold: 0.8,
            min_end_of_turn_silence: 500,
          },
          memory: { enabled: false },
        },
      },
    });
  }

  private handleEvent(msg: { type: string; [key: string]: unknown }) {
    switch (msg.type) {
      case 'session.created':
      case 'session.updated':
        console.log('[Inworld] Session ready');
        break;

      case 'response.audio_transcript.delta':
        if (typeof msg.delta === 'string') {
          this.onTranscript?.(msg.delta, 'ai');
        }
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (typeof msg.transcript === 'string') {
          this.onTranscript?.(msg.transcript, 'user');
        }
        break;

      case 'response.function_call_arguments.done': {
        try {
          const args = JSON.parse((msg.arguments as string) || '{}');
          this.onToolCall?.(msg.name as string, args, msg.call_id as string);
        } catch {
          console.error('[Inworld] Malformed tool args:', msg.arguments);
        }
        break;
      }

      case 'error':
        console.error('[Inworld] API error:', (msg.error as { message?: string })?.message);
        this.onError?.((msg.error as { message?: string })?.message ?? 'Unknown error');
        break;
    }
  }

  private waitForIceGathering(): Promise<void> {
    return new Promise(resolve => {
      if (!this.pc || this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const handler = () => {
        if (this.pc?.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', handler);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', handler);
      // Safety valve: don't block forever if ICE stalls
      setTimeout(resolve, 4000);
    });
  }

  private cleanup() {
    this.dc?.close();
    this.pc?.close();
    this.micStream?.getTracks().forEach(t => t.stop());
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
      this.remoteAudio.remove();
    }
    this.dc = null;
    this.pc = null;
    this.micStream = null;
    this.remoteAudio = null;
  }
}

const TOOL_SCHEMAS_FOR_SESSION = [
  {
    type: 'function',
    name: 'trigger_bls',
    description: 'Start bilateral stimulation. After calling this say NOTHING until user speaks.',
    parameters: {
      type: 'object',
      properties: {
        speedHz: { type: 'number' },
        durationSeconds: { type: 'number' },
        color: { type: 'string', enum: ['white', 'amber', 'emerald', 'blue'] },
      },
      required: ['speedHz', 'durationSeconds', 'color'],
    },
  },
  {
    type: 'function',
    name: 'transition_state',
    description: 'Transition the session to a new IADC phase.',
    parameters: {
      type: 'object',
      properties: {
        newState: {
          type: 'string',
          enum: ['INTAKE','DESENSITIZATION','DAY_1_WRAP_UP','CHECK_IN',
                 'WARM_UP_BLS','PIVOT','RECONNECTION','INTEGRATION',
                 'COMPLETED_DAY_1','COMPLETED_DAY_2','EMERGENCY_GROUNDING'],
        },
      },
      required: ['newState'],
    },
  },
  {
    type: 'function',
    name: 'update_suds',
    description: "Record the user's distress level 0–10.",
    parameters: {
      type: 'object',
      properties: { score: { type: 'number', minimum: 0, maximum: 10 } },
      required: ['score'],
    },
  },
];
