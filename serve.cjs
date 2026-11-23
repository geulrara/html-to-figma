const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const pages = new Set(['ui.html', 'preview.html']);
const styles = new Set(['common.css', 'ui.css', 'preview.css']);
const logoPath = 'img/logo.svg';
const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };
const clients = new Set();
const session = randomUUID();
let revision = 0;
let reloadTimer;

const reloadScript = `
  (() => {
    if (self !== top) return;
    const loadedVersion = document.currentScript.dataset.version;
    const events = new EventSource('/__reload');
    events.addEventListener('message', event => {
      if (event.data === loadedVersion) return;
      events.close();
      location.reload();
    });
  })();
`;

const version = () => session + ':' + revision;
const reloadEvent = () => 'data: ' + version() + '\n\n';

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    revision++;
    for (const client of clients) client.write(reloadEvent());
  }, 100);
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const pathname = request.url.split('?')[0];
  if (pathname === '/__reload' && request.method === 'GET') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    clients.add(response);
    response.on('close', () => clients.delete(response));
    response.write('retry: 1000\n' + reloadEvent());
    return;
  }

  const file = pathname === '/' ? 'ui.html' : pathname.slice(1);
  const isPage = pages.has(file);
  const isStyle = file.startsWith('css/') && styles.has(file.slice(4));
  if (!isPage && !isStyle && file !== logoPath) {
    response.writeHead(404).end();
    return;
  }

  // 읽기 도중 저장이 발생하면 페이지가 연결되는 즉시 최신 버전으로 갱신합니다.
  const loadedVersion = version();
  let content;
  try {
    content = await fs.promises.readFile(path.join(__dirname, file), 'utf8');
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    return;
  }

  if (isPage) {
    const script = '<script data-version="' + loadedVersion + '">' + reloadScript + '</script>';
    content = content.replace(/<\/body>(?=\s*<\/html>\s*$)/i, () => script + '\n</body>');
  }

  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(file)] + '; charset=utf-8',
    'Content-Length': Buffer.byteLength(content),
    'Cache-Control': 'no-store',
  });
  response.end(request.method === 'HEAD' ? undefined : content);
});

server.on('error', error => {
  console.error(error.message);
  process.exitCode = 1;
});

server.listen(5000, '127.0.0.1', () => {
  fs.watch(__dirname, (_, file) => {
    if (!file || pages.has(file)) scheduleReload();
  });
  fs.watch(path.join(__dirname, 'css'), (_, file) => {
    if (!file || styles.has(file)) scheduleReload();
  });
  fs.watch(path.join(__dirname, 'img'), (_, file) => {
    if (!file || file === 'logo.svg') scheduleReload();
  });
  console.log('http://127.0.0.1:5000/ui.html');
  console.log('http://127.0.0.1:5000/preview.html');
});
