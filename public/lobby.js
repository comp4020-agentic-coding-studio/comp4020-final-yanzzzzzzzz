// Progressive enhancement only: the lobby list is already server-rendered
// with whatever rooms were open on load. This adds live updates (SSE) so a
// room created by someone else appears without a manual refresh.
(() => {
  const list = document.getElementById("lobby-list");
  if (!list) return;

  const emptyNotice = document.querySelector(".lobby-empty");
  const seen = new Set([...list.querySelectorAll("li[data-code]")].map((li) => li.dataset.code));

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  // Mirrors src/render/home.ts's caseCardHtml() — a newly created room
  // arrives this way instead of a full page reload.
  function addRoom(room) {
    if (seen.has(room.code)) return;
    seen.add(room.code);
    if (emptyNotice) emptyNotice.hidden = true;
    const li = document.createElement("li");
    li.className = "case-card";
    li.dataset.code = room.code;
    const status = room.started ? "🔎 In progress" : "🆕 Not started yet";
    li.innerHTML = `
      <div class="case-card-main">
        <h3>${escapeHtml(room.title)}</h3>
        <p class="case-card-meta">
          <span class="case-code">Code: <code>${room.code}</code></span>
          <span class="case-status">${status}</span>
          <span class="case-players">👥 ${room.players}</span>
        </p>
      </div>
      <a href="/rooms/${room.code}" class="case-join">Join</a>
    `;
    list.prepend(li);
  }

  const source = new EventSource("/lobby/stream");
  source.onmessage = (event) => {
    if (!event.data) return; // heartbeat
    addRoom(JSON.parse(event.data));
  };

  // See client.js's pagehide listener — same reasoning, so a room's lobby
  // connection doesn't linger past the point the visitor actually left.
  window.addEventListener("pagehide", () => source.close());
})();
