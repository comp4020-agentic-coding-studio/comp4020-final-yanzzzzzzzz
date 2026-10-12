// Progressive enhancement only: both modes already work as plain forms with
// no JS (pick a puzzle and submit, or fill in the fields and submit). This
// adds a puzzle preview on selection, and a cosmetic submit-label swap —
// neither is load-bearing.
(() => {
  const select = document.getElementById("puzzleId");
  const preview = document.getElementById("puzzle-preview");
  const dataEl = document.getElementById("puzzle-data");
  if (select && preview && dataEl) {
    const puzzles = JSON.parse(dataEl.textContent);
    select.addEventListener("change", () => {
      const puzzle = puzzles.find((p) => p.id === select.value);
      if (!puzzle) {
        preview.hidden = true;
        return;
      }
      preview.textContent = puzzle.premise;
      preview.hidden = false;
    });
  }

  const shared = document.getElementById("shared");
  const submit = document.getElementById("create-submit");
  if (shared && submit) {
    const sync = () => {
      submit.textContent = shared.checked ? "Publish puzzle and create room" : "Create room";
    };
    shared.addEventListener("change", sync);
    sync();
  }
})();
