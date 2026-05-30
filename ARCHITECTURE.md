# EMET IADC Realtime Therapist — Architecture Document

## Overview

A single-page, voice-first IADC (Induced After-Death Communication) therapy application powered by **OpenAI Realtime API via WebRTC**. The AI therapist communicates exclusively through voice, controls the session via tool calls, and guides the user through a structured IADC protocol with integrated bilateral stimulation (BLS).

**No auth. No database. No REST chat loops. Voice-only.**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| State | Zustand + localStorage persist |
| AI Voice | OpenAI Realtime API (WebRTC) |
| Audio | WebAudio API (BLS panner) |
| Visuals | Canvas 2D (Lightbar) |

**Only env var:** `OPENAI_API_KEY`

---

## File Structure

```
src/
app/
  page.tsx                          # Single page: PreFlight → Session
  layout.tsx                        # Dark fullscreen shell, no nav
  globals.css                       # Black bg, minimal theme
  api/
    realtime/
      token/
        route.ts                    # Ephemeral OpenAI token (ONLY backend file)

components/
  PreFlight.tsx                     # Checklist + headphone test + connect
  Session.tsx                       # Main session UI, mic sync, BLS timer
  Lightbar.tsx                      # Canvas 60fps BLS visual
  AudioPanner.tsx                   # WebAudio stereo panner (synced to lightbar)
  VoiceIndicator.tsx                # AI speaking / listening / BLS / muted states
  EmergencyOverlay.tsx              # Hardcoded grounding, hard-mutes mic+audio

lib/
  realtime.ts                       # WebRTC client class (RTCPeerConnection + data channel)
  store.ts                          # Zustand store (phase, BLS, mic, emergency, transcript)
  tools.ts                          # Tool schemas + execution logic
  prompts.ts                        # IADC system prompts per phase

types/
  index.ts                          # SessionPhase, TranscriptEntry, BlsConfig, ToolCall
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │  PreFlight    │───▶│   Session    │───▶│  Emergency    │  │
│  │  - checklist  │    │  - Lightbar  │    │  Overlay      │  │
│  │  - headphone  │    │  - Audio     │    │  - breathing  │  │
│  │    test       │    │    Panner    │    │  - grounding  │  │
│  │  - connect    │    │  - Voice     │    │  - hard-mute  │  │
│  └──────┬───────┘    │    Indicator │    └───────────────┘  │
│         │            └──────┬───────┘                        │
│         │                   │                                │
│         ▼                   ▼                                │
│  ┌──────────────────────────────────────┐                   │
│  │         RealtimeClient (WebRTC)       │                   │
│  │  - RTCPeerConnection                  │                   │
│  │  - DataChannel "oai-events"           │                   │
│  │  - getUserMedia (mic)                 │                   │
│  │  - remoteAudio (AI voice)             │                   │
│  │  - handleEvent → tool routing         │                   │
│  │  - sendToolOutput (prevents AI hang)  │                   │
│  └──────────────┬───────────────────────┘                   │
│                 │                                            │
│                 │ WebRTC (audio + data channel)              │
│                 │                                            │
└─────────────────┼────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   OpenAI Realtime API                        │
│  - gpt-4o-realtime-preview-2024-12-17                        │
│  - server_vad (auto turn detection)                          │
│  - Function calling (tool calls control frontend)            │
│  - Bidirectional audio streaming                             │
└─────────────────────────────────────────────────────────────┘
                  ▲
                  │ HTTPS (ephemeral token)
                  │
┌─────────────────┼─────────────────────────────────────────────┐
│  Next.js Server │                                             │
│  ┌──────────────┴──────────────┐                              │
│  │  /api/realtime/token/route  │  ← ONLY backend route        │
│  │  POST → ephemeral token     │                              │
│  └─────────────────────────────┘                              │
└───────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Voice-to-BLS Loop

```
1. User speaks → microphone → WebRTC → OpenAI Realtime API
2. OpenAI processes audio + VAD detects end of speech
3. OpenAI generates response (voice + optional tool call)
4. If tool call:
   a. OpenAI sends response.function_call_arguments.done
   b. RealtimeClient.handleEvent() fires
   c. executeTool() runs → updates Zustand store
   d. Session.tsx onToolCall fires → sends tool output back to AI
   e. AI receives tool output, generates next response
5. AI voice streams back via WebRTC → remoteAudio element
6. If trigger_bls was called:
   a. Store: isMicMuted=true, bls.isRunning=true
   b. Session effect: client.muteMic()
   c. Lightbar renders (canvas animation)
   d. AudioPanner starts (sine wave + stereo pan)
   e. setTimeout schedules stopBls after durationSeconds
   f. On stop: isMicMuted=false, client.unmuteMic()
```

---

## State Machine (Zustand Store)

```
PRE_FLIGHT ──▶ INTAKE ──▶ DESENSITIZATION ──▶ PIVOT ──▶ RECONNECTION ──▶ INTEGRATION ──▶ COMPLETED
                                                        │
                                                        ▼
                                              EMERGENCY_GROUNDING ──▶ INTEGRATION
```

### Store Shape

```typescript
interface SessionStore {
  phase: SessionPhase;           // Current IADC phase
  bls: {
    isRunning: boolean;          // Is BLS active
    speedHz: number;             // Sweep speed (2.0 desensitization, 1.0 reconnection, 0.5 integration)
    color: string;               // Lightbar color (white/amber/emerald/blue)
    remainingSeconds: number;    // Countdown
  };
  suds: number | null;           // User's distress score 0-10
  transcript: TranscriptEntry[]; // Full session transcript
  isMicMuted: boolean;           // Mic mute state (true during BLS)
  isEmergency: boolean;          // Emergency overlay active
}
```

### Critical Store Rules
- `startBls()` → sets `isMicMuted: true`
- `stopBls()` → sets `isMicMuted: false`
- `triggerEmergency()` → stops BLS, mutes mic, sets phase to EMERGENCY_GROUNDING
- `resolveEmergency()` → sets phase to INTEGRATION, unmutes mic

---

## Tool Calls (AI → Frontend)

The AI controls the app exclusively through these 3 tool calls:

### 1. `trigger_bls`
```
Parameters: { speedHz: number, durationSeconds: number, color: 'white'|'amber'|'emerald'|'blue' }
Execution:
  - store.startBls({ speedHz, durationSeconds, color })
  - setTimeout(() => store.stopBls(), durationSeconds * 1000)
Effect:
  - Mic mutes immediately
  - Lightbar renders (canvas animation at 60fps)
  - AudioPanner starts (sine wave, stereo pan synced to visual)
  - After durationSeconds: BLS stops, mic unmutes
```

### 2. `transition_state`
```
Parameters: { newState: SessionPhase }
Execution:
  - store.setPhase(newState)
  - Session.tsx updates AI session instructions via session.update
Effect:
  - AI behavior changes to match new phase prompt
```

### 3. `update_suds`
```
Parameters: { score: number (0-10) }
Execution:
  - store.setSuds(score)
Effect:
  - Stores distress level for AI context
```

---

## BLS Engine

### Visual (Lightbar.tsx)
- Fullscreen `<canvas>` overlay, black background
- Soft glowing circle (radial gradient) moving horizontally
- Position: `x = centerX + amplitude * sin(2π * speedHz * elapsedSeconds)`
- Circle: 40px radius core, 80px glow radius at 30% opacity
- Colors: white (255,255,255), amber (255,191,0), emerald (16,185,129), blue (96,165,250)
- Fade in: 500ms, Fade out: 500ms
- 60fps via `requestAnimationFrame`

### Audio (AudioPanner.tsx)
- `AudioContext` created on first user interaction (browser autoplay policy)
- Chain: `OscillatorNode(sine)` → `StereoPannerNode` → `GainNode(0.08)` → destination
- Frequencies: 440Hz (white/desensitization), 330Hz (amber/reconnection), 220Hz (emerald/blue/integration)
- Pan: `panner.pan.value = sin(2π * speedHz * elapsed)` — perfectly synced to visual
- Stop: ramp gain to 0 over 500ms, then disconnect

---

## WebRTC Client (lib/realtime.ts)

### Connection Flow
```
1. POST /api/realtime/token → get ephemeral token
2. Create RTCPeerConnection with STUN server
3. Create DataChannel named EXACTLY "oai-events"
4. Add audio transceiver (sendrecv)
5. getUserMedia({ audio: true }) → replace track on transceiver
6. createOffer → setLocalDescription
7. POST offer SDP to OpenAI with Bearer token
8. Receive answer SDP → setRemoteDescription
9. ontrack → create remoteAudio element, set srcObject
10. DataChannel.onopen → send session.update (instructions + tools + server_vad)
```

### Event Handling
| Event | Action |
|-------|--------|
| `session.created` | Trigger opening line after 500ms delay |
| `response.audio_transcript.delta` | Accumulate AI transcript |
| `response.audio_transcript.done` | Fire onTranscript(text, 'ai') |
| `conversation.item.input_audio_transcription.completed` | Fire onTranscript(text, 'user') |
| `response.function_call_arguments.done` | Parse args → executeTool() → onToolCall() |

### Critical: Tool Output
After every tool call, `sendToolOutput()` MUST be called:
```typescript
sendToolOutput(callId, output) {
  sendEvent({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) } });
  sendEvent({ type: 'response.create' });
}
```
Without this, the AI hangs forever waiting for tool results.

---

## Emergency Protocol

### Trigger
- User clicks red emergency button (always visible, top-right)
- Store: `triggerEmergency()` → phase=EMERGENCY_GROUNDING, isEmergency=true, BLS stopped, mic muted

### EmergencyOverlay
- Fullscreen blur overlay (z-50)
- **Immediately on mount:** `client.muteMic()` + `client.remoteAudio.pause()` — does NOT wait for AI
- Displays: "You are safe. You are here."
- Breathing pacer: circle expands/contracts every 4 seconds
- Grounding instructions: "Name 5 things you can see", "Feel your feet on the floor", "Breathe slowly"
- Button: "I feel calmer now"

### Resolution
- `resolveEmergency()` → phase=INTEGRATION, isEmergency=false, mic unmuted
- Sends message to AI: "I experienced some distress but I am calmer now. Please help me ground and close the session."
- AI responds with integration prompt

---

## Session Phases & AI Prompts

| Phase | Goal | Max Words | BLS |
|-------|------|-----------|-----|
| INTAKE | Identify core grief, body location, SUDS score | 20 | None |
| DESENSITIZATION | Clear sadness with fast BLS | 10 | 2Hz, 30s, white |
| POVOT | Transition to receptive state | 15 | None |
| RECONNECTION | Facilitate IADC encounter with slow BLS | 10 | 1Hz, 300s, amber |
| INTEGRATION | Ground and close with fading BLS | Unlimited | 0.5Hz, 60s, emerald |
| COMPLETED | Gentle close | Unlimited | None |
| EMERGENCY | Grounding (no tools called) | 10 | None |

---

## Mic Muting Logic

```
Store: startBls() → isMicMuted = true
         ↓
Session useEffect: isMicMuted changed → client.muteMic()
         ↓
Mic disabled during BLS (prevents AI hearing BLS audio/breathing)
         ↓
Store: stopBls() → isMicMuted = false
         ↓
Session useEffect: isMicMuted changed → client.unmuteMic()
```

**Why this matters:** During the 30-second desensitization sweep, the WebAudio panner clicks left-right. If the mic is live, the AI hears its own BLS audio and tries to respond mid-sweep, destroying the session.

---

## What Was Removed (Demolition)

### Deleted Files
- `src/app/api/therapy/chat/route.ts` — REST chat (dead)
- `src/app/api/auth/**` — All auth routes
- `src/app/api/sessions/**` — All session CRUD routes
- `src/app/api/bls-configs/**` — BLS config CRUD
- `src/app/api/consent/**` — Consent routes
- `src/app/login/**`, `register/**`, `admin/**`, `dashboard/**`, `session/**` — All non-root pages
- `src/lib/openrouter.ts` — Gemma/OpenRouter (forbidden)
- `src/lib/auth.ts`, `encryption.ts`, `redis.ts`, `db.ts` — Auth/crypto/DB
- `src/lib/audio/tts.ts`, `recorder.ts` — Browser speech APIs (forbidden)
- `src/lib/state-machine/therapy-session.machine.ts` — XState (forbidden)
- `src/lib/ai/therapy-engine.ts` — Old AI engine
- `src/lib/store/session-store.ts` — Old store
- `src/components/voice/**` — Old voice pipeline
- `src/components/session/**` — Old session UI (TranscriptDisplay, etc.)
- `src/components/bls/**` — Old BLS components
- `src/components/ui/**` — Old UI components
- `src/hooks/**` — Old hooks
- `src/types/next-auth.d.ts` — NextAuth types
- `src/app/providers.tsx` — Auth provider
- `prisma.config.ts` — Prisma config
- `prisma/schema.prisma` — Stripped to zero tables

### Removed Dependencies
`@auth/prisma-adapter`, `@prisma/*`, `bcryptjs`, `ioredis`, `next-auth`, `xstate`, `@xstate/react`, `speakeasy`, `qrcode`, `pg`, `dotenv`

### Kept
Next.js, React, TypeScript, Tailwind CSS, Zustand, OpenAI SDK

---

## Running the App

```bash
cd iadc-therapist
OPENAI_API_KEY=sk-... npm run dev
```

Build: `npm run build` (zero TypeScript errors)

---

## Key Constraints (Absolute)

1. **NO** Browser SpeechRecognition or SpeechSynthesis — all voice is OpenAI Realtime WebRTC
2. **NO** REST API chat loops — the AI lives in the WebRTC pipe
3. **NO** XState, Redis, Prisma DB calls, NextAuth, MFA, or encryption for V1
4. The AI **must** use tool calls — never parse AI text to guess state transitions
5. Mic **MUST** mute during BLS — no exceptions
6. Emergency grounding **MUST** be frontend-hardcoded — never wait for AI during panic
7. Maximum 10 words per AI response during RECONNECTION — enforced in prompt
8. Single page app — no routing for V1
9. Only env var: `OPENAI_API_KEY`

---

## Implementation Trap Audit

Verified against all 8 known traps. Results:

| # | Trap | Status | Fix Applied |
|---|------|--------|-------------|
| 1 | session.update on phase transitions | ✅ PASS | Session.tsx sends `session.update` with new prompt inside `onToolCall` handler |
| 2 | sendToolOutput hang | ✅ PASS | `sendToolOutput()` sends both `conversation.item.create` AND `response.create` |
| 3 | AudioContext autoplay policy | ✅ PASS | AudioContext created inside PreFlight headphone test `onClick` handler (user gesture) |
| 4 | Mic unmute timing | ✅ FIXED | Mic unmute delayed 500ms after BLS stop via `setTimeout` in Session.tsx to match AudioPanner fade-out. Previously `stopBls()` set `isMicMuted: false` immediately, causing AI to hear panner tail |
| 5 | Shared timebase for Lightbar+AudioPanner | ✅ FIXED | Store now has `blsStartTime: number` set by `startBls()` via `performance.now()`. Both Lightbar.tsx and AudioPanner.tsx read this shared value. Previously each component had its own independent `startTimeRef`, causing visual/audio drift |
| 6 | Emergency overlay bypass | ✅ PASS | `EmergencyOverlay` calls `client.muteMic()` + `client.remoteAudio.pause()` in `useEffect([], [])` on mount — no AI involvement |
| 7 | POVOT typo | ✅ PASS | All files use `PIVOT` correctly (types, prompts, tool schemas, store, components) |
| 8 | Desensitization loop logic | ✅ PASS | DESENSITIZATION prompt says "If sadness still intense, repeat steps 1-4. If user says sadness is gone or SUDS 0-1, call transition_state('PIVOT')" |

### Key Fix Details

**Trap 4 — Mic Unmute Delay:**
```
// Session.tsx — detect BLS stop transition
if (wasRunning && !bls.isRunning) {
  unmuteTimerRef.current = setTimeout(() => {
    useSessionStore.getState().setMicMuted(false);
    client.unmuteMic();
  }, 500); // matches AudioPanner fade-out duration
}
```

**Trap 5 — Shared Timebase:**
```
// store.ts — set once when BLS starts
startBls: ({ speedHz, durationSeconds, color }) => set({
  bls: { isRunning: true, speedHz, color, remainingSeconds: durationSeconds },
  blsStartTime: performance.now(),  // ← shared reference
  isMicMuted: true,
}),

// Lightbar.tsx + AudioPanner.tsx — both read same value
const blsStartTime = useSessionStore((s) => s.blsStartTime);
const elapsed = (performance.now() - blsStartTime) / 1000;
```
