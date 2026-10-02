// A small, deliberately partial Markdown renderer: just enough of the ATX
// subset (headings, paragraphs, fenced code, lists, links, emphasis) to
// render this repo's own README.md and PROCESS.md readably. No client JS
// runs for this — spec/invariants.test.ts reads the server-rendered HTML
// directly, and a missing/renamed heading fails it.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return out;
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  let inList = false;

  const closeList = (): void => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^ {0,3}(```|~~~)/);
    if (fence) {
      closeList();
      const close = fence[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(close)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.*?)(\s+#+)?\s*$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    const item = line.match(/^ {0,3}[-*+]\s+(.*)$/);
    if (item) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(item[1])}</li>`);
      i++;
      continue;
    }

    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    closeList();
    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].match(/^ {0,3}#{1,6}\s/)) {
      paragraph.push(lines[i]);
      i++;
    }
    html.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  closeList();
  return html.join("\n");
}
