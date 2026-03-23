// Debug panel rendering: shows the system's model of the reader

import { computeReaderState, getTopBlendShapes, getEmotionHistory } from './interpreter.js';
import { getRewriteHistory } from './rewriter.js';
import { getParagraphCount, getParagraphState, getCurrentParagraphIndex } from './book-ui.js';
import { getSignals, getMouseIdleSeconds, getReadingSpeedLabel } from './signals.js';

let panel = null;
let isOpen = false;
let updateInterval = null;

export function initDebugPanel() {
  panel = document.getElementById('debug-panel');

  // Toggle with 'd' key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'd' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
      isOpen = !isOpen;
      panel.classList.toggle('open', isOpen);
    }
  });

  // Update at 4Hz when open
  updateInterval = setInterval(() => {
    if (isOpen) render();
  }, 250);
}

function engagementColor(v) {
  if (v > 0.7) return '#4caf50';
  if (v > 0.4) return '#ff9800';
  return '#f44336';
}

function render() {
  const state = computeReaderState();
  if (!state) return;

  // Engagement meter
  const fill = document.getElementById('debug-engagement-fill');
  const value = document.getElementById('debug-engagement-value');
  if (fill && value) {
    fill.style.width = `${state.engagement * 100}%`;
    fill.style.background = engagementColor(state.engagement);
    value.textContent = state.engagement.toFixed(2);
  }

  // Emotion
  const emotionEl = document.getElementById('debug-emotion');
  if (emotionEl) {
    const history = getEmotionHistory();
    const trail = history.slice(-8).join(' → ');
    emotionEl.innerHTML = `
      <strong>${state.emotion}</strong> (${state.emotionIntensity.toFixed(2)})
      <div class="trail">${trail}</div>
    `;
  }

  // Signals
  const signalsEl = document.getElementById('debug-signals');
  if (signalsEl) {
    const signals = getSignals();
    const rows = [
      ['face', state.readerPresent ? 'detected' : 'absent', state.readerPresent ? 'good' : 'bad'],
      ['gaze', state.gazeOnScreen ? 'on screen' : 'away', state.gazeOnScreen ? 'good' : 'warn'],
      ['tab', signals.tabVisible ? 'visible' : 'hidden', signals.tabVisible ? 'good' : 'bad'],
      ['window', signals.windowFocused ? 'focused' : 'blurred', signals.windowFocused ? 'good' : 'warn'],
      ['mouse', `idle ${getMouseIdleSeconds().toFixed(0)}s`, getMouseIdleSeconds() < 30 ? 'good' : 'warn'],
      ['scroll', getReadingSpeedLabel(), getReadingSpeedLabel() === 'normal' ? 'good' : 'warn'],
      ['trend', state.engagementTrend, state.engagementTrend === 'rising' ? 'good' : state.engagementTrend === 'falling' ? 'bad' : 'warn'],
      ['attention', state.attention, state.attention === 'high' ? 'good' : state.attention === 'medium' ? 'warn' : 'bad'],
      ['re-reads', state.rereadCount.toString(), state.rereadCount > 0 ? 'warn' : 'good'],
      ['eye pattern', state.readingPattern || '--', state.isReadingCarefully ? 'good' : state.isSkimming ? 'bad' : 'warn'],
      ['gaze pos', state.gazePosition ? `${state.gazePosition.x.toFixed(2)}, ${state.gazePosition.y.toFixed(2)}` : '--', 'good'],
      ['most gazed', state.mostGazedParagraph >= 0 ? `p${state.mostGazedParagraph + 1}` : '--', 'good'],
      ['session', `${state.sessionMinutes.toFixed(1)}m`, 'good'],
    ];

    signalsEl.innerHTML = rows.map(([label, val, cls]) =>
      `<div class="signal-row"><span class="label">${label}</span><span class="value ${cls}">${val}</span></div>`
    ).join('');
  }

  // Blend shapes
  const bsEl = document.getElementById('debug-blend-shapes');
  if (bsEl) {
    const top = getTopBlendShapes(12);
    bsEl.innerHTML = top.map(({ name, value, delta }) => {
      const width = Math.abs(delta) * 300; // scale up for visibility
      return `<div class="blend-bar">
        <label>${name}</label>
        <div class="bar"><div class="fill" style="width:${Math.min(width, 100)}%"></div></div>
      </div>`;
    }).join('');
  }

  // Paragraph map
  const mapEl = document.getElementById('debug-paragraph-map');
  if (mapEl) {
    const count = getParagraphCount();
    const currentIdx = getCurrentParagraphIndex();
    let html = '';
    for (let i = 0; i < count; i++) {
      const ps = getParagraphState(i);
      let cls = 'mutable';
      if (ps?.frozen) cls = 'frozen';
      else if (i === currentIdx) cls = 'current';
      if (ps?.element?.dataset.rewriting) cls = 'rewriting';
      html += `<div class="p-dot ${cls}">${i + 1}</div>`;
    }
    mapEl.innerHTML = html;
  }

  // Rewrite log
  const logEl = document.getElementById('debug-rewrite-log');
  if (logEl) {
    const history = getRewriteHistory().slice(-10).reverse();
    logEl.innerHTML = history.map(entry => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      return `<div class="entry"><span class="time">${time}</span> <span class="action">${entry.summary}</span></div>`;
    }).join('');
  }
}

// Update status indicator (always visible)
export function updateStatus(status, state) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (!dot || !text) return;

  dot.className = 'dot ' + state;
  text.textContent = status;
}
