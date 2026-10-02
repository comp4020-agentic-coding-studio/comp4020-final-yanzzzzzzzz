export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/">海龟汤协作解谜室</a>
    <a href="/readme/">关于</a>
  </header>
  <main>
${body}
  </main>
</body>
</html>`;
}
