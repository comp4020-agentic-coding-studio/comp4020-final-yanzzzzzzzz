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
      li.innerHTML = `
        <p class="entry-question"><span class="entry-label">${escapeHtml(entry.label ?? "Anonymous Detective")}</span> asks: ${escapeHtml(entry.body)}</p>
        <p class="entry-verdict">AI judge: <strong>${escapeHtml(verdictLabel)}</strong></p>
      `;
    }
    return li;
  }

  function appendEntry(entry) {
    const id = String(entry.id);
    if (seen.has(id)) return;
    seen.add(id);
    transcript.appendChild(renderEntry(entry));
    transcript.lastElementChild.scrollIntoView({ block: "nearest" });
    if (entry.verdict === "correct") {
      location.reload(); // server flips the room to solved; simplest correct state is a fresh render
    }
  }

  const onlineCountEl = document.getElementById("online-count");
  function renderOnlineCount(online) {
    if (!onlineCountEl) return;
    onlineCountEl.textContent = `👥 ${online} ${online === 1 ? "person" : "people"} online`;
  }

  const lastId = section.dataset.lastId ? Number(section.dataset.lastId) : 0;
  const source = new EventSource(`/rooms/${roomCode}/stream?after=${lastId}`);
  source.onmessage = (event) => {
    if (!event.data) return; // heartbeat
    appendEntry(JSON.parse(event.data));
  };
  source.addEventListener("presence", (event) => {
    renderOnlineCount(JSON.parse(event.data).online);
  });

  // Navigating away (e.g. clicking a link) doesn't necessarily tear down an
  // in-flight EventSource right away — the browser may leave it dangling for
  // a while before the server notices it's gone. Closing it explicitly on
  // pagehide tells the server immediately, so the online count drops without
  // a delay.
  window.addEventListener("pagehide", () => source.close());

  const form = document.getElementById("ask-form");
  if (!form) return;
  const input = form.querySelector("#question");
  const button = form.querySelector("button");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "AI judge is thinking…";

    try {
      await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ question }),
      });
      input.value = "";
    } catch {
      // the SSE connection or a page refresh will still show the true state;
      // surface a hint rather than failing silently
      button.textContent = "Network seems unstable, please retry";
      setTimeout(() => {
        button.textContent = originalLabel;
      }, 2000);
    } finally {
      button.disabled = false;
      if (button.textContent === "AI judge is thinking…") button.textContent = originalLabel;
      input.focus();
    }
  });
})();
