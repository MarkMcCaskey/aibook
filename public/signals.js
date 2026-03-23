// Browser signal collectors: visibility, focus, mouse, scroll patterns, time
// Pure data collection — interpretation happens in interpreter.js

const state = {
  tabVisible: true,
  windowFocused: true,
  lastMouseMove: Date.now(),
  lastMouseX: 0,
  lastMouseY: 0,
  scrollHistory: [],       // { y, t } entries
  sessionStart: Date.now(),
  timeAwayStart: null,      // when the user left (null if present)
  lastReturnTime: null,     // when they last came back
  totalTimeAway: 0,         // cumulative ms away
  windowResizes: 0,
  scrollDirectionChanges: 0,
  lastScrollDirection: null, // 'down' or 'up'
  lastScrollY: 0,
};

export function getSignals() {
  return { ...state };
}

export function getSessionMinutes() {
  return (Date.now() - state.sessionStart) / 60000;
}

export function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 6) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

export function justReturned(withinMs = 10000) {
  return state.lastReturnTime && (Date.now() - state.lastReturnTime) < withinMs;
}

export function getMouseIdleSeconds() {
  return (Date.now() - state.lastMouseMove) / 1000;
}

export function getScrollSpeed() {
  const hist = state.scrollHistory;
  if (hist.length < 2) return 0;
  const recent = hist.slice(-8);
  const dy = recent[recent.length - 1].y - recent[0].y;
  const dt = recent[recent.length - 1].t - recent[0].t;
  if (dt === 0) return 0;
  return (dy / dt) * 1000; // pixels per second
}

export function getReadingSpeedLabel() {
  const speed = Math.abs(getScrollSpeed());
  if (speed < 5) return 'stopped';
  if (speed < 40) return 'slow';
  if (speed < 120) return 'normal';
  return 'fast';
}

export function getRereadCount() {
  // Count recent scroll-up events (last 30 seconds)
  let count = 0;
  const cutoff = Date.now() - 30000;
  const recent = state.scrollHistory.filter(s => s.t > cutoff);
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].y < recent[i - 1].y - 20) count++;
  }
  return count;
}

export function initSignals() {
  // Tab visibility
  document.addEventListener('visibilitychange', () => {
    state.tabVisible = !document.hidden;
    if (document.hidden) {
      state.timeAwayStart = Date.now();
    } else if (state.timeAwayStart) {
      state.totalTimeAway += Date.now() - state.timeAwayStart;
      state.lastReturnTime = Date.now();
      state.timeAwayStart = null;
    }
  });

  // Window focus
  window.addEventListener('focus', () => {
    state.windowFocused = true;
    if (state.timeAwayStart) {
      state.totalTimeAway += Date.now() - state.timeAwayStart;
      state.lastReturnTime = Date.now();
      state.timeAwayStart = null;
    }
  });
  window.addEventListener('blur', () => {
    state.windowFocused = false;
    if (!state.timeAwayStart) state.timeAwayStart = Date.now();
  });

  // Mouse
  document.addEventListener('mousemove', (e) => {
    state.lastMouseMove = Date.now();
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
  });

  // Scroll tracking
  let scrollThrottle = 0;
  window.addEventListener('scroll', () => {
    const now = Date.now();
    if (now - scrollThrottle < 100) return; // throttle to 10Hz
    scrollThrottle = now;

    const y = window.scrollY;
    state.scrollHistory.push({ y, t: now });
    if (state.scrollHistory.length > 200) state.scrollHistory.splice(0, 50);

    // Detect direction changes (re-reading)
    const dir = y > state.lastScrollY ? 'down' : y < state.lastScrollY ? 'up' : state.lastScrollDirection;
    if (dir && dir !== state.lastScrollDirection && state.lastScrollDirection !== null) {
      state.scrollDirectionChanges++;
    }
    state.lastScrollDirection = dir;
    state.lastScrollY = y;
  });

  // Window resize
  window.addEventListener('resize', () => {
    state.windowResizes++;
  });
}
