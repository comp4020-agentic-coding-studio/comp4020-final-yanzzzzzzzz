import type { Profile } from "../db.ts";
import { escapeHtml } from "./html.ts";

function identityLink(profile?: Profile): string {
  if (!profile?.nickname) {
    return `<a href="/profile" class="profile-link">Set a nickname</a>`;
  }
  const avatar = profile.avatar ? `${escapeHtml(profile.avatar)} ` : "";
  return `<a href="/profile" class="profile-link">${avatar}${escapeHtml(profile.nickname)}</a>`;
}

export function layout(title: string, body: string, profile?: Profile): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/">Turtle Soup Puzzle Room</a>
    <nav class="site-nav">
      <a href="/about">About</a>
      ${identityLink(profile)}
    </nav>
  </header>
  <main>
${body}
  </main>
</body>
</html>`;
}
