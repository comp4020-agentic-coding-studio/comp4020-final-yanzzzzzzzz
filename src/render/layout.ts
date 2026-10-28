import type { Profile } from "../db.ts";
import { escapeHtml } from "./html.ts";
import { asset } from "./asset.ts";

function identityLink(profile?: Profile): string {
  if (!profile?.nickname) {
    return `<a href="/profile" class="profile-link">Set a nickname</a>`;
  }
  const avatar = profile.avatar ? `${escapeHtml(profile.avatar)} ` : "";
  return `<a href="/profile" class="profile-link">${avatar}${escapeHtml(profile.nickname)}</a>`;
}

// One small original icon (a bowl with two rising steam curls), drawn as
// plain inline <path>s from scratch — not traced or copied from any
// reference site's artwork — colored from the same --accent/--fg variables
// every other component already uses, so it repaints in dark mode for free.
function brandIcon(): string {
  return `<svg class="brand-icon" viewBox="0 0 32 32" width="24" height="24" aria-hidden="true" focusable="false">
    <path d="M12 9 C 9 5, 14 4, 11 0" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" opacity="0.7" />
    <path d="M19 9 C 16 5, 21 4, 18 0" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" opacity="0.55" />
    <path d="M4 15 Q16 24 28 15 L26 21 Q16 27 6 21 Z" fill="var(--accent)" />
    <ellipse cx="16" cy="15" rx="12" ry="3" fill="none" stroke="var(--fg)" stroke-width="1.5" opacity="0.6" />
  </svg>`;
}

export type NavPath = "home" | "cases" | "community";

function navLink(href: string, label: string, current: NavPath | undefined, self: NavPath): string {
  const isActive = current === self;
  const currentAttr = isActive ? ` aria-current="page"` : "";
  const cls = isActive ? ` class="active"` : "";
  return `<a href="${href}"${cls}${currentAttr}>${label}</a>`;
}

export function layout(title: string, body: string, profile?: Profile, activePath?: NavPath): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="${asset("/styles.css")}" />
</head>
<body>
  <header class="site-header">
    <div class="site-header-left">
      <a class="brand" href="/">${brandIcon()}<span>Turtle Soup</span></a>
      <nav class="site-nav" aria-label="Main">
        ${navLink("/", "Home", activePath, "home")}
        ${navLink("/cases", "Case Library", activePath, "cases")}
        ${navLink("/community", "Community", activePath, "community")}
      </nav>
    </div>
    <div class="site-controls">
      <button type="button" id="music-toggle" class="music-toggle" aria-pressed="false">🔈 Music off</button>
      ${identityLink(profile)}
    </div>
  </header>
  <main>
${body}
  </main>
  <footer class="site-footer">
    <a href="/about">About</a>
    <a href="/readme/">Technical documentation</a>
    <a href="/about#music-credits">Music credits</a>
  </footer>
  <p id="music-status" class="music-status" role="status" aria-live="polite"></p>
  <audio id="bg-music" src="/audio/creepy-ambient.ogg" loop preload="none"></audio>
  <script src="${asset("/music.js")}"></script>
</body>
</html>`;
}
