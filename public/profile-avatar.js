// Progressive enhancement only: both forms on this page already work as
// plain POSTs with zero script. This adds three small things once JS is
// available: an English status line for the file-input choice (same
// reasoning as public/create-case.js's cover chooser — the native
// <input type="file"> text follows the browser's locale, not this site's),
// a live round preview of the chosen file before it's actually uploaded,
// and carrying whatever's currently typed into the nickname/bio form over
// to the avatar-upload form's hidden draft fields right before that form
// submits — so an in-progress, unsaved edit there isn't visually lost
// across the redirect an avatar upload/rejection causes (routes/profile.ts's
// draftParams()). Nothing here is saved to the server by this script;
// the draft fields are read-and-redisplayed only, same as any other
// server-rendered value.
(() => {
  const input = document.getElementById("avatarFile");
  const status = document.getElementById("avatar-status");
  const preview = document.getElementById("avatar-preview");
  const avatarForm = document.getElementById("avatar-upload-form");
  const nicknameInput = document.getElementById("nickname");
  const bioInput = document.getElementById("bio");
  const draftNickname = document.getElementById("draft-nickname");
  const draftBio = document.getElementById("draft-bio");

  if (input && status) {
    let objectUrl = null;
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) {
        status.textContent = "No image selected";
        return;
      }
      status.textContent = file.name;
      if (preview) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(file);
        preview.src = objectUrl;
      }
    });
  }

  if (avatarForm && draftNickname && draftBio) {
    avatarForm.addEventListener("submit", () => {
      draftNickname.value = nicknameInput ? nicknameInput.value : "";
      draftBio.value = bioInput ? bioInput.value : "";
    });
  }
})();
