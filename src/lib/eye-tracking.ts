import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { useSessionStore } from './store';
import type { EyeState } from '@/types';

let faceLandmarker: FaceLandmarker | null = null;

// Position history for velocity/variance calculation (2 seconds at 60fps)
const POSITION_HISTORY: number[] = [];
const HISTORY_SIZE = 120;

export async function initEyeTracker() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    outputFaceBlendshapes: true,
    runningMode: 'VIDEO',
    numFaces: 1,
  });
  return faceLandmarker;
}

export function processEyeFrame(video: HTMLVideoElement) {
  if (!faceLandmarker) return;

  const result = faceLandmarker.detectForVideo(video, performance.now());
  const store = useSessionStore.getState();

  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    store.setEyeTracking({ state: 'IDLE' });
    return;
  }

  const landmarks = result.faceLandmarks[0];

  // Iris center: average of left eye iris landmarks (MediaPipe face mesh indices 468-477)
  const leftIris = landmarks.slice(468, 478);
  const avgX = leftIris.reduce((sum, p) => sum + (p?.x ?? 0), 0) / leftIris.length;

  // Update position history
  POSITION_HISTORY.push(avgX);
  if (POSITION_HISTORY.length > HISTORY_SIZE) POSITION_HISTORY.shift();

  // Calculate velocity (frame-to-frame movement)
  const velocity =
    POSITION_HISTORY.length > 1
      ? Math.abs(
          POSITION_HISTORY[POSITION_HISTORY.length - 1] -
            POSITION_HISTORY[POSITION_HISTORY.length - 2]
        )
      : 0;

  // Calculate fixation variance (how much the eye position varies over the window)
  const mean =
    POSITION_HISTORY.reduce((a, b) => a + b, 0) / POSITION_HISTORY.length;
  const variance =
    POSITION_HISTORY.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) /
    POSITION_HISTORY.length;
  const fixationVar = Math.sqrt(variance);

  // Classify eye state
  let state: EyeState = 'IDLE';
  const blsRunning = store.bls.isRunning;

  if (blsRunning && POSITION_HISTORY.length > 30) {
    if (fixationVar < 0.02) {
      state = 'FROZEN';
    } else if (velocity > 0.4) {
      state = 'ERRATIC';
    } else {
      state = 'TRACKING';
    }
  }

  store.setEyeTracking({ state, position: { x: avgX }, velocity, fixationVar });

  // Auto-actions based on eye state
  if (state === 'FROZEN' && blsRunning) {
    // Eyes frozen during BLS — possible dissociation, stop BLS
    store.stopBls();
  }
  if (state === 'ERRATIC') {
    // Erratic eye movements — possible panic, trigger emergency
    store.triggerEmergency();
  }
}

/**
 * Calculate adaptive BLS speed based on how well the user's eyes
 * are tracking the lightbar. If eyes are lagging behind, slow down.
 * If eyes are tracking well, can speed up slightly.
 */
export function getAdaptiveSpeed(
  baseSpeed: number,
  eyeX: number,
  lightbarX: number
): number {
  const lag = Math.abs(lightbarX - eyeX);
  let newSpeed = baseSpeed;

  if (lag > 0.15 && baseSpeed > 0.5) {
    // Eyes lagging significantly — slow down
    newSpeed = baseSpeed * 0.92;
  } else if (lag < 0.05 && baseSpeed < 2.5) {
    // Eyes tracking well — can speed up slightly
    newSpeed = baseSpeed * 1.03;
  }

  // Easing: blend toward new speed (70% current, 30% target)
  return baseSpeed * 0.7 + newSpeed * 0.3;
}
