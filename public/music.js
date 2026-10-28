// Global background-music toggle. Independent of room SSE and the ask-form:
// this never touches game state, never autoplays, and never assumes a format
// works just because the <audio> tag parsed — every state change is driven by
// a real event (a click, a real play()/pause() outcome), not an optimistic
// guess, so the button never claims "on" when the browser actually refused.
(() => {
  const STORAGE_KEY = "turtle-soup-music-enabled";
  const VOLUME = 0.15;

  const button = document.getElementById("music-toggle");
  const audio = document.getElementById("bg-music");
  const statusEl = document.getElementById("music-status");
  if (!button || !audio) return;

  audio.volume = VOLUME;

  function announce(message) {
    if (statusEl) statusEl.textContent = message;
  }

  function setButtonState(on) {
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "🔊 Music on" : "🔈 Music off";
  }

  // A browser that can't decode this file would still let .play() resolve on
  // some engines only to produce silence — canPlayType is the one honest
  // signal available without actually trying to decode audio data.
  function canPlayOgg() {
    return audio.canPlayType('audio/ogg; codecs="vorbis"') !== "";
  }

  let userEnabled = false;
  try {
    userEnabled = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // localStorage can throw in a locked-down/private context — treat as
    // "no stored preference," not a crash.
  }

  if (!canPlayOgg()) {
    setButtonState(false);
    button.disabled = true;
    button.title = "This browser can't play the OGG music file";
    announce("Music isn't available: this browser can't play OGG audio.");
    return;
  }

  function persist(on) {
    try {
      localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    } catch {
      // Best-effort only — a failed write just means the preference won't
      // survive a reload, not a reason to fail the toggle itself.
    }
  }

  // Resolves true only once playback has actually, verifiably started.
  // Browsers reject autoplay-without-interaction with a real rejected
  // promise (never a false positive here) — this never flips the button to
  // "on" ahead of that outcome.
  async function attemptPlay() {
    try {
      await audio.play();
      setButtonState(true);
      announce("");
      return true;
    } catch (err) {
      setButtonState(false);
      announce("Couldn't start music — click the music button to enable it.");
      return false;
    }
  }

  function stop() {
    audio.pause();
    setButtonState(false);
  }

  button.addEventListener("click", async () => {
    if (!audio.paused) {
      stop();
      userEnabled = false;
      persist(false);
      return;
    }
    const started = await attemptPlay();
    userEnabled = started;
    persist(started);
  });

  // Only ever TRIES to restore a prior "on" preference — browsers block
  // unrequested autoplay regardless, so this attempt either silently
  // succeeds (the browser already counts this page load as a user gesture,
  // e.g. after a same-site navigation shortly after a click) or silently
  // fails and leaves the button correctly showing "off," inviting a real
  // click rather than pretending playback is happening.
  if (userEnabled) {
    audio.play().then(
      () => setButtonState(true),
      () => {
        setButtonState(false);
        persist(false);
      },
    );
  }

  // Hidden-tab pause / foreground resume — only resumes if the user had
  // explicitly turned it on AND the browser still permits it; never forces
  // playback back on from a hidden state, and never surfaces a failed
  // resume as broken (that's an ordinary, expected autoplay restriction).
  let pausedByVisibility = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (!audio.paused) {
        audio.pause();
        pausedByVisibility = true;
      }
    } else if (pausedByVisibility) {
      pausedByVisibility = false;
      let enabled = false;
      try {
        enabled = localStorage.getItem(STORAGE_KEY) === "1";
      } catch {
        // no stored preference available — don't resume
      }
      if (enabled) {
        audio.play().then(
          () => setButtonState(true),
          () => setButtonState(false),
        );
      }
    }
  });
})();
