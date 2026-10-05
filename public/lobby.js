// Progressive enhancement only: the lobby list is already server-rendered
// with whatever rooms were open on load. This adds live updates (SSE) so a
// room created by someone else appears without a manual refresh.
(() => {
  const list = document.getElementById("lobby-list");
  if (!list) return;

  const emptyNotice = document.querySelector(".lobby-empty");
  const seen = new Set([...list.querySelectorAll("li[data-code]")].map((li) => li.dataset.code));

  function addRoom(code) {
    if (seen.has(code)) return;
    seen.add(code);
    if (emptyNotice) emptyNotice.hidden = true;
    const li = document.createElement("li");
    li.dataset.code = code;
    li.innerHTML = `<a href="/rooms/${code}">Join case ${code}</a>`;
    list.prepend(li);
  }

  const source = new EventSource("/lobby/stream");
  source.onmessage = (event) => {
    if (!event.data) return; // heartbeat
    addRoom(JSON.parse(event.data).code);
  };

  // See client.js's pagehide listener — same reasoning, so a room's lobby
  // connection doesn't linger past the point the visitor actually left.
  window.addEventListener("pagehide", () => source.close());
})();
