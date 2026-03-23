// Book UI: paragraph DOM management, scroll tracking, text transitions

let paragraphStates = []; // { text, frozen, element, streamBuffer, enteredAt }
let currentParagraphIndex = 0;
let visibleMode = false;
let observer = null;

// Dwell time tracking
const dwellTimes = []; // completed dwell times per paragraph index

export function initBookUI() {
  // Mode toggle
  const toggle = document.getElementById('mode-toggle');
  toggle.addEventListener('click', () => {
    visibleMode = !visibleMode;
    toggle.textContent = visibleMode ? 'visible' : 'invisible';
    // Show/hide rewrite horizons
    document.querySelectorAll('.rewrite-horizon').forEach(el => {
      el.classList.toggle('visible', visibleMode);
    });
  });
}

export function isVisibleMode() {
  return visibleMode;
}

export function loadStory(paragraphs) {
  const container = document.getElementById('book-inner');
  container.innerHTML = '';
  paragraphStates = [];

  paragraphs.forEach((text, i) => {
    const el = document.createElement('p');
    el.className = 'paragraph mutable';
    el.dataset.index = i;
    el.textContent = text;
    container.appendChild(el);

    // Add rewrite horizon after paragraph 0 (will move as reader progresses)
    if (i === 0) {
      const hr = document.createElement('hr');
      hr.className = 'rewrite-horizon' + (visibleMode ? ' visible' : '');
      hr.id = 'rewrite-horizon';
      container.appendChild(hr);
    }

    paragraphStates.push({
      text,
      originalText: text,
      frozen: false,
      element: el,
      streamBuffer: '',
      enteredAt: null,
    });
  });

  setupObserver();
}

function setupObserver() {
  if (observer) observer.disconnect();

  observer = new IntersectionObserver((entries) => {
    let maxRatio = 0;
    let maxIndex = currentParagraphIndex;

    for (const entry of entries) {
      const idx = parseInt(entry.target.dataset.index);
      if (entry.intersectionRatio > maxRatio) {
        maxRatio = entry.intersectionRatio;
        maxIndex = idx;
      }
    }

    if (maxIndex !== currentParagraphIndex) {
      // Record dwell time for the paragraph we're leaving
      const leaving = paragraphStates[currentParagraphIndex];
      if (leaving && leaving.enteredAt) {
        const dwell = Date.now() - leaving.enteredAt;
        dwellTimes[currentParagraphIndex] = dwell;
      }

      currentParagraphIndex = maxIndex;

      // Mark entering new paragraph
      const entering = paragraphStates[currentParagraphIndex];
      if (entering) entering.enteredAt = Date.now();

      // Freeze everything above current
      freezeUpTo(currentParagraphIndex - 1);
      updateParagraphClasses();
      moveRewriteHorizon();
    }
  }, {
    threshold: [0, 0.25, 0.5, 0.75, 1.0],
    rootMargin: '-20% 0px -20% 0px'
  });

  for (const state of paragraphStates) {
    observer.observe(state.element);
  }

  // Mark first paragraph as entered
  if (paragraphStates.length > 0) {
    paragraphStates[0].enteredAt = Date.now();
  }
}

function freezeUpTo(index) {
  for (let i = 0; i <= index && i < paragraphStates.length; i++) {
    paragraphStates[i].frozen = true;
  }
}

function updateParagraphClasses() {
  for (let i = 0; i < paragraphStates.length; i++) {
    const el = paragraphStates[i].element;
    el.classList.remove('frozen', 'current', 'mutable');
    if (paragraphStates[i].frozen) {
      el.classList.add('frozen');
    } else if (i === currentParagraphIndex) {
      el.classList.add('current');
    } else {
      el.classList.add('mutable');
    }
  }
}

function moveRewriteHorizon() {
  const hr = document.getElementById('rewrite-horizon');
  if (!hr) return;

  // Move horizon to after current paragraph
  const currentEl = paragraphStates[currentParagraphIndex]?.element;
  if (currentEl && currentEl.nextSibling !== hr) {
    currentEl.after(hr);
  }
}

export function getCurrentParagraphIndex() {
  return currentParagraphIndex;
}

export function getParagraphDwellTime(index) {
  if (index === currentParagraphIndex) {
    const state = paragraphStates[index];
    return state?.enteredAt ? Date.now() - state.enteredAt : 0;
  }
  return dwellTimes[index] || 0;
}

export function getAverageDwellTime() {
  const filled = dwellTimes.filter(d => d > 0);
  if (filled.length === 0) return 5000; // default 5s
  return filled.reduce((a, b) => a + b, 0) / filled.length;
}

export function getBookState() {
  const frozen = [];
  let current = '';
  const upcoming = [];

  for (let i = 0; i < paragraphStates.length; i++) {
    if (paragraphStates[i].frozen) {
      frozen.push(paragraphStates[i].text);
    } else if (i === currentParagraphIndex) {
      current = paragraphStates[i].text;
    } else if (i > currentParagraphIndex) {
      upcoming.push(paragraphStates[i].text);
    }
  }

  return { frozen, current, upcoming, currentIndex: currentParagraphIndex };
}

export function getParagraphCount() {
  return paragraphStates.length;
}

export function getParagraphState(index) {
  return paragraphStates[index] || null;
}

// Called by rewriter to update paragraph text
export function updateParagraphText(index, newText, isDone) {
  const state = paragraphStates[index];
  if (!state || state.frozen) return;

  if (visibleMode) {
    // Visible mode: show streaming text with animation
    if (isDone) {
      state.text = newText;
      state.streamBuffer = '';
      state.element.textContent = newText;
      state.element.classList.remove('rewriting');
      state.element.classList.add('rewrite-complete');
      setTimeout(() => state.element.classList.remove('rewrite-complete'), 2000);
    } else {
      state.streamBuffer = newText;
      state.element.textContent = newText;
      state.element.classList.add('rewriting');
    }
  } else {
    // Invisible mode: buffer until done, then cross-fade
    if (isDone) {
      crossFadeText(state.element, newText);
      state.text = newText;
      state.streamBuffer = '';
    } else {
      state.streamBuffer = newText;
    }
  }
}

function crossFadeText(element, newText) {
  element.classList.add('fading-out');
  setTimeout(() => {
    element.textContent = newText;
    element.classList.remove('fading-out');
    element.classList.add('fading-in');
    // Force reflow
    element.offsetHeight;
    element.classList.remove('fading-in');
  }, 350);
}

// Append a new paragraph to the end of the story
export function appendParagraph(text) {
  const container = document.getElementById('book-inner');
  const index = paragraphStates.length;

  const el = document.createElement('p');
  el.className = 'paragraph mutable';
  el.dataset.index = index;
  el.textContent = text;
  container.appendChild(el);

  const state = {
    text,
    originalText: text,
    frozen: false,
    element: el,
    streamBuffer: '',
    enteredAt: null,
  };
  paragraphStates.push(state);

  // Observe the new paragraph
  if (observer) observer.observe(el);

  return index;
}

// How many paragraphs remain ahead of the reader
export function paragraphsAhead() {
  return paragraphStates.length - 1 - currentParagraphIndex;
}

// Get the last N paragraph texts (for context when extending)
export function getRecentParagraphs(n = 5) {
  return paragraphStates.slice(-n).map(s => s.text);
}

// Mark a paragraph as currently being rewritten (for debug map)
export function markRewriting(index, isRewriting) {
  const state = paragraphStates[index];
  if (!state) return;
  if (isRewriting) {
    state.element.dataset.rewriting = 'true';
  } else {
    delete state.element.dataset.rewriting;
  }
}
