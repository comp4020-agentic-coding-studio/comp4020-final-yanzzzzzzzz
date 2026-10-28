// Progressive enhancement only: the lobby list is already server-rendered
// with whatever rooms were open on load. This adds live updates (SSE) so a
// room created, started, or host-transferred elsewhere appears without a
// manual refresh.
(() => {
  const list = document.getElementById("lobby-list");
  if (!list) return;

  const emptyNotice = document.querySelector(".lobby-empty");

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  function statusLabel(status) {
    return status === "waiting" ? "Not started yet" : "In progress";
  }

  function statusClass(status) {
    return status === "waiting" ? "case-status-waiting" : "case-status-active";
  }

  // Mirrors src/render/home.ts's caseCardHtml().
  function cardHtml(room) {
    const roomName = room.name ? escapeHtml(room.name) : `Case ${room.code}`;
    return `
      <div class="case-card-main">
        <h3>${roomName}</h3>
        <p class="case-card-puzzle">playing <strong>${escapeHtml(room.title)}</strong></p>
        <p class="case-card-meta">
          <span class="case-code">Code <code>${room.code}</code></span>
          <span class="case-host">Hosted by ${escapeHtml(room.hostLabel)}</span>
          <span class="case-status ${statusClass(room.status)}">${statusLabel(room.status)}</span>
          <span class="case-players">${room.players} online</span>
        </p>
      </div>
      <a href="/rooms/${room.code}" class="case-join">Join case</a>
    `;
  }

  function updateEmptyNotice() {
    if (emptyNotice) emptyNotice.hidden = list.children.length > 0;
  }

  // One upsert path for both "a new room appeared" and "an existing room's
  // card changed" (status flipped to in-progress, host transferred) — the
  // server sends the same "lobby-update" event and payload shape for both,
  // so the client doesn't need to know which case it is.
  function upsertRoom(room) {
    const existing = list.querySelector(`li[data-code="${room.code}"]`);
    if (existing) {
      existing.innerHTML = cardHtml(room);
      return;
    }
    const li = document.createElement("li");
    li.className = "case-card";
    li.dataset.code = room.code;
    li.innerHTML = cardHtml(room);
    list.prepend(li);
    updateEmptyNotice();
  }

  function removeRoom(code) {
    const existing = list.querySelector(`li[data-code="${code}"]`);
    if (existing) existing.remove();
    updateEmptyNotice();
  }

  // Replaces the entire rendered list with the server's authoritative
  // current state — sent on every connect AND every reconnect. This is the
  // fix for a real, reproduced bug: a room created in the gap between this
  // page's server-rendered HTML and this script's EventSource actually
  // opening (or during any reconnect, e.g. after Fly's auto-stop/start cycle
  // drops the connection) used to never arrive, because the only thing ever
  // sent was "here's the one room that just changed" — nothing resent
  // anything already missed. A full reconcile on every (re)connect means no
  // single missed event can leave the list stale forever.
  function applySnapshot(rooms) {
    list.innerHTML = "";
    for (const room of rooms) {
      const li = document.createElement("li");
      li.className = "case-card";
      li.dataset.code = room.code;
      li.innerHTML = cardHtml(room);
      list.appendChild(li);
    }
    updateEmptyNotice();
  }

  let source = null;

  function connect() {
    if (source) return;
    source = new EventSource("/lobby/stream");
    source.addEventListener("snapshot", (event) => {
      applySnapshot(JSON.parse(event.data));
    });
    source.addEventListener("lobby-update", (event) => {
      upsertRoom(JSON.parse(event.data));
    });
    source.addEventListener("lobby-remove", (event) => {
      removeRoom(JSON.parse(event.data).code);
    });
  }

  function disconnect() {
    if (!source) return;
    source.close();
    source = null;
  }

  connect();

  // See client.js's pagehide/pageshow listeners — same reasoning: closing on
  // pagehide tells the server immediately a tab is gone, and restoring from
  // the back/forward cache (pageshow with persisted=true) doesn't re-run this
  // whole script, so without reconnecting here the page would be left
  // holding a closed, dead EventSource and silently stop updating.
  window.addEventListener("pagehide", disconnect);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) connect();
  });
})();
