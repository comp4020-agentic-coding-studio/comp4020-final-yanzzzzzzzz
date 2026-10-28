// Progressive enhancement only: both modes already work as plain forms with
// no JS — a case is either the one the server preselected via ?puzzleId= (or
// the sealed "Surprise me" state), or whatever's typed into the author
// fields, and submitting works with zero script. This only adds a live
// cover/title/premise swap on the preview panel when the <select> changes,
// and a cosmetic submit-label swap in author mode — neither is load-bearing.
(() => {
  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  const select = document.getElementById("puzzleId");
  const leftPage = document.getElementById("case-file-preview");
  const dataEl = document.getElementById("puzzle-data");
  if (select && leftPage && dataEl) {
    const puzzles = JSON.parse(dataEl.textContent);

    function sealedHtml() {
      return `
        <div class="case-file-cover case-file-cover-sealed" aria-hidden="true">
          <span class="case-file-seal">?</span>
        </div>
        <p class="case-file-source">Sealed case</p>
        <h2 class="case-file-title">Let fate choose your mystery</h2>
        <p class="case-file-premise">
          A random case is assigned the moment you create the room — nobody,
          including you, knows which one until the file opens.
        </p>
      `;
    }

    function puzzleHtml(puzzle) {
      const by = puzzle.authorLabel ? `Player-created, by ${escapeHtml(puzzle.authorLabel)}` : "Official case";
      return `
        <div class="case-file-cover">
          <img src="${escapeHtml(puzzle.coverUrl)}" alt="" width="800" height="500" decoding="async" />
        </div>
        <p class="case-file-source">${escapeHtml(by)}</p>
        <h2 class="case-file-title">${escapeHtml(puzzle.title)}</h2>
        <p class="case-file-premise">${escapeHtml(puzzle.premise)}</p>
      `;
    }

    // One short fade on the preview panel's contents when the selection
    // changes — not the full ~450ms page-opening entrance (that only plays
    // once, on first load, via the .case-file-panel animation in CSS), and
    // off entirely under prefers-reduced-motion via the same CSS rule that
    // already guards every other animation on this page.
    select.addEventListener("change", () => {
      const puzzle = puzzles.find((p) => p.id === select.value);
      leftPage.classList.remove("case-file-preview-swap");
      // Force reflow so re-adding the class restarts the animation even if
      // the select is changed twice in a row before the first fade finishes.
      void leftPage.offsetWidth;
      leftPage.innerHTML = puzzle ? puzzleHtml(puzzle) : sealedHtml();
      leftPage.classList.add("case-file-preview-swap");
    });
  }

  const shared = document.getElementById("shared");
  const submit = document.getElementById("create-submit");
  if (shared && submit) {
    const sync = () => {
      submit.textContent = shared.checked ? "Publish case and create room" : "Create investigation room";
    };
    shared.addEventListener("change", sync);
    sync();
  }

  // Cover-upload preview: a local object URL, never uploaded anywhere until
  // the real form submit — this only reads the File the browser already
  // holds in the <input>'s own FileList, the same bytes that submit as
  // multipart form data. Revoking the previous object URL before creating a
  // new one (and on remove) avoids leaking one per file choice.
  const coverInput = document.getElementById("cover");
  const coverPreview = document.getElementById("cover-preview");
  const coverRemove = document.getElementById("cover-remove");
  if (coverInput && coverPreview && coverRemove) {
    let objectUrl = null;

    function showGlyph() {
      coverPreview.classList.add("case-file-cover-author");
      coverPreview.innerHTML = `<span class="case-file-seal">✎</span>`;
      coverRemove.hidden = true;
    }

    function showPreview(file) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(file);
      coverPreview.classList.remove("case-file-cover-author");
      coverPreview.innerHTML = `<img src="${objectUrl}" alt="" width="800" height="500" />`;
      coverRemove.hidden = false;
    }

    coverInput.addEventListener("change", () => {
      const file = coverInput.files && coverInput.files[0];
      if (file) showPreview(file);
      else showGlyph();
    });

    coverRemove.addEventListener("click", () => {
      coverInput.value = "";
      showGlyph();
      coverInput.focus();
    });
  }
})();
