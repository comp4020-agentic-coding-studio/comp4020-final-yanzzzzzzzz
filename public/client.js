// Progressive enhancement only: the room page already works with plain HTML
// forms and full-page navigations. This adds live updates (SSE) and skips
// the full reload on submit when JS is available.
(() => {
  const section = document.querySelector(".room");
  if (!section) return;

  const roomCode = section.dataset.roomCode;
  const transcript = document.getElementById("transcript");
  const seen = new Set(
    [...transcript.querySelectorAll(".entry[data-id]")].map((li) => li.dataset.id),
  );

  const VERDICT_LABEL = { yes: "Yes", no: "No", irrelevant: "Irrelevant", correct: "✓ Correct!" };
  // Mirrors src/routes/rooms.ts's NOTICES — only the subset reachable from
  // POST /rooms/:code/ask's own rejections (cooldown, not-started,
  // author-guess), since that's the only redirect this form's own fetch()
  // can land on.
  const NOTICE_TEXT = {
    cooldown: "Slow down — the same person has to wait a few seconds between questions.",
    "not-started": "This case hasn't started yet — wait for the host.",
    "author-guess": "You wrote this case — let someone else crack it.",
  };

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  function renderEntry(entry) {
    const li = document.createElement("li");
    li.className = `entry entry-${entry.kind}`;
    li.dataset.id = entry.id;
    if (entry.kind === "system") {
      li.textContent = entry.body;
    } else {
      const verdictLabel = entry.verdict ? VERDICT_LABEL[entry.verdict] ?? entry.verdict : "…";
      const verb = entry.kind === "guess" ? "guesses" : "asks";
      li.innerHTML = `
        <p class="entry-question"><span class="entry-label">${escapeHtml(entry.label ?? "匿名侦探")}</span> ${verb}: ${escapeHtml(entry.body)}</p>
        <p class="entry-verdict">AI judge: <strong>${escapeHtml(verdictLabel)}</strong></p>
      `;
    }
    return li;
  }

  const judgingEl = document.getElementById("judging-status");
  function hideJudging() {
    if (judgingEl) judgingEl.hidden = true;
  }

  let lastId = section.dataset.lastId ? Number(section.dataset.lastId) : 0;

  function appendEntry(entry) {
    const id = String(entry.id);
    if (seen.has(id)) return;
    seen.add(id);
    lastId = Math.max(lastId, entry.id);
    hideJudging(); // every path that reaches this appends at least one entry
    transcript.appendChild(renderEntry(entry));
    transcript.lastElementChild.scrollIntoView({ block: "nearest" });
    if (entry.verdict === "correct") {
      location.reload(); // server flips the room to solved; simplest correct state is a fresh render
    }
  }

  const onlineCountEl = document.getElementById("online-count");
  const membersEl = document.getElementById("members");
  const hostSessionId = section.dataset.hostSessionId;
  const viewerIsHost = section.dataset.isHost === "true";
  const roomCodeForTransfer = roomCode;

  // Mirrors src/render/room.ts's memberRowHtml() — a presence update re-
  // renders the same host badge / transfer-host affordance the server does.
  function renderMember(member) {
    const isHost = member.sessionId === hostSessionId;
    const crown = isHost ? '<span class="host-badge" title="Host">👑</span> ' : "";
    const transfer =
      viewerIsHost && !isHost
        ? `<form method="post" action="/rooms/${roomCodeForTransfer}/transfer-host" class="transfer-host-form">
            <input type="hidden" name="toSessionId" value="${escapeHtml(member.sessionId)}" />
            <button type="submit" class="transfer-host-button">Make host</button>
          </form>`
        : "";
    return `<li>${crown}${escapeHtml(member.label)}${transfer}</li>`;
  }

  function renderPresence({ online, members }) {
    if (onlineCountEl) {
      onlineCountEl.textContent = `👥 ${online} ${online === 1 ? "person" : "people"} online`;
    }
    if (membersEl && Array.isArray(members)) {
      membersEl.innerHTML = members.map(renderMember).join("");
    }
  }

  // Fly's auto-stop/auto-start cycle (and any ordinary network blip) can cut
  // this connection mid-session — EventSource reconnects on its own with no
  // code needed, but a silent reconnect still looks, to a person watching
  // the page, exactly like a stuck one. This surfaces that state instead of
  // leaving it invisible: visible the moment a drop is detected, cleared the
  // moment a message actually arrives again (not merely "connected", since
  // `onopen` can fire before the server has anything new to say).
  const connectionStatusEl = document.getElementById("connection-status");
  function setConnectionStatus(message) {
    if (!connectionStatusEl) return;
    connectionStatusEl.textContent = message;
    connectionStatusEl.hidden = !message;
  }

  // Not room-status aware server-side (status/host flip): simplest correct
  // response to "the room I'm looking at changed shape" is a fresh render,
  // same as a solved verdict does above — re-deriving the waiting/active
  // markup, the ask-form's presence, and the host badge in JS would mean
  // keeping two copies of that logic in sync instead of one.
  function handleRoomStatus() {
    location.reload();
  }

  const noticeEl = document.getElementById("ask-notice");
  function showAskNotice(message) {
    if (!noticeEl) return;
    noticeEl.textContent = message;
    noticeEl.hidden = false;
  }

  let source = null;

  // A fresh connection (first load, or re-opened after pageshow/visibility
  // restores it) always asks for everything after whatever this tab has
  // actually rendered so far — appendEntry()'s `seen` set additionally drops
  // anything this exact tab already has, so a reconnect can't duplicate an
  // entry even if the server's replay overlaps what was already shown.
  function connectRoomStream() {
    if (source) return;
    source = new EventSource(`/rooms/${roomCode}/stream?after=${lastId}`);
    source.onmessage = (event) => {
      setConnectionStatus("");
      if (!event.data) return; // heartbeat
      appendEntry(JSON.parse(event.data));
    };
    source.onerror = () => {
      if (source.readyState === EventSource.CONNECTING) {
        setConnectionStatus("⚠️ Connection lost, reconnecting…");
      }
    };
    source.addEventListener("presence", (event) => {
      setConnectionStatus("");
      renderPresence(JSON.parse(event.data));
    });
    source.addEventListener("judging", (event) => {
      setConnectionStatus("");
      if (!judgingEl) return;
      const { label } = JSON.parse(event.data);
      judgingEl.textContent = `⌛ ${label} is waiting on the AI judge…`;
      judgingEl.hidden = false;
    });
    // A REAL, reproduced bug: starting the room or transferring host never
    // reached a tab that was already sitting open on the waiting-room view
    // or the member list — nothing was ever broadcast for either action, so
    // "the other person's input box becomes usable after I start the case"
    // silently didn't happen without a manual reload. src/routes/rooms.ts
    // now broadcasts a "room-status" event on both actions; reloading here
    // is what actually picks up the new markup.
    source.addEventListener("room-status", handleRoomStatus);
  }

  function disconnectRoomStream() {
    if (!source) return;
    source.close();
    source = null;
  }

  connectRoomStream();

  // Navigating away (e.g. clicking a link) doesn't necessarily tear down an
  // in-flight EventSource right away — the browser may leave it dangling for
  // a while before the server notices it's gone. Closing it explicitly on
  // pagehide tells the server immediately, so the online count drops without
  // a delay. Restoring the page from the back/forward cache (pageshow with
  // persisted=true) does NOT re-run this script, so without reconnecting
  // here a page reached via the browser's back/forward buttons would be left
  // holding a closed EventSource forever — a real gap, not just this
  // session's lobby.js fix: a user going "back" into a room mid-game would
  // see a page that looks alive but has silently stopped updating.
  window.addEventListener("pagehide", disconnectRoomStream);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) connectRoomStream();
  });

  // Copy-to-clipboard for the room code and the shareable link. Both are
  // plain <button type="button">s with no form action, so with JS off
  // they're simply inert — the code and the URL are both already visible as
  // text, which is the fallback.
  (() => {
    const feedback = document.getElementById("share-feedback");
    let feedbackTimer = null;
    function showFeedback(message) {
      if (!feedback) return;
      feedback.textContent = message;
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => {
        feedback.textContent = "";
      }, 3000);
    }

    async function copy(text, label) {
      try {
        await navigator.clipboard.writeText(text);
        showFeedback(`${label} copied`);
      } catch {
        showFeedback(`Couldn't copy — ${label.toLowerCase()} is ${text}`);
      }
    }

    const copyCodeButton = document.getElementById("copy-code-button");
    if (copyCodeButton) {
      copyCodeButton.addEventListener("click", () => {
        copy(copyCodeButton.dataset.code, "Code");
      });
    }

    const copyLinkButton = document.getElementById("copy-link-button");
    if (copyLinkButton) {
      copyLinkButton.addEventListener("click", () => {
        copy(location.href, "Link");
      });
    }
  })();

  // Reasoning-time heartbeat: only while this tab is the visible one and the
  // room is actually active (not waiting, not solved) — a heartbeat is a
  // claim "a person could plausibly be reading/thinking here right now,"
  // which a hidden tab or a case nobody's started can't make. The server is
  // the one deciding how much time a heartbeat is worth (src/db.ts's
  // recordHeartbeat): this only decides whether to call at all.
  (() => {
    if (section.dataset.roomStatus !== "active") return;
    const HEARTBEAT_MS = 20_000;
    let timer = null;

    function send(resume) {
      const body = resume ? new URLSearchParams({ resume: "1" }) : undefined;
      fetch(`/rooms/${roomCode}/heartbeat`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
        body,
        keepalive: true,
      }).catch(() => {
        // a missed beat just means this stretch isn't credited — nothing to
        // recover, the next successful beat picks up from wherever it lands
      });
    }

    function start() {
      if (timer) return;
      send(true); // a fresh baseline, not a claim about time already spent
      timer = setInterval(() => send(false), HEARTBEAT_MS);
    }

    function stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") start();
      else stop();
    });
    window.addEventListener("pagehide", stop);
  })();

  const form = document.getElementById("ask-form");
  if (!form) return;
  const input = form.querySelector("#question");
  const buttons = [...form.querySelectorAll("button")];

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    // event.submitter is which of the two buttons was actually clicked —
    // the request needs to know whether this is a question or a final guess.
    const kind = event.submitter?.value === "guess" ? "guess" : "question";
    const clicked = event.submitter ?? buttons[0];
    const originalLabel = clicked.textContent;

    for (const b of buttons) b.disabled = true;
    clicked.textContent = kind === "guess" ? "Judge is weighing your guess…" : "AI judge is thinking…";

    try {
      // The server always answers a rejected submission (cooldown,
      // not-started, author-guess) with a 303 to this same page carrying
      // ?notice=..., not an error status — fetch()'s default redirect:
      // "follow" means `res.ok` is true either way, so a REAL bug this
      // session reproduced was this code clearing the input and reporting
      // nothing on a rejection, silently discarding whatever the player
      // typed. Reading the final response's own URL (same information a
      // full-page-reload submit would show, via its address bar after the
      // 303) is what actually distinguishes the two cases.
      const res = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ question, kind }),
      });
      const notice = new URL(res.url).searchParams.get("notice");
      if (notice) {
        showAskNotice(NOTICE_TEXT[notice] ?? "That didn't go through — please try again.");
        // Deliberately NOT clearing the input: a rejected submission is the
        // one case where the player's typed text should still be there to
        // retry, not silently gone.
      } else {
        input.value = "";
      }
    } catch {
      // the SSE connection or a page refresh will still show the true state;
      // surface a hint rather than failing silently
      clicked.textContent = "Network seems unstable, please retry";
      setTimeout(() => {
        clicked.textContent = originalLabel;
      }, 2000);
    } finally {
      for (const b of buttons) b.disabled = false;
      if (clicked.textContent !== "Network seems unstable, please retry") {
        clicked.textContent = originalLabel;
      }
      input.focus();
    }
  });
})();
