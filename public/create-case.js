// Progressive enhancement only: both modes already work as plain forms with
// no JS — a case is either the one the server preselected via ?puzzleId= (or
// the sealed "Surprise me" state), or whatever's typed into the author
// fields, and submitting works with zero script. The .case-tabs links are
// real <a href> elements to the same route with a different ?mode=; the
// mode-switch behavior below enhances that into an instant in-place swap
// that preserves whatever's already been typed/chosen, instead of a full
// reload that would lose it — nothing here is load-bearing for creating a
// room, and every behavior degrades to the plain link/full reload it
// enhances if fetch() fails or the response doesn't look right.
//
// An earlier version of this file played a short flip/rotate animation
// during the mode switch (perspective + rotateY, swapped in mid-animation).
// Dropped entirely after a real-browser check: it read as broken rather
// than book-like, not a close call worth tuning further. The switch is now
// a synchronous DOM swap — no animation, no transition classes, no
// animationend listeners — kept deliberately simple rather than replaced
// with a different effect.
(() => {
  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  // ---------- Per-page behaviors, re-wired after every mode switch ----------
  // Each of these only ever queries WITHIN `root` (the mode-root element, or
  // document on first load) — after a switch swaps #case-file-mode-root's
  // innerHTML, the old elements these were bound to no longer exist, so
  // initPageBehaviors() re-runs all three against the freshly inserted DOM.

  function initPreviewSwap(root) {
    const select = root.querySelector("#puzzleId");
    const leftPage = root.querySelector("#case-file-preview");
    const dataEl = root.querySelector("#puzzle-data");
    if (!select || !leftPage || !dataEl) return;
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
    // changes — this is the picker's own live-preview swap (unrelated to
    // the mode-switch transition removed above), gated behind
    // prefers-reduced-motion like every other animation on this page.
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

  function initSharedCheckboxSync(root) {
    const shared = root.querySelector("#shared");
    const submit = root.querySelector("#create-submit");
    if (!shared || !submit) return;
    const sync = () => {
      submit.textContent = shared.checked ? "Publish case and create room" : "Create investigation room";
    };
    shared.addEventListener("change", sync);
    sync();
  }

  // The native <input type="file"> itself is kept fully functional (real
  // tab stop, real label association, real picker) — only its OWN rendered
  // chrome is hidden via CSS (.visually-hidden), because that chrome is the
  // one piece of this control the app can't own: Chrome/Firefox/Safari draw
  // "Choose File"/"No file chosen" (or their translations) in whatever
  // locale the browser itself is set to, not the page's language, so an
  // English-only site with a non-English browser showed Chinese text here
  // even though every other string on the page is English. #cover-status
  // below is a plain site-owned element updated via textContent (never
  // innerHTML) with the real filename, so it can't ever render as markup.
  // The OS-native picker DIALOG that opens on click is unaffected by any of
  // this — that part is genuinely outside the page's control and still
  // follows the browser/OS locale; the hint text under the control says so.
  function initCoverUploadPreview(root) {
    const coverInput = root.querySelector("#cover");
    const coverPreview = root.querySelector("#cover-preview");
    const coverRemove = root.querySelector("#cover-remove");
    const coverStatus = root.querySelector("#cover-status");
    if (!coverInput || !coverPreview || !coverRemove || !coverStatus) return;
    let objectUrl = null;

    function setStatus(text) {
      coverStatus.textContent = text;
    }

    function showGlyph() {
      coverPreview.classList.add("case-file-cover-author");
      coverPreview.innerHTML = `<span class="case-file-seal">✎</span>`;
      coverRemove.hidden = true;
      setStatus("No image selected");
    }

    function showPreview(file) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(file);
      coverPreview.classList.remove("case-file-cover-author");
      coverPreview.innerHTML = `<img src="${objectUrl}" alt="" width="800" height="500" />`;
      coverRemove.hidden = false;
      setStatus(file.name);
    }

    coverInput.addEventListener("change", () => {
      const file = coverInput.files && coverInput.files[0];
      if (file) showPreview(file);
      else showGlyph();
    });

    coverRemove.addEventListener("click", () => {
      coverInput.value = "";
      showGlyph();
      // The visible "Choose image" affordance is the <label>, but a <label>
      // isn't a focusable element by default — focus goes to the real
      // <input type="file"> it's bound to, which IS in the tab order
      // (visually hidden via CSS only, never removed from the a11y tree).
      coverInput.focus();
    });

    // A cover carried over from a draft (restoreDraft(), below) already has
    // a real file selected the moment this runs — show its preview
    // immediately rather than waiting for a change event that won't fire
    // again for a file that was already chosen before this mode switch.
    if (coverInput.files && coverInput.files[0]) showPreview(coverInput.files[0]);
    else setStatus("No image selected");
  }

  function initPageBehaviors(root) {
    initPreviewSwap(root);
    initSharedCheckboxSync(root);
    initCoverUploadPreview(root);
  }

  // ---------- Instant mode switching with draft preservation ----------
  // Intercepts the two .case-tabs links (same-origin, same route, only the
  // ?mode= query differs) and swaps #case-file-mode-root's content in place
  // synchronously, instead of a full page reload — so whatever's already
  // typed into the other mode's fields (and any cover file already chosen)
  // survives switching away and back. Falls back to a real navigation if
  // fetch() fails or the response doesn't contain the expected markup.

  const switchRoot = document.getElementById("case-file-mode-root");
  if (switchRoot) {
    // Neither mode's own draft is ever written to localStorage/sessionStorage/
    // the URL, or logged anywhere — plain in-memory variables for this one
    // page's lifetime, gone on refresh (acceptable per the brief: only a
    // same-page mode switch has to preserve a draft, not a reload).
    const drafts = { existing: null, author: null };
    let isSwitching = false;

    function currentMode() {
      return switchRoot.dataset.mode === "author" ? "author" : "existing";
    }

    function modeFromUrl(url) {
      return new URL(url, window.location.href).searchParams.get("mode") === "author"
        ? "author"
        : "existing";
    }

    function captureDraft(mode) {
      if (mode === "existing") {
        const select = switchRoot.querySelector("#puzzleId");
        const name = switchRoot.querySelector("#name");
        drafts.existing = {
          puzzleId: select ? select.value : "",
          name: name ? name.value : "",
        };
        return;
      }
      const title = switchRoot.querySelector("#title");
      const premise = switchRoot.querySelector("#premise");
      const solution = switchRoot.querySelector("#solution");
      const shared = switchRoot.querySelector("#shared");
      const name = switchRoot.querySelector("#name");
      const coverInput = switchRoot.querySelector("#cover");
      // The real <input type="file"> DOM NODE is detached and kept, not
      // just its value — a FileList can't be rebuilt from scratch without
      // the DataTransfer API, but the node itself (and the File it already
      // holds) survives being moved out of the DOM entirely intact.
      const hasFile = Boolean(coverInput && coverInput.files && coverInput.files.length);
      drafts.author = {
        title: title ? title.value : "",
        premise: premise ? premise.value : "",
        solution: solution ? solution.value : "",
        shared: Boolean(shared && shared.checked),
        name: name ? name.value : "",
        coverInput: hasFile ? coverInput : null,
      };
      if (hasFile) coverInput.remove();
    }

    function restoreDraft(mode) {
      if (mode === "existing") {
        const draft = drafts.existing;
        if (!draft) return;
        const select = switchRoot.querySelector("#puzzleId");
        const name = switchRoot.querySelector("#name");
        if (select && draft.puzzleId) {
          const hasOption = [...select.options].some((o) => o.value === draft.puzzleId);
          if (hasOption) {
            select.value = draft.puzzleId;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        if (name) name.value = draft.name;
        return;
      }
      const draft = drafts.author;
      if (!draft) return;
      const title = switchRoot.querySelector("#title");
      const premise = switchRoot.querySelector("#premise");
      const solution = switchRoot.querySelector("#solution");
      const shared = switchRoot.querySelector("#shared");
      const name = switchRoot.querySelector("#name");
      if (title) title.value = draft.title;
      if (premise) premise.value = draft.premise;
      if (solution) solution.value = draft.solution;
      if (name) name.value = draft.name;
      if (shared) {
        shared.checked = draft.shared;
        shared.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (draft.coverInput) {
        const freshInput = switchRoot.querySelector("#cover");
        if (freshInput) freshInput.replaceWith(draft.coverInput);
      }
    }

    function firstFocusable() {
      // `input[type=hidden]` matches the plain "input" selector but is
      // never actually focusable in a real browser — excluded explicitly
      // rather than relying on :not([hidden]) (the HTML `hidden` attribute
      // and the `hidden` form-input TYPE are two unrelated things; the
      // mode field below is the latter).
      const candidates = switchRoot.querySelectorAll(
        "input:not([type=hidden]), select, textarea, button:not([hidden]), a[href]",
      );
      for (const el of candidates) {
        if (el.closest(".case-tabs")) continue;
        if (el.hasAttribute("hidden") || el.disabled) continue;
        return el;
      }
      return null;
    }

    function wireTabs() {
      switchRoot.querySelectorAll(".case-tabs a").forEach((a) => {
        a.addEventListener("click", onTabClick);
      });
    }

    function onTabClick(event) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = event.currentTarget.getAttribute("href");
      if (!href) return;
      event.preventDefault();
      if (isSwitching) return; // ignore a click while a switch is already in flight
      if (modeFromUrl(href) === currentMode()) return; // already on this mode
      switchTo(href, true);
    }

    async function switchTo(url, push) {
      const targetMode = modeFromUrl(url);
      isSwitching = true;
      captureDraft(currentMode());

      let html;
      try {
        const res = await fetch(url, { headers: { Accept: "text/html" } });
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        html = await res.text();
      } catch {
        // Network failure, offline, or an unexpected response — fall back
        // to a real navigation rather than leaving the page stuck.
        window.location.href = url;
        return;
      }

      const parsed = new DOMParser().parseFromString(html, "text/html");
      const newRoot = parsed.getElementById("case-file-mode-root");
      if (!newRoot) {
        window.location.href = url;
        return;
      }

      if (push) history.pushState({ mode: targetMode }, "", url);

      switchRoot.innerHTML = newRoot.innerHTML;
      switchRoot.dataset.mode = newRoot.dataset.mode || targetMode;
      document.title = parsed.title;
      // initPageBehaviors() BEFORE restoreDraft(): restoring the picker
      // select / shared checkbox dispatches a "change" event to re-run the
      // preview swap / submit-label sync those draft values imply — the
      // listeners initPageBehaviors() binds have to already exist for that
      // dispatch to do anything. restoreDraft() then REPLACES the
      // freshly-parsed #cover node with the preserved one carrying an
      // actual chosen file (captureDraft() keeps the real node, not just
      // its value) — initCoverUploadPreview() is re-run specifically
      // afterward so the replaced node's own change/remove listeners get
      // bound and its already-chosen file's preview renders, since the
      // first initPageBehaviors() pass only ever saw the old node.
      initPageBehaviors(switchRoot);
      restoreDraft(targetMode);
      initCoverUploadPreview(switchRoot);
      wireTabs();
      const toFocus = firstFocusable();
      if (toFocus) toFocus.focus();
      isSwitching = false;
    }

    wireTabs();
    initPageBehaviors(switchRoot);
    history.replaceState({ mode: currentMode() }, "", window.location.href);

    // Back/forward restores the matching mode's content without ever
    // re-submitting a form — this only ever swaps displayed markup, the
    // same as a tab click, never calls .submit() on anything.
    window.addEventListener("popstate", (event) => {
      const mode =
        (event.state && event.state.mode) || modeFromUrl(window.location.href);
      if (mode === currentMode()) return;
      switchTo(`/rooms/new?mode=${mode}`, false);
    });
  } else {
    // No #case-file-mode-root (shouldn't happen on this page, but keeps
    // this script inert rather than throwing if the markup ever changes) —
    // still wire up the cosmetic behaviors against the whole document.
    initPageBehaviors(document);
  }
})();
