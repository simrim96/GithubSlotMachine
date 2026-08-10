// Server di sviluppo minimalista
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 3000;

// Importare gli handler
const leverHandler = (await import('../api/lever.js')).default;
const imageHandler = (await import('../api/image.js')).default;
const spinHandler = (await import('../api/spin.js')).default;

// Helper per gestire le risposte
function sendRes(res, statusCode, headers, body) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  console.log(`[DEV] ${req.method} ${pathname}`);

  try {
    if (pathname === '/api/lever') {
      const mockReq = { method: req.method, headers: req.headers };
      const mockRes = {
        _headers: {},
        _status: 200,
        _body: '',
        setHeader(k, v) {
          this._headers[k] = v;
        },
        status(c) {
          this._status = c;
          return this;
        },
        send(body) {
          this._body = body || '';
          this.end();
        },
        sendResponse(r) {
          if (r.status) this.status(r.status);
          if (r.headers)
            Object.entries(r.headers).forEach(([k, v]) => this.setHeader(k, v));
          if (r.body) this._body = r.body;
          this.end();
        },
        end() {
          if (!res.headersSent) {
            res.writeHead(this._status, this._headers);
            res.end(this._body || '');
          }
        },
      };

      await leverHandler(mockReq, mockRes);
      return;
    }

    if (pathname === '/api/image') {
      const mockReq = {
        method: req.method,
        headers: req.headers,
        query: Object.fromEntries(url.searchParams),
      };
      const mockRes = {
        _headers: {},
        _status: 200,
        _body: '',
        setHeader(k, v) {
          this._headers[k] = v;
        },
        end() {
          if (!res.headersSent) {
            res.writeHead(this._status, this._headers);
            res.end(this._body || '');
          }
        },
      };

      await imageHandler(mockReq, mockRes);
      return;
    }

    if (pathname === '/api/ratelimit-status') {
      const ratelimitHandler = (await import('../api/ratelimit-status.js'))
        .default;
      const origin = req.headers?.['origin'] || req.headers?.['Origin'] || null;
      const mockReq = {
        method: req.method,
        headers: { ...req.headers, origin },
      };

      // Supporta sia pattern (req, res) che pattern Response return
      const result = await ratelimitHandler(mockReq);

      if (result instanceof Response) {
        // Pattern Response - estrai status e headers
        res.writeHead(
          result.status,
          Object.fromEntries(result.headers.entries())
        );
        res.end(await result.text());
      } else {
        // Pattern (req, res) - usa il mock esistente
        const mockRes = {
          _headers: {},
          _status: 200,
          _body: '',
          setHeader(k, v) {
            this._headers[k] = v;
          },
          status(c) {
            this._status = c;
            return this;
          },
          json(d) {
            this.setHeader('Content-Type', 'application/json');
            this._body = JSON.stringify(d);
            this.end();
          },
          end() {
            if (!res.headersSent) {
              res.writeHead(this._status, this._headers);
              res.end(this._body || '');
            }
          },
        };

        await ratelimitHandler(mockReq, mockRes);
      }
      return;
    }

    if (pathname === '/api/spin') {
      const mockReq = {
        method: req.method,
        headers: req.headers,
        query: Object.fromEntries(url.searchParams),
      };
      const mockRes = {
        _headers: {},
        _status: 200,
        _redirect: null,
        setHeader(k, v) {
          this._headers[k] = v;
        },
        status(c) {
          this._status = c;
          return this;
        },
        redirect(url) {
          this._redirect = url;
          this.setHeader('Location', url);
          this.setHeader('Cache-Control', 'no-store');
          if (!res.headersSent) {
            res.writeHead(302, this._headers);
            res.end();
          }
        },
        json(d) {
          this.setHeader('Content-Type', 'application/json');
          this.end();
        },
        end() {
          if (!res.headersSent && !this._redirect) {
            res.writeHead(this._status, this._headers);
            res.end();
          }
        },
      };

      await spinHandler(mockReq, mockRes);
      return;
    }

    // Serve static files
    let filePath = join(
      ROOT,
      'public',
      pathname === '/' ? 'index.html' : pathname
    );
    const data = await readFile(filePath);
    const ext = pathname.split('.').pop();
    const mime =
      {
        html: 'text/html',
        js: 'application/javascript',
        css: 'text/css',
        svg: 'image/svg+xml',
        png: 'image/png',
      }[ext] || 'application/octet-stream';

    sendRes(res, 200, { 'Content-Type': mime }, data);
  } catch (err) {
    console.error('[ERROR]', pathname, err.message);
    sendRes(
      res,
      500,
      { 'Content-Type': 'text/plain' },
      'Error: ' + err.message
    );
  }
});

server.listen(PORT, () => {
  console.log(`\n🎰 Dev server su http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET /           - index.html');
  console.log('  GET /api/lever  - lever SVG');
  console.log('  GET /api/image  - slot SVG');
  console.log('  POST /api/spin  - spin slot');
  console.log('\nPremi Ctrl+C per fermare\n');
});
