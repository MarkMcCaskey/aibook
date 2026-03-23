// Loop 2: Signal Fusion → Reader State (~1s)
// Aggregates face blend shapes + browser signals into an interpretive reader state.

import { getLatestBlendShapes, isFaceDetected } from './sensing.js';
import {
  getSignals, getSessionMinutes, justReturned, getMouseIdleSeconds,
  getReadingSpeedLabel, getRereadCount, getScrollSpeed
} from './signals.js';
import { getCurrentParagraphIndex, getParagraphDwellTime, getAverageDwellTime } from './book-ui.js';
import { analyzeReadingPattern, getGazeDirection, getMostGazedParagraph } from './gaze.js';

// Calibration baseline
let baseline = {};
let calibrated = false;

// Rolling sample buffer
const WINDOW_SIZE = 20;
const sampleBuffer = [];
let samplingInterval = null;

// Engagement history for trend detection
const engagementHistory = [];
const emotionHistory = [];

export function isCalibrated() {
  return calibrated;
}

export async function calibrate(durationMs = 3000, onProgress = null) {
  const samples = [];
  const start = Date.now();

  return new Promise(resolve => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      if (onProgress) onProgress(elapsed / durationMs);

      const shapes = getLatestBlendShapes();
      if (shapes) samples.push({ ...shapes });

      if (elapsed >= durationMs) {
        clearInterval(interval);

        if (samples.length > 5) {
          baseline = {};
          const keys = Object.keys(samples[0]).filter(k => !k.startsWith('_'));
          for (const key of keys) {
            baseline[key] = samples.reduce((sum, s) => sum + (s[key] || 0), 0) / samples.length;
          }
          calibrated = true;
        }
        resolve();
      }
    }, 100);
  });
}

export function startInterpretation() {
  // Sample blend shapes into rolling buffer at 10Hz
  samplingInterval = setInterval(() => {
    const shapes = getLatestBlendShapes();
    if (shapes) {
      sampleBuffer.push({ ...shapes, timestamp: Date.now() });
      if (sampleBuffer.length > WINDOW_SIZE) sampleBuffer.shift();
    }
  }, 100);
}

export function stopInterpretation() {
  if (samplingInterval) clearInterval(samplingInterval);
}

// Delta from baseline
function delta(sample, key) {
  return (sample[key] || 0) - (baseline[key] || 0);
}

function avg(samples, fn) {
  if (samples.length === 0) return 0;
  return samples.reduce((sum, s) => sum + fn(s), 0) / samples.length;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function computeVariance(samples, fn) {
  if (samples.length < 2) return 0;
  const values = samples.map(fn);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

function countBlinks(samples) {
  let blinks = 0;
  let wasBlinking = false;
  for (const s of samples) {
    const blinking = (s.eyeBlinkLeft || 0) > 0.5 && (s.eyeBlinkRight || 0) > 0.5;
    if (blinking && !wasBlinking) blinks++;
    wasBlinking = blinking;
  }
  return blinks;
}

function computeEngagement() {
  const recent = sampleBuffer.slice(-10);
  if (recent.length < 3) return 0.5;

  // Factor 1: Eye openness
  const eyeOpenness = avg(recent, s =>
    (delta(s, 'eyeWideLeft') + delta(s, 'eyeWideRight')) / 2 -
    (delta(s, 'eyeSquintLeft') + delta(s, 'eyeSquintRight')) / 2
  );

  // Factor 2: Blink rate (inverted)
  const blinkCount = countBlinks(recent);
  const blinkPenalty = Math.min(blinkCount / 4, 1.0);

  // Factor 3: Facial expressiveness
  const expressiveness = avg(recent, s => {
    let sum = 0;
    const keys = Object.keys(s).filter(k => !k.startsWith('_') && k !== 'timestamp');
    for (const key of keys) {
      sum += Math.abs(delta(s, key));
    }
    return sum / Math.max(keys.length, 1);
  });

  // Factor 4: Head stability
  const headVariance = computeVariance(recent, s =>
    Math.abs(delta(s, 'jawLeft')) + Math.abs(delta(s, 'jawRight')) + Math.abs(delta(s, 'jawForward'))
  );
  const headStability = clamp(1.0 - headVariance * 10, 0, 1);

  // Factor 5: Curiosity signals
  const curiosity = avg(recent, s =>
    delta(s, 'browInnerUp') * 0.5 +
    (delta(s, 'eyeWideLeft') + delta(s, 'eyeWideRight')) * 0.25
  );

  // Factor 6: Eye gaze on screen (looking forward, not up/down/left/right excessively)
  const gazeDeviation = avg(recent, s =>
    Math.abs(s.eyeLookUpLeft || 0) + Math.abs(s.eyeLookUpRight || 0) +
    Math.abs(s.eyeLookOutLeft || 0) + Math.abs(s.eyeLookOutRight || 0)
  );
  const gazeOnScreen = clamp(1.0 - gazeDeviation * 2, 0, 1);

  // Factor 7: Reading flow
  const scrollSpeed = Math.abs(getScrollSpeed());
  const readingFlow = scrollSpeed > 5 && scrollSpeed < 120 ? 1.0 :
    scrollSpeed <= 5 ? 0.5 : 0.3;

  // Factor 8: Presence quality
  const signals = getSignals();
  const presenceQuality = (
    (isFaceDetected() ? 0.4 : 0) +
    (signals.tabVisible ? 0.3 : 0) +
    (getMouseIdleSeconds() < 30 ? 0.3 : 0.1)
  );

  // Weighted combination
  const raw = (
    clamp(eyeOpenness + 0.3, 0, 1) * 0.15 +
    (1.0 - blinkPenalty) * 0.10 +
    clamp(expressiveness * 5, 0, 1) * 0.20 +
    headStability * 0.10 +
    clamp(curiosity + 0.3, 0, 1) * 0.15 +
    gazeOnScreen * 0.10 +
    readingFlow * 0.10 +
    presenceQuality * 0.10
  );

  return clamp(raw, 0, 1);
}

function computeDominantEmotion() {
  const recent = sampleBuffer.slice(-10);
  if (recent.length < 3) return { emotion: 'neutral', intensity: 0.15 };

  const scores = {
    curious: avg(recent, s =>
      delta(s, 'browInnerUp') * 0.6 +
      (delta(s, 'eyeWideLeft') + delta(s, 'eyeWideRight')) * 0.2
    ),
    delighted: avg(recent, s =>
      (delta(s, 'mouthSmileLeft') + delta(s, 'mouthSmileRight')) * 0.4 +
      (delta(s, 'cheekSquintLeft') + delta(s, 'cheekSquintRight')) * 0.1
    ),
    confused: avg(recent, s =>
      (delta(s, 'browDownLeft') + delta(s, 'browDownRight')) * 0.4 +
      (delta(s, 'mouthFrownLeft') + delta(s, 'mouthFrownRight')) * 0.1
    ),
    surprised: avg(recent, s =>
      delta(s, 'jawOpen') * 0.4 +
      (delta(s, 'eyeWideLeft') + delta(s, 'eyeWideRight')) * 0.3
    ),
    neutral: 0.08 // baseline threshold
  };

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return {
    emotion: sorted[0][0],
    intensity: clamp(sorted[0][1], 0, 1)
  };
}

function computeGazeOnScreen() {
  const recent = sampleBuffer.slice(-10);
  if (recent.length < 3) return true;

  const gazeAway = avg(recent, s =>
    Math.abs(s.eyeLookOutLeft || 0) + Math.abs(s.eyeLookOutRight || 0) +
    Math.abs(s.eyeLookUpLeft || 0) + Math.abs(s.eyeLookUpRight || 0)
  );

  return gazeAway < 0.3;
}

function computeEngagementTrend() {
  if (engagementHistory.length < 5) return 'stable';
  const recent = engagementHistory.slice(-5);
  const older = engagementHistory.slice(-10, -5);
  if (older.length === 0) return 'stable';

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const diff = recentAvg - olderAvg;

  if (diff > 0.1) return 'rising';
  if (diff < -0.1) return 'falling';
  return 'stable';
}

export function computeReaderState() {
  if (sampleBuffer.length < 3 && !isFaceDetected()) {
    return null;
  }

  const engagement = computeEngagement();
  const { emotion, intensity } = computeDominantEmotion();
  const gazeOnScreen = computeGazeOnScreen();

  // Track history
  engagementHistory.push(engagement);
  if (engagementHistory.length > 30) engagementHistory.shift();
  emotionHistory.push(emotion);
  if (emotionHistory.length > 20) emotionHistory.shift();

  // Attention quality
  const signals = getSignals();
  let attention;
  if (isFaceDetected() && gazeOnScreen && signals.tabVisible) {
    attention = engagement > 0.5 ? 'high' : 'medium';
  } else if (isFaceDetected()) {
    attention = 'low';
  } else {
    attention = 'absent';
  }

  // Eye tracking / reading pattern
  const readingPattern = analyzeReadingPattern();
  const gazePos = getGazeDirection();
  const mostGazed = getMostGazedParagraph();

  return {
    engagement,
    emotion,
    emotionIntensity: intensity,
    readingSpeed: getReadingSpeedLabel(),
    attention,
    gazeOnScreen,
    readerPresent: isFaceDetected(),
    sessionMinutes: getSessionMinutes(),
    justReturned: justReturned(),
    engagementTrend: computeEngagementTrend(),
    rereadCount: getRereadCount(),
    currentParagraph: getCurrentParagraphIndex(),
    tabVisible: signals.tabVisible,
    mouseIdleSeconds: getMouseIdleSeconds(),
    readingPattern: readingPattern.pattern,
    isSkimming: readingPattern.isSkimming,
    isRereading: readingPattern.isRereading,
    isReadingCarefully: readingPattern.isReadingCarefully,
    gazePosition: gazePos,
    mostGazedParagraph: mostGazed.index,
  };
}

// For debug panel: get raw blend shapes with top-N sorted
export function getTopBlendShapes(n = 10) {
  const shapes = getLatestBlendShapes();
  if (!shapes) return [];

  return Object.entries(shapes)
    .filter(([k]) => !k.startsWith('_') && k !== 'timestamp')
    .map(([name, value]) => ({ name, value, delta: value - (baseline[name] || 0) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, n);
}

export function getEmotionHistory() {
  return [...emotionHistory];
}
