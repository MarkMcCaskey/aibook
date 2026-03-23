// Eye tracking: coarse gaze direction from MediaPipe blend shapes
// NOT pixel-accurate — provides direction, reading patterns, and paragraph-level attention

import { getLatestBlendShapes, isFaceDetected } from './sensing.js';
import { getCurrentParagraphIndex } from './book-ui.js';

// Gaze direction (coarse: -1 to 1 range, not screen coordinates)
let gazeX = 0; // negative = left, positive = right
let gazeY = 0; // negative = up, positive = down
let gazeHistory = []; // { x, y, direction, t }
let paragraphAttention = new Map(); // paragraphIndex -> cumulative ms
let samplingInterval = null;

// Calibration
let baselineX = 0;
let baselineY = 0;
let calibrated = false;

const HISTORY_MAX = 600;
const SMOOTHING = 0.12; // heavy smoothing to reduce jitter

export function getGazeDirection() {
  return { x: gazeX, y: gazeY };
}

export function getGazeHistory() {
  return gazeHistory;
}

export function getHeatmap() {
  return paragraphAttention;
}

// Simplified: just get the "looking at screen center" baseline
export function calibrateGaze() {
  const shapes = getLatestBlendShapes();
  if (shapes) {
    baselineX = rawX(shapes);
    baselineY = rawY(shapes);
    calibrated = true;
  }
}

function rawX(s) {
  // Horizontal: positive = looking right
  const left = (s.eyeLookInLeft || 0) - (s.eyeLookOutLeft || 0);   // left eye: in=right, out=left
  const right = (s.eyeLookOutRight || 0) - (s.eyeLookInRight || 0); // right eye: out=right, in=left
  return (left + right) / 2;
}

function rawY(s) {
  // Vertical: positive = looking down
  const left = (s.eyeLookDownLeft || 0) - (s.eyeLookUpLeft || 0);
  const right = (s.eyeLookDownRight || 0) - (s.eyeLookUpRight || 0);
  return (left + right) / 2;
}

export function startGazeTracking() {
  samplingInterval = setInterval(() => {
    const shapes = getLatestBlendShapes();
    if (!shapes || !isFaceDetected()) return;

    let dx = rawX(shapes) - (calibrated ? baselineX : 0);
    let dy = rawY(shapes) - (calibrated ? baselineY : 0);

    // Heavy exponential smoothing
    gazeX = gazeX * (1 - SMOOTHING) + dx * SMOOTHING;
    gazeY = gazeY * (1 - SMOOTHING) + dy * SMOOTHING;

    // Classify coarse direction
    let direction;
    if (Math.abs(gazeX) > 0.08 && Math.abs(gazeX) > Math.abs(gazeY)) {
      direction = gazeX > 0 ? 'right' : 'left';
    } else if (gazeY > 0.05) {
      direction = 'down';
    } else if (gazeY < -0.05) {
      direction = 'up';
    } else {
      direction = 'center';
    }

    const now = Date.now();
    gazeHistory.push({ x: gazeX, y: gazeY, direction, t: now });
    if (gazeHistory.length > HISTORY_MAX) gazeHistory.shift();

    // Accumulate attention on the current paragraph (from scroll tracking, not gaze position)
    // This is more reliable than trying to map gaze to screen coordinates
    const currentIdx = getCurrentParagraphIndex();
    paragraphAttention.set(currentIdx, (paragraphAttention.get(currentIdx) || 0) + 100);
  }, 100);
}

export function stopGazeTracking() {
  if (samplingInterval) clearInterval(samplingInterval);
}

// Reading pattern analysis from eye movement direction history
export function analyzeReadingPattern() {
  if (gazeHistory.length < 20) return { pattern: 'insufficient_data' };

  const recent = gazeHistory.slice(-30); // last 3 seconds

  let upCount = 0;
  let downCount = 0;
  let leftRightSweeps = 0;
  let centerCount = 0;

  for (const entry of recent) {
    if (entry.direction === 'up') upCount++;
    else if (entry.direction === 'down') downCount++;
    else if (entry.direction === 'left' || entry.direction === 'right') leftRightSweeps++;
    else centerCount++;
  }

  const total = recent.length;

  // Vertical movement variance (jitter detection)
  const yValues = recent.map(e => e.y);
  const yMean = yValues.reduce((a, b) => a + b, 0) / yValues.length;
  const yVariance = yValues.reduce((sum, v) => sum + (v - yMean) ** 2, 0) / yValues.length;

  let pattern;
  const isRereading = upCount > total * 0.3;
  const isSkimming = downCount > total * 0.4 && yVariance > 0.001;
  const isReadingCarefully = leftRightSweeps > total * 0.25;
  const isFixated = centerCount > total * 0.7 && yVariance < 0.0005;

  if (isRereading) pattern = 'rereading';
  else if (isSkimming) pattern = 'skimming';
  else if (isReadingCarefully) pattern = 'line_by_line';
  else if (isFixated) pattern = 'fixated';
  else pattern = 'normal';

  return {
    pattern,
    isRereading,
    isSkimming,
    isReadingCarefully,
    yVariance,
    upCount,
    downCount,
    leftRightSweeps,
  };
}

export function getMostGazedParagraph() {
  let maxTime = 0;
  let maxIdx = -1;
  for (const [idx, time] of paragraphAttention) {
    if (time > maxTime) { maxTime = time; maxIdx = idx; }
  }
  return { index: maxIdx, timeMs: maxTime };
}

// Simple helper: is the reader looking generally at the screen?
export function isLookingAtScreen() {
  return Math.abs(gazeX) < 0.15 && Math.abs(gazeY) < 0.2;
}
