# AI Book: A Story That Reads You Back

A web-based short story that watches your face while you read and rewrites itself in real-time to keep you engaged. Uses facial expression detection to sense your emotions and engagement, then adapts the narrative — shifting tone, pacing, and plot based on what it sees.

The story extends infinitely as you read, generating new paragraphs as you approach the end. It can resolve plotlines and open new ones, creating a living narrative shaped by your reactions.

## How it works

1. **Webcam + MediaPipe** detects 52 facial blend shapes (smile, frown, raised brows, eye gaze, etc.) entirely in-browser
2. **Signal fusion** combines facial expressions with scroll behavior, tab focus, reading speed, and eye tracking into an engagement score and emotion classification
3. **Claude (Sonnet)** rewrites upcoming paragraphs when it detects a specific reason to adapt — e.g., "reader started skimming", "engagement dropped", "emotion shifted from curious to confused"
4. **The story extends** automatically, generating new paragraphs as you read so it never ends

## Quick start

```bash
cp .env.example .env  # or create .env with: ANTHROPIC_API_KEY=sk-ant-...
npm install
node server.js
```

Then open:
- **English**: http://localhost:3000
- **繁體中文**: http://localhost:3000/zh-tw

## Controls

| Key | Action |
|-----|--------|
| `d` | Toggle debug panel (engagement, emotion, blend shapes, rewrite log) |
| `g` | Toggle gaze visualization (heatmap, direction indicator) |
| `Shift+G` | Cycle gaze viz modes (all / heatmap / direction) |
| Top-left button | Toggle between invisible mode (seamless) and visible mode (shows rewriting animation) |

## Requirements

- Node.js 18+
- An Anthropic API key with credits
- A webcam
- A modern browser (Chrome or Firefox)
