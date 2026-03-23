// App orchestrator: ties all modules together

import { initSensing } from './sensing.js';
import { initSignals } from './signals.js';
import { calibrate, startInterpretation } from './interpreter.js';
import { startRewriteLoop, onRewrite } from './rewriter.js';
import { initBookUI, loadStory } from './book-ui.js';
import { initDebugPanel, updateStatus } from './debug-panel.js';
import { calibrateGaze, startGazeTracking } from './gaze.js';
import { initGazeViz, startGazeViz } from './gaze-viz.js';
import { seedStory } from './story-seed.js';

async function main() {
  // Phase 1: Show the book immediately
  initBookUI();
  initSignals();
  loadStory(seedStory);
  initGazeViz();
  updateStatus('loading', 'inactive');

  // Phase 2: Wait for user to click "Begin"
  const cameraPrompt = document.getElementById('camera-prompt');
  const calibrationOverlay = document.getElementById('calibration-overlay');
  const startBtn = document.getElementById('camera-start-btn');

  await new Promise(resolve => {
    startBtn.addEventListener('click', resolve, { once: true });
  });

  cameraPrompt.classList.add('hidden');
  updateStatus('initializing camera', 'detecting');

  // Phase 3: Initialize face detection
  try {
    await initSensing();
    updateStatus('camera ready', 'active');
  } catch (e) {
    console.error('Camera init failed:', e);
    updateStatus('no camera — static mode', 'inactive');
    cameraPrompt.classList.add('hidden');
    calibrationOverlay.classList.add('hidden');
    return;
  }

  // Phase 4: Calibration (face + gaze baseline)
  calibrationOverlay.classList.remove('hidden');
  const progressFill = document.getElementById('calibration-progress');

  await calibrate(3000, (progress) => {
    progressFill.style.width = `${progress * 100}%`;
  });

  // Calibrate gaze baseline at the end of face calibration
  calibrateGaze();

  calibrationOverlay.classList.add('hidden');
  updateStatus('reading', 'active');

  // Phase 5: Start all the loops
  startInterpretation();
  startGazeTracking();
  startGazeViz();
  startRewriteLoop();
  initDebugPanel();

  // Log rewrites to console
  onRewrite((entry) => {
    console.log(`[rewrite] ${entry.summary}`);
    updateStatus(`rewriting...`, 'detecting');
    setTimeout(() => updateStatus('reading', 'active'), 2000);
  });

  console.log('AI Book initialized.');
  console.log('  Press "d" to toggle debug panel');
  console.log('  Press "g" to toggle gaze visualization');
  console.log('  Press "shift+g" to cycle gaze viz modes (all/dot/trail/heatmap)');
}

main().catch(console.error);
