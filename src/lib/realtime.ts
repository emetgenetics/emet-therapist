import { TOOL_SCHEMAS, executeTool } from './tools';
import { getPromptForState } from './prompts';
import { useSessionStore } from './store';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export class RealtimeClient {
  pc: RTCPeerConnection | null = null;
  dc: RTCDataChannel | null = null;
  localStream: MediaStream | null = null;
  remoteAudio: HTMLAudioElement | null = null;

  onToolCall:
    | ((name: string, args: Record<string, unknown>, callId: string) => void)
    | null = null;
  onTranscript:
    | ((text: string, speaker: 'ai' | 'user') => void)
    | null = null;
  onStateChange: ((state: ConnectionState) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  private aiTranscriptAccumulator = '';
  private currentInstructions = '';

  /**
   * Update session instructions live (e.g. on phase transition).
   * If already connected, sends session.update immediately.
   */
  setInstructions(instructions: string) {
    this.currentInstructions = instructions;
    if (this.dc?.readyState === 'open') {
      this.sendEvent({
        type: 'session.update',
        session: { instructions },
      });
    }
  }

  async connect() {
    try {
      this.onStateChange?.('connecting');
      console.log('[Realtime] Step 1: Fetching ephemeral token...');

      // Step 1: Get ephemeral token
      const tokenRes = await fetch('/api/realtime/token', { method: 'POST' });

      if (!tokenRes.ok) {
        const errData = await tokenRes.json().catch(() => ({ error: 'Unknown error' }));
        const errMsg = errData.error || `HTTP ${tokenRes.status}`;
        console.error('[Realtime] Token fetch failed:', errMsg);
        throw new Error(`Failed to get ephemeral token: ${errMsg}`);
      }

      const { token } = await tokenRes.json();
      if (!token) {
        throw new Error('Token response missing token field');
      }
      console.log('[Realtime] Token acquired');

      // Step 2: Create RTCPeerConnection
      console.log('[Realtime] Step 2: Creating RTCPeerConnection...');
      this.pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      // Step 3: Create data channel named EXACTLY "oai-events"
      console.log('[Realtime] Step 3: Creating data channel oai-events...');
      this.dc = this.pc.createDataChannel('oai-events');

      // Step 4: Add audio transceiver
      console.log('[Realtime] Step 4: Adding audio transceiver...');
      const audioTransceiver = this.pc.addTransceiver('audio', {
        direction: 'sendrecv',
      });

      // Step 5: Get microphone stream
      console.log('[Realtime] Step 5: Getting microphone...');
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await audioTransceiver.sender.replaceTrack(
        this.localStream.getAudioTracks()[0]
      );

      // Step 6: Create offer
      console.log('[Realtime] Step 6: Creating SDP offer...');
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete (or timeout after 3s)
      console.log('[Realtime] Waiting for ICE gathering...');
      await new Promise<void>((resolve) => {
        const checkState = () => {
          if (this.pc?.iceGatheringState === 'complete') {
            resolve();
          }
        };
        this.pc?.addEventListener('icegatheringstatechange', checkState);
        setTimeout(() => resolve(), 3000);
        checkState(); // Check immediately in case already complete
      });

      // Step 7: Send offer to OpenAI
      console.log('[Realtime] Step 7: Sending offer to OpenAI...');
      const sdpRes = await fetch(
        'https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
        {
          method: 'POST',
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/sdp',
          },
        }
      );

      if (!sdpRes.ok) {
        const errText = await sdpRes.text();
        console.error('[Realtime] SDP exchange failed:', sdpRes.status, errText);
        throw new Error(`SDP exchange failed: ${sdpRes.status} ${errText}`);
      }

      const answerSdp = await sdpRes.text();
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      console.log('[Realtime] SDP answer set');

      // Step 8: Handle remote audio track
      this.pc.ontrack = (e) => {
        console.log('[Realtime] Remote audio track received');
        if (!this.remoteAudio) {
          this.remoteAudio = new Audio();
          this.remoteAudio.autoplay = true;
        }
        this.remoteAudio.srcObject = e.streams[0];
      };

      // Step 9: Handle data channel messages
      this.dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          this.handleEvent(event);
        } catch {
          // ignore parse errors
        }
      };

      this.dc.onopen = () => {
        console.log('[Realtime] Data channel open');
        this.onStateChange?.('connected');

        // Configure session with tools + prompts
        const currentPhase = useSessionStore.getState().phase;
        const instructions = this.currentInstructions || getPromptForState(currentPhase);

        this.sendEvent({
          type: 'session.update',
          session: {
            instructions,
            tools: TOOL_SCHEMAS,
            tool_choice: 'auto',
            voice: 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
        });

        // Trigger opening line after short delay
        setTimeout(() => {
          this.sendEvent({ type: 'response.create' });
        }, 800);
      };

      this.dc.onclose = () => {
        console.log('[Realtime] Data channel closed');
        this.onStateChange?.('disconnected');
      };

      this.dc.onerror = (err) => {
        console.error('[Realtime] Data channel error:', err);
        this.onError?.('Data channel error');
      };

      this.pc.onconnectionstatechange = () => {
        console.log('[Realtime] Connection state:', this.pc?.connectionState);
        if (this.pc?.connectionState === 'disconnected') {
          this.onStateChange?.('disconnected');
        }
        if (this.pc?.connectionState === 'failed') {
          this.onStateChange?.('error');
          this.onError?.('Connection failed');
        }
      };
    } catch (error: any) {
      console.error('[Realtime] Connection failed:', error?.message || error);
      this.onStateChange?.('error');
      this.onError?.(error?.message || 'Connection failed');
      this.disconnect();
    }
  }

  sendEvent(event: Record<string, unknown>) {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify(event));
    } else {
      console.warn('[Realtime] Cannot send event, data channel not open');
    }
  }

  private handleEvent(event: Record<string, unknown>) {
    const type = event.type as string;

    if (type === 'response.audio_transcript.delta') {
      this.aiTranscriptAccumulator += (event.delta as string) || '';
    }

    if (type === 'response.audio_transcript.done') {
      const text =
        (event.transcript as string) || this.aiTranscriptAccumulator;
      this.aiTranscriptAccumulator = '';
      if (text) {
        this.onTranscript?.(text, 'ai');
      }
    }

    if (type === 'conversation.item.input_audio_transcription.completed') {
      const text = event.transcript as string;
      if (text) {
        this.onTranscript?.(text, 'user');
      }
    }

    if (type === 'response.function_call_arguments.done') {
      const name = event.name as string;
      const argsStr = event.arguments as string;
      const callId = event.call_id as string;
      console.log('[Realtime] Tool call:', name, argsStr);
      try {
        const args = JSON.parse(argsStr);
        executeTool(name, args);
        this.onToolCall?.(name, args, callId);
      } catch {
        // ignore parse errors
      }
    }

    if (type === 'session.created') {
      console.log('[Realtime] Session created');
    }

    if (type === 'error') {
      console.error('[Realtime] Server error:', event.error);
      this.onError?.(
        (event.error as Record<string, string>)?.message || 'Server error'
      );
    }
  }

  sendToolOutput(callId: string, output: unknown) {
    console.log('[Realtime] Sending tool output for', callId);
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
    // Small delay then trigger new response — AI is waiting for this
    setTimeout(() => {
      this.sendEvent({ type: 'response.create' });
    }, 100);
  }

  muteMic() {
    console.log('[Realtime] Muting microphone');
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = false));
  }

  unmuteMic() {
    console.log('[Realtime] Unmuting microphone');
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = true));
  }

  disconnect() {
    console.log('[Realtime] Disconnecting...');
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.dc?.close();
    this.pc?.close();
    this.localStream = null;
    this.dc = null;
    this.pc = null;
    this.remoteAudio = null;
    this.onStateChange?.('disconnected');
  }
}
