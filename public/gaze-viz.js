// Gaze visualization: direction indicator, reading pattern, paragraph heatmap

import { getGazeDirection, getGazeHistory, getHeatmap, analyzeReadingPattern } from './gaze.js';

let canvas = null;
let ctx = null;
let animFrame = null;
let enabled = false;
let mode = 'all'; // 'all', 'heatmap', 'direction', 'off'

export function initGazeViz() {
  canvas = document.createElement('canvas');
  canvas.id = 'gaze-canvas';
  canvas.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    pointer-events: none;
    z-index: 80;
    opacity: 0;
    transition: opacity 0.3s;
  `;
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'g' && !e.ctrlKey && !e.metaKey) {
      if (e.shiftKey) {
        const modes = ['all', 'heatmap', 'direction'];
        mode = modes[(modes.indexOf(mode) + 1) % modes.length];
        console.log(`[gaze-viz] Mode: ${mode}`);
      } else {
        enabled = !enabled;
        canvas.style.opacity = enabled ? '1' : '0';
        console.log(`[gaze-viz] ${enabled ? 'ON' : 'OFF'} (shift+g cycles modes)`);
      }
    }
  });
}

function resizeCanvas() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

export function startGazeViz() {
  function draw() {
    if (enabled && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (mode === 'heatmap' || mode === 'all') drawHeatmap();
      if (mode === 'direction' || mode === 'all') drawDirectionIndicator();
      if (mode === 'all') drawReadingPattern();
    }
    animFrame = requestAnimationFrame(draw);
  }
  draw();
}

export function stopGazeViz() {
  if (animFrame) cancelAnimationFrame(animFrame);
}

// Paragraph-level heatmap based on dwell time (reliable, not gaze-pixel)
function drawHeatmap() {
  const heatmap = getHeatmap();
  if (heatmap.size === 0) return;

  let maxTime = 0;
  for (const time of heatmap.values()) {
    if (time > maxTime) maxTime = time;
  }
  if (maxTime === 0) return;

  const paragraphs = document.querySelectorAll('.paragraph');
  for (const p of paragraphs) {
    const idx = parseInt(p.dataset.index);
    const time = heatmap.get(idx) || 0;
    const intensity = Math.min(time / maxTime, 1.0);

    if (intensity > 0.05) {
      const rect = p.getBoundingClientRect();
      // Cool to warm: blue → orange → red
      const r = Math.floor(70 + intensity * 185);
      const g = Math.floor(130 - intensity * 60);
      const b = Math.floor(180 - intensity * 150);
      const a = intensity * 0.1;

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
      roundRect(ctx, rect.left - 4, rect.top - 2, rect.width + 8, rect.height + 4, 4);
      ctx.fill();
    }
  }
}

// Small compass-style indicator showing gaze direction
function drawDirectionIndicator() {
  const { x, y } = getGazeDirection();
  const cx = 40;
  const cy = canvas.height - 50;
  const radius = 20;

  // Background circle
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.fill();

  // Ring
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Direction dot (map gaze direction to position within circle)
  const dotX = cx + x * radius * 4; // scale up — blend shape deltas are small
  const dotY = cy + y * radius * 4;
  // Clamp within circle
  const dx = dotX - cx;
  const dy = dotY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const clampedDist = Math.min(dist, radius);
  const angle = Math.atan2(dy, dx);
  const finalX = cx + Math.cos(angle) * clampedDist;
  const finalY = cy + Math.sin(angle) * clampedDist;

  // Glow
  const gradient = ctx.createRadialGradient(finalX, finalY, 0, finalX, finalY, 8);
  gradient.addColorStop(0, 'rgba(70, 130, 180, 0.6)');
  gradient.addColorStop(1, 'rgba(70, 130, 180, 0.0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(finalX, finalY, 8, 0, Math.PI * 2);
  ctx.fill();

  // Dot
  ctx.fillStyle = 'rgba(70, 130, 180, 0.9)';
  ctx.beginPath();
  ctx.arc(finalX, finalY, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawReadingPattern() {
  const pattern = analyzeReadingPattern();
  if (pattern.pattern === 'insufficient_data') return;

  const labels = {
    rereading: 're-reading',
    skimming: 'skimming',
    line_by_line: 'reading carefully',
    fixated: 'fixated',
    normal: 'reading',
  };

  const colors = {
    rereading: 'rgba(255, 152, 0, 0.8)',
    skimming: 'rgba(244, 67, 54, 0.8)',
    line_by_line: 'rgba(76, 175, 80, 0.8)',
    fixated: 'rgba(156, 39, 176, 0.8)',
    normal: 'rgba(158, 158, 158, 0.5)',
  };

  ctx.font = '10px "SF Mono", "Fira Code", monospace';
  ctx.fillStyle = colors[pattern.pattern] || 'rgba(158,158,158,0.5)';
  ctx.fillText(labels[pattern.pattern] || pattern.pattern, 10, canvas.height - 80);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
