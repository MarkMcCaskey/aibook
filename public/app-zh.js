// Chinese version orchestrator — shares all modules, uses Chinese story seed + lang flag

import { initSensing } from './sensing.js';
import { initSignals } from './signals.js';
import { calibrate, startInterpretation } from './interpreter.js';
import { startRewriteLoop, onRewrite, setLang } from './rewriter.js';
import { initBookUI, loadStory } from './book-ui.js';
import { initDebugPanel, updateStatus } from './debug-panel.js';
import { calibrateGaze, startGazeTracking } from './gaze.js';
import { initGazeViz, startGazeViz } from './gaze-viz.js';
import { seedStory } from './story-seed-zh.js';

async function main() {
  initBookUI();
  initSignals();
  loadStory(seedStory);
  initGazeViz();
  setLang('zh-tw');
  updateStatus('載入中', 'inactive');

  const cameraPrompt = document.getElementById('camera-prompt');
  const calibrationOverlay = document.getElementById('calibration-overlay');
  const startBtn = document.getElementById('camera-start-btn');

  await new Promise(resolve => {
    startBtn.addEventListener('click', resolve, { once: true });
  });

  cameraPrompt.classList.add('hidden');
  updateStatus('啟動相機', 'detecting');

  try {
    await initSensing();
    updateStatus('相機就緒', 'active');
  } catch (e) {
    console.error('Camera init failed:', e);
    updateStatus('無相機——靜態模式', 'inactive');
    cameraPrompt.classList.add('hidden');
    calibrationOverlay.classList.add('hidden');
    return;
  }

  calibrationOverlay.classList.remove('hidden');
  const progressFill = document.getElementById('calibration-progress');

  await calibrate(3000, (progress) => {
    progressFill.style.width = `${progress * 100}%`;
  });

  calibrateGaze();
  calibrationOverlay.classList.add('hidden');
  updateStatus('閱讀中', 'active');

  startInterpretation();
  startGazeTracking();
  startGazeViz();
  startRewriteLoop();
  initDebugPanel();

  onRewrite((entry) => {
    console.log(`[rewrite] ${entry.summary}`);
    updateStatus('改寫中…', 'detecting');
    setTimeout(() => updateStatus('閱讀中', 'active'), 2000);
  });

  console.log('AI Book (繁體中文) initialized.');
  console.log('  按 "d" 開啟除錯面板');
  console.log('  按 "g" 開啟眼動追蹤');
}

main().catch(console.error);
