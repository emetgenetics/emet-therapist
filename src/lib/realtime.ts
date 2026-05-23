import { TOOL_SCHEMAS, executeTool } from './tools';
import { getPromptForState } from './prompts';
import { useSessionStore } from './store';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

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

  private aiTranscriptAccumulator = '';

  async connect() {
    // 1. Get ephemeral token
    const tokenRes = await fetch('/api/realtime/token', { method: 'POST' });
    if (!tokenRes.ok) {
      throw new Error('Failed to get ephemeral token');
    }
    const { token } = await tokenRes.json();

    // 2. Create RTCPeerConnection
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    // 3. Create data channel named EXACTLY "oai-events"
    this.dc = this.pc.createDataChannel('oai-events');

    // 4. Add audio transceiver sendrecv
    const audioTransceiver = this.pc.addTransceiver('audio', {
      direction: 'sendrecv',
    });

    // 5. Get microphone stream
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    await audioTransceiver.sender.replaceTrack(
      this.localStream.getAudioTracks()[0]
    );

    // 6. Create offer and set local description
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // 7. Send offer SDP to OpenAI
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
      const err = await sdpRes.text();
      throw new Error(`OpenAI SDP error: ${err}`);
    }

    const answerSdp = await sdpRes.text();
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

    // 8. Handle remote audio track
    this.pc.ontrack = (e) => {
      if (!this.remoteAudio) {
        this.remoteAudio = new Audio();
        this.remoteAudio.autoplay = true;
      }
      this.remoteAudio.srcObject = e.streams[0];
    };

    // 9. Handle data channel messages
    this.dc.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        this.handleEvent(event);
      } catch {
        // ignore parse errors
      }
    };

    this.dc.onopen = () => {
      this.onStateChange?.('connected');

      // Configure session with tools + prompts
      const currentPhase = useSessionStore.getState().phase;
      this.sendEvent({
        type: 'session.update',
        session: {
          instructions: getPromptForState(currentPhase),
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
    };

    this.dc.onclose = () => {
      this.onStateChange?.('disconnected');
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === 'disconnected') {
        this.onStateChange?.('disconnected');
      }
    };
  }

  sendEvent(event: Record<string, unknown>) {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify(event));
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
      try {
        const args = JSON.parse(argsStr);
        // Execute tool immediately
        executeTool(name, args);
        // Notify any listener
        this.onToolCall?.(name, args, callId);
      } catch {
        // ignore parse errors
      }
    }

    if (type === 'session.created') {
      // Trigger opening line after short delay
      setTimeout(() => this.sendEvent({ type: 'response.create' }), 500);
    }
  }

  // After executing a tool, MUST send output back to AI
  sendToolOutput(callId: string, output: unknown) {
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
    this.sendEvent({ type: 'response.create' });
  }

  muteMic() {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = false));
  }

  unmuteMic() {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = true));
  }

  disconnect() {
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
