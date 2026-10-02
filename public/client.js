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

  const VERDICT_LABEL = { yes: "是", no: "否", irrelevant: "无关", correct: "✓ 正确！" };

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
      const verdictLabel = entry.verdict ? VERDICT_LABEL[entry.verdict] ?? entry.verdict : "……";
      li.innerHTML = `
        <p class="entry-question"><span class="entry-label">${escapeHtml(entry.label ?? "匿名侦探")}</span> 问：${escapeHtml(entry.body)}</p>
        <p class="entry-verdict">AI 裁判：<strong>${escapeHtml(verdictLabel)}</strong></p>
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

  const lastId = section.dataset.lastId ? Number(section.dataset.lastId) : 0;
  const source = new EventSource(`/rooms/${roomCode}/stream?after=${lastId}`);
  source.onmessage = (event) => {
    if (!event.data) return; // heartbeat
    appendEntry(JSON.parse(event.data));
  };

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
    button.textContent = "AI 裁判思考中…";

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
      button.textContent = "网络似乎不太好，请重试";
      setTimeout(() => {
        button.textContent = originalLabel;
      }, 2000);
    } finally {
      button.disabled = false;
      if (button.textContent === "AI 裁判思考中…") button.textContent = originalLabel;
      input.focus();
    }
  });
})();
