import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

// Load .env manually (no dotenv dependency)
try {
  const envFile = readFileSync('.env', 'utf8');
  for (const line of envFile.split('\n')) {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  }
} catch {}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// Serve Chinese version at /zh-tw
app.get('/zh-tw', (req, res) => {
  res.sendFile('zh-tw.html', { root: 'public' });
});

const client = new Anthropic();

const SYSTEM_PROMPT_ZH = `你是一個文學AI，根據讀者的情緒狀態即時改寫短篇故事的段落。讀者的情緒透過臉部表情分析和行為訊號偵測。

規則：
1. 你會收到：最近的故事脈絡（讀者已經讀過的凍結段落）、讀者正在閱讀的段落、以及需要改寫的即將出現的段落。
2. 只改寫即將出現的段落。不要重複或修改已凍結的段落。
3. 每個改寫的段落必須與凍結的文字保持連貫。人物、場景和已確立的事實必須一致。
4. 你的改寫應該巧妙地根據讀者的狀態調整語氣、節奏和細節程度。不要做突兀的改變。
5. 用與現有文字相同的敘事聲音和風格寫作。必須使用繁體中文。
6. 每個段落應為40-80字。不要超過100字。
7. 用精確的分隔符分隔段落：---PARAGRAPH_BREAK---
8. 不要包含任何後設評論、指示或解釋。只輸出改寫的段落文字。

根據讀者狀態的調整指南：

投入度高（>0.7）時：
- 維持目前的方式，它正在起作用
- 增加更多深度和細膩度
- 信任讀者的理解力

投入度低（<0.3）時：
- 引入意想不到的元素或轉折
- 增加感官細節（聲音、觸感、氣味）
- 縮短句子，加快節奏
- 製造一個未解答的問題或謎團

好奇時：加深謎團，增加層次，保留懸念
愉悅時：延續情感的溫暖，為語言增添美感
困惑時：釐清場景，增加定位細節，簡化句式
驚訝時：延伸造成驚訝的元素，為其增添新維度
中性/無聊時：注入意想不到的事物——聲音、發現、氛圍轉變，改變句子節奏`;

const SYSTEM_PROMPT = `You are a literary AI that rewrites paragraphs of a short story in real-time based on a reader's emotional state detected via facial expression analysis and behavioral signals.

RULES:
1. You will receive: the recent story context (frozen paragraphs the reader has already read), the paragraph the reader is currently on, and the upcoming paragraphs that need rewriting.
2. Rewrite ONLY the upcoming paragraphs. Do not repeat or modify frozen paragraphs.
3. Each rewritten paragraph must maintain continuity with the frozen text. Characters, setting, and established facts must remain consistent.
4. Your rewrites should SUBTLY shift tone, pacing, and detail level based on the reader's state. Do not make jarring changes.
5. Write in the same narrative voice and style as the existing text.
6. Each paragraph should be 40-80 words. Do not make paragraphs longer than 100 words.
7. Separate paragraphs with the exact delimiter: ---PARAGRAPH_BREAK---
8. Do not include any meta-commentary, instructions, or explanations. Output ONLY the rewritten paragraph text.

ADAPTATION GUIDELINES BY READER STATE:

When engagement is HIGH (>0.7):
- Maintain current approach, it's working
- Add slightly more depth and nuance
- Trust the reader with complexity
- Slow the pacing slightly to savor the moment

When engagement is LOW (<0.3):
- Introduce a surprising element or turn
- Increase sensory detail (sounds, textures, smells)
- Shorten sentences, increase pacing
- Add dialogue or action to break monotony
- Create an unanswered question or mystery

When emotion is CURIOUS:
- Deepen the mystery, add layers
- Introduce suggestive details that imply more than they say
- Withhold resolution, build anticipation

When emotion is DELIGHTED:
- Continue the emotional warmth
- Add beauty to the language
- Let moments breathe

When emotion is CONFUSED:
- Clarify the scene or situation
- Add grounding details (physical setting, character actions)
- Simplify sentence structure slightly

When emotion is SURPRISED:
- Build on whatever caused the surprise
- Extend the revelation or twist
- Add another dimension to the surprising element

When emotion is NEUTRAL/BORED:
- This is the most important state to respond to
- Inject something unexpected: a sound, a discovery, a shift in atmosphere
- Use a striking image or metaphor
- Change the sentence rhythm dramatically
- Introduce or foreshadow conflict`;

app.post('/api/rewrite', async (req, res) => {
  const { paragraphs, readerState, rewriteTargetIndices, storyContext, lang } = req.body;
  const systemPrompt = lang === 'zh-tw' ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT;

  const notableSignals = [];
  if (readerState.justReturned) notableSignals.push('Reader just returned after being away');
  if (readerState.rereadCount > 0) notableSignals.push(`Reader re-read ${readerState.rereadCount} paragraph(s) recently`);
  if (readerState.engagementTrend === 'falling') notableSignals.push('Engagement has been declining');
  if (readerState.engagementTrend === 'rising') notableSignals.push('Engagement is increasing');
  if (readerState.readingSpeed === 'fast') notableSignals.push('Reader is skimming — text may not be holding attention');
  if (readerState.readingSpeed === 'stopped') notableSignals.push('Reader has paused — deeply engaged or stepped away');
  if (!readerState.gazeOnScreen) notableSignals.push('Reader is looking away from screen');
  if (readerState.isSkimming) notableSignals.push('Eye tracking shows reader is skimming — not reading every word');
  if (readerState.isRereading) notableSignals.push('Eye tracking shows reader is re-reading — gaze moving back up the page');
  if (readerState.isReadingCarefully) notableSignals.push('Eye tracking shows reader is reading line-by-line, every word');
  if (readerState.readingPattern === 'fixated') notableSignals.push('Reader is fixated on one spot — deeply absorbed or confused');

  const userMessage = `READER STATE:
- Engagement: ${readerState.engagement.toFixed(2)}/1.0
- Dominant emotion: ${readerState.emotion} (intensity: ${readerState.emotionIntensity.toFixed(2)})
- Reading speed: ${readerState.readingSpeed}
- Attention quality: ${readerState.attention}
- Reader present: ${readerState.readerPresent}
- Session time: ${readerState.sessionMinutes.toFixed(1)} minutes
${notableSignals.length > 0 ? '- Notable: ' + notableSignals.join('; ') : ''}

RECENT STORY CONTEXT (frozen, do not modify):
"""
${paragraphs.frozen.join('\n\n')}
"""

READER IS CURRENTLY ON:
"""
${paragraphs.current}
"""

PARAGRAPHS TO REWRITE (${paragraphs.upcoming.length} paragraphs):
"""
${paragraphs.upcoming.join('\n---PARAGRAPH_BREAK---\n')}
"""

${storyContext.rewriteHistory.length > 0 ? 'RECENT REWRITE HISTORY:\n' + storyContext.rewriteHistory.slice(-5).join('\n') : ''}

REASON FOR THIS REWRITE: ${storyContext.reason || 'Adapt to reader state'}

Rewrite the ${paragraphs.upcoming.length} upcoming paragraphs to address the reason above. Maintain the story's continuity and voice. Make the adaptation feel natural, not forced. Respond with ONLY the rewritten paragraphs separated by ---PARAGRAPH_BREAK---`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    let currentTargetIdx = 0;
    let buffer = '';

    function safeWrite(data) {
      if (!res.writableEnded) res.write(data);
    }
    function safeEnd() {
      if (!res.writableEnded) res.end();
    }

    stream.on('text', (text) => {
      buffer += text;

      // Check for paragraph breaks
      while (buffer.includes('---PARAGRAPH_BREAK---')) {
        const breakIdx = buffer.indexOf('---PARAGRAPH_BREAK---');
        const before = buffer.slice(0, breakIdx).trim();
        buffer = buffer.slice(breakIdx + '---PARAGRAPH_BREAK---'.length);

        if (before && currentTargetIdx < rewriteTargetIndices.length) {
          safeWrite(`data: ${JSON.stringify({
            paragraphIndex: rewriteTargetIndices[currentTargetIdx],
            text: before,
            done: true
          })}\n\n`);
          currentTargetIdx++;
        }
      }

      // Stream partial text for current paragraph
      if (buffer.length > 0 && currentTargetIdx < rewriteTargetIndices.length) {
        safeWrite(`data: ${JSON.stringify({
          paragraphIndex: rewriteTargetIndices[currentTargetIdx],
          text: buffer,
          done: false
        })}\n\n`);
      }
    });

    stream.on('end', () => {
      // Flush remaining buffer as final paragraph
      if (buffer.trim() && currentTargetIdx < rewriteTargetIndices.length) {
        safeWrite(`data: ${JSON.stringify({
          paragraphIndex: rewriteTargetIndices[currentTargetIdx],
          text: buffer.trim(),
          done: true
        })}\n\n`);
      }
      safeWrite(`data: ${JSON.stringify({ allDone: true })}\n\n`);
      safeEnd();
    });

    stream.on('error', (err) => {
      console.error('Claude stream error:', err.message);
      safeWrite(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      safeEnd();
    });
  } catch (err) {
    console.error('Rewrite error:', err.message);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// Generate new paragraphs to extend the story
app.post('/api/extend', async (req, res) => {
  const { recentParagraphs, readerState, count, lang } = req.body;
  const systemPrompt = lang === 'zh-tw' ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT;

  const notableSignals = [];
  if (readerState.justReturned) notableSignals.push('Reader just returned after being away');
  if (readerState.engagementTrend === 'falling') notableSignals.push('Engagement has been declining');
  if (readerState.engagementTrend === 'rising') notableSignals.push('Engagement is increasing');
  if (readerState.readingSpeed === 'fast') notableSignals.push('Reader is skimming');

  const userMessage = `READER STATE:
- Engagement: ${readerState.engagement.toFixed(2)}/1.0
- Dominant emotion: ${readerState.emotion} (intensity: ${readerState.emotionIntensity.toFixed(2)})
- Reading speed: ${readerState.readingSpeed}
- Session time: ${readerState.sessionMinutes.toFixed(1)} minutes
${notableSignals.length > 0 ? '- Notable: ' + notableSignals.join('; ') : ''}

STORY SO FAR (most recent paragraphs):
"""
${recentParagraphs.join('\n\n')}
"""

${lang === 'zh-tw'
  ? `用繁體中文繼續這個故事，寫出恰好 ${count} 個新段落。故事應該自然地展開——引入新的細節，發展角色的發現，讓情節有機地演進。可以解決某些懸念，但同時開啟新的線索。讓每個段落都有值得駐足的東西——一個意象、一個發現、一個感受的轉變。根據讀者的情緒狀態調整語氣和節奏。

只用 ---PARAGRAPH_BREAK--- 分隔段落，只輸出故事文字。`
  : `Continue the story with exactly ${count} new paragraphs. The story should unfold naturally — introduce new details, develop what the character discovers, let the plot evolve organically. You may resolve some threads while opening new ones. Each paragraph should have something worth lingering on — an image, a discovery, a shift in feeling. Adapt tone and pacing to the reader's emotional state.

Respond with ONLY the new paragraphs separated by ---PARAGRAPH_BREAK---`}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    let paragraphIdx = 0;
    let buffer = '';

    function safeWrite(data) {
      if (!res.writableEnded) res.write(data);
    }
    function safeEnd() {
      if (!res.writableEnded) res.end();
    }

    stream.on('text', (text) => {
      buffer += text;

      while (buffer.includes('---PARAGRAPH_BREAK---')) {
        const breakIdx = buffer.indexOf('---PARAGRAPH_BREAK---');
        const before = buffer.slice(0, breakIdx).trim();
        buffer = buffer.slice(breakIdx + '---PARAGRAPH_BREAK---'.length);

        if (before) {
          safeWrite(`data: ${JSON.stringify({ text: before, paragraphIdx, done: true })}\n\n`);
          paragraphIdx++;
        }
      }
    });

    stream.on('end', () => {
      if (buffer.trim()) {
        safeWrite(`data: ${JSON.stringify({ text: buffer.trim(), paragraphIdx, done: true })}\n\n`);
      }
      safeWrite(`data: ${JSON.stringify({ allDone: true })}\n\n`);
      safeEnd();
    });

    stream.on('error', (err) => {
      console.error('Claude extend error:', err.message);
      safeWrite(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      safeEnd();
    });
  } catch (err) {
    console.error('Extend error:', err.message);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Book server running at http://localhost:${PORT}`);
  console.log('Press d in the browser to toggle the debug panel');
});
