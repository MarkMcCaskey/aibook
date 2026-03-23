// Loop 3: Intentional story adaptation
// Only calls the LLM when there's a specific reason to rewrite or extend.

import { computeReaderState } from './interpreter.js';
import {
  getBookState, updateParagraphText, markRewriting,
  paragraphsAhead, getRecentParagraphs, appendParagraph
} from './book-ui.js';

const CHECK_INTERVAL = 3000;       // How often to check if action is needed
const MIN_REWRITE_GAP = 20000;     // At least 20s between rewrites
const MIN_EXTEND_GAP = 15000;      // At least 15s between extensions
const EXTEND_THRESHOLD = 4;        // Extend when fewer than 4 paragraphs ahead

let rewriteInFlight = false;
let extendInFlight = false;
let lastRewriteTime = 0;
let lastExtendTime = 0;
let lastReaderState = null;
let rewriteHistory = [];
let checkInterval = null;
let onRewriteCallback = null;
let lang = 'en';

export function setLang(l) { lang = l; }

export function onRewrite(cb) {
  onRewriteCallback = cb;
}

export function getRewriteHistory() {
  return [...rewriteHistory];
}

export function startRewriteLoop() {
  checkInterval = setInterval(tick, CHECK_INTERVAL);
}

export function stopRewriteLoop() {
  if (checkInterval) clearInterval(checkInterval);
}

// Determine if there's a specific REASON to rewrite, and what it is
function getRewriteReason(prev, curr) {
  if (!prev) return null; // Don't rewrite on first reading — let the seed story breathe

  // Strong emotion shift: the reader's feeling changed
  if (prev.emotion !== curr.emotion && curr.emotionIntensity > 0.15) {
    return `Reader emotion shifted from ${prev.emotion} to ${curr.emotion} — adapt upcoming tone`;
  }

  // Engagement crashed: we're losing them
  if (curr.engagement < 0.25 && prev.engagement > 0.4) {
    return `Engagement dropped sharply (${prev.engagement.toFixed(2)} → ${curr.engagement.toFixed(2)}) — inject tension or surprise`;
  }

  // Reader came back after leaving
  if (curr.justReturned) {
    return `Reader returned after being away — re-engage with a hook`;
  }

  // Reader is skimming: text isn't gripping enough
  if (curr.isSkimming && !prev.isSkimming) {
    return `Reader started skimming — text needs to be more compelling, add a turn`;
  }

  // Reader is re-reading: something was confusing or fascinating
  if (curr.isRereading && !prev.isRereading) {
    return `Reader is re-reading — upcoming text should either clarify or deepen`;
  }

  // Reader is confused (facial expression)
  if (curr.emotion === 'confused' && curr.emotionIntensity > 0.2) {
    return `Reader appears confused — simplify and ground the upcoming paragraphs`;
  }

  return null; // No strong reason to rewrite right now
}

async function tick() {
  const readerState = computeReaderState();
  if (!readerState || !readerState.readerPresent) return;

  // EXTEND: keep the story going (this is always needed, not optional)
  const ahead = paragraphsAhead();
  if (ahead < EXTEND_THRESHOLD && !extendInFlight && Date.now() - lastExtendTime > MIN_EXTEND_GAP) {
    extendStory(readerState);
  }

  // REWRITE: only when there's a specific reason
  if (!rewriteInFlight && Date.now() - lastRewriteTime > MIN_REWRITE_GAP) {
    const reason = getRewriteReason(lastReaderState, readerState);
    if (reason) {
      console.log(`[rewrite] Reason: ${reason}`);
      attemptRewrite(readerState, reason);
    }
  }

  lastReaderState = { ...readerState };
}

async function extendStory(readerState) {
  extendInFlight = true;
  lastExtendTime = Date.now();
  const count = 3;
  const recentParagraphs = getRecentParagraphs(5);

  console.log(`[extend] Generating ${count} paragraphs (${paragraphsAhead()} ahead)`);

  try {
    const response = await fetch('/api/extend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recentParagraphs, readerState, count, lang })
    });

    if (!response.ok) { console.error('Extend error:', response.status); return; }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.error) { console.error('Extend error:', data.error); return; }
          if (data.allDone) continue;
          if (data.done && data.text) {
            appendParagraph(data.text);
          }
        } catch (e) {}
      }
    }

    logEntry(`Extended story by ${count} paragraphs (emotion: ${readerState.emotion}, engagement: ${readerState.engagement.toFixed(2)})`);
  } catch (err) {
    console.error('Extend failed:', err);
  } finally {
    extendInFlight = false;
  }
}

async function attemptRewrite(readerState, reason) {
  const { frozen, current, upcoming, currentIndex } = getBookState();
  if (upcoming.length === 0) return;

  const count = Math.min(upcoming.length, 2); // Rewrite at most 2 paragraphs
  const targetIndices = [];
  for (let i = 0; i < count; i++) {
    targetIndices.push(currentIndex + 1 + i);
  }

  rewriteInFlight = true;
  lastRewriteTime = Date.now();
  for (const idx of targetIndices) markRewriting(idx, true);

  try {
    const response = await fetch('/api/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paragraphs: { frozen: frozen.slice(-3), current, upcoming: upcoming.slice(0, count) },
        readerState,
        rewriteTargetIndices: targetIndices,
        lang,
        storyContext: {
          rewriteHistory: rewriteHistory.slice(-5).map(r => r.summary),
          reason,
        }
      })
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.error) { console.error('Rewrite error:', data.error); return; }
          if (data.allDone) continue;
          if (data.paragraphIndex !== undefined) {
            updateParagraphText(data.paragraphIndex, data.text, data.done);
          }
        } catch (e) {}
      }
    }

    logEntry(`Rewrote paragraphs ${targetIndices.join(',')} — ${reason}`);
  } catch (err) {
    console.error('Rewrite failed:', err);
  } finally {
    rewriteInFlight = false;
    for (const idx of targetIndices) markRewriting(idx, false);
  }
}

function logEntry(summary) {
  const entry = { timestamp: Date.now(), summary };
  rewriteHistory.push(entry);
  if (rewriteHistory.length > 50) rewriteHistory.shift();
  if (onRewriteCallback) onRewriteCallback(entry);
}
