export function layout(title: string, body: string): string {
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
    <a href="/readme/">About</a>
  </header>
  <main>
${body}
  </main>
</body>
</html>`;
}
