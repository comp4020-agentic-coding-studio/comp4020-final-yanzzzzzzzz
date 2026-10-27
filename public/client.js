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
        <p class="entry-question"><span class="entry-label">${escapeHtml(entry.label ?? "Anonymous Detective")}</span> ${verb}: ${escapeHtml(entry.body)}</p>
        <p class="entry-verdict">AI judge: <strong>${escapeHtml(verdictLabel)}</strong></p>
      `;
    }
    return li;
  }

  const judgingEl = document.getElementById("judging-status");
  function hideJudging() {
    if (judgingEl) judgingEl.hidden = true;
  }

  function appendEntry(entry) {
    const id = String(entry.id);
    if (seen.has(id)) return;
    seen.add(id);
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

  const lastId = section.dataset.lastId ? Number(section.dataset.lastId) : 0;
  const source = new EventSource(`/rooms/${roomCode}/stream?after=${lastId}`);
  source.onmessage = (event) => {
    if (!event.data) return; // heartbeat
    appendEntry(JSON.parse(event.data));
  };
  source.addEventListener("presence", (event) => {
    renderPresence(JSON.parse(event.data));
  });
  source.addEventListener("judging", (event) => {
    if (!judgingEl) return;
    const { label } = JSON.parse(event.data);
    judgingEl.textContent = `⌛ ${label} is waiting on the AI judge…`;
    judgingEl.hidden = false;
  });

  // Navigating away (e.g. clicking a link) doesn't necessarily tear down an
  // in-flight EventSource right away — the browser may leave it dangling for
  // a while before the server notices it's gone. Closing it explicitly on
  // pagehide tells the server immediately, so the online count drops without
  // a delay.
  window.addEventListener("pagehide", () => source.close());

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
      await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ question, kind }),
      });
      input.value = "";
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
