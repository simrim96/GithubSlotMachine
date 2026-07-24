// Server di sviluppo completo per testare localmente la slot machine
// Serve tutti gli endpoint necessari inclusi /api/lever

import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);

// Carichiamo i handler dynamically
let spinHandler, leverHandler, imageHandler;

async function loadHandlers() {
  try {
    const spinModule = await import('../api/spin.js');
    spinHandler = spinModule.default;
  } catch (e) {
    console.error('Errore caricamento spin handler:', e.message);
  }
  
  try {
    const leverModule = await import('../api/lever.js');
    leverHandler = leverModule.default;
  } catch (e) {
    console.error('Errore caricamento lever handler:', e.message);
  }
  
  try {
    const imageModule = await import('../api/image.js');
    imageHandler = imageModule.default;
  } catch (e) {
    console.error('Errore caricamento image handler:', e.message);
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;
    
    console.log(`[DEV] ${req.method} ${pathname}`);
    
    // Handler API
    if (pathname === '/api/spin') {
      if (spinHandler) {
        // Mock request/response per sviluppo
        const mockReq = {
          method: req.method,
          query: Object.fromEntries(url.searchParams),
          headers: req.headers
        };
        const mockRes = {
          _headers: {},
          _status: 200,
          _body: '',
          setHeader(key, value) { this._headers[key] = value; },
          setStatus(code) { this._status = code; },
          end(body) {
            this._body = body || '';
            res.writeHead(this._status, this._headers);
            res.end(this._body);
          },
          json(data) {
            this.setHeader('Content-Type', 'application/json');
            this.end(JSON.stringify(data));
          }
        };
        
        // Gestione redirect
        const redirectHandler = async () => {
          return new Promise((resolve) => {
            const redirectRes = {
              _headers: {},
              _status: 200,
              _redirect: null,
              setHeader(key, value) { this._headers[key] = value; },
              status(code) {
                this._status = code;
                return this;
              },
              redirect(url) {
                this._redirect = url;
                this.setHeader('Location', url);
                this.setHeader('Cache-Control', 'no-store');
                this.end();
              },
              json(data) {
                this.setHeader('Content-Type', 'application/json');
                this.end(JSON.stringify(data));
              },
              send(body) {
                if (typeof body === 'string') {
                  this._body = body;
                }
                this.end();
              },
              end(body) {
                this._body = body || '';
                res.writeHead(this._status, this._headers);
                res.end(this._body);
              }
            };
            
            spinHandler(mockReq, redirectRes).then(() => {
              if (redirectRes._redirect) {
                res.writeHead(302, { Location: redirectRes._redirect });
                res.end();
              } else {
                res.writeHead(redirectRes._status, redirectRes._headers);
                res.end(redirectRes._body);
              }
            }).catch(err => {
              console.error('Spin handler error:', err);
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Error: ' + err.message);
            });
          });
        };
        
        await redirectHandler();
        return;
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Spin handler non disponibile');
        return;
      }
    }
    
    if (pathname === '/api/lever') {
      if (leverHandler) {
        const mockReq = {
          method: req.method,
          headers: req.headers
        };
        const mockRes = {
          _headers: {},
          _status: 200,
          _body: '',
          setHeader(key, value) { this._headers[key] = value; },
          status(code) {
            this._status = code;
            return this;
          },
          send(body) {
            if (typeof body === 'string') {
              this._body = body;
            }
            this.end();
          },
          sendResponse(response) {
            if (response.status) this.status(response.status);
            if (response.headers) {
              Object.entries(response.headers).forEach(([k, v]) => this.setHeader(k, v));
            }
            if (response.body) this._body = response.body;
            this.end(); // Chiamare end() automaticamente
          },
          end(body) {
            this._body = body || this._body || '';
            if (!res.headersSent) {
              res.writeHead(this._status, this._headers);
              res.end(this._body);
            }
          }
        };
        
        try {
          await leverHandler(mockReq, mockRes);
          if (!res.headersSent) {
            res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
            res.end('');
          }
        } catch (err) {
          console.error('Lever handler error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error: ' + err.message);
          }
        }
        return;
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Lever handler non disponibile');
        return;
      }
    }
    
    if (pathname === '/api/image') {
      if (imageHandler) {
        const mockReq = {
          method: req.method,
          query: Object.fromEntries(url.searchParams),
          headers: req.headers
        };
        const mockRes = {
          _headers: {},
          _status: 200,
          _body: '',
          setHeader(key, value) { this._headers[key] = value; },
          end(body) {
            this._body = body || '';
            res.writeHead(this._status, this._headers);
            res.end(this._body);
          }
        };
        
        await imageHandler(mockReq, mockRes);
        res.writeHead(mockRes._status, mockRes._headers);
        res.end(mockRes._body);
        return;
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Image handler non disponibile');
        return;
      }
    }
    
    // Servizi file statici
    let filePath = join(ROOT, 'public', pathname === '/' ? 'index.html' : pathname);
    
    // Prevenire directory traversal
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    
    try {
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found: ' + pathname);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error: ' + err.message);
      }
    }
  } catch (err) {
    console.error('[DEV ERROR]', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error: ' + err.message);
  }
});

// Carica gli handler all'avvio
await loadHandlers();

server.listen(PORT, () => {
  console.log(`\n🎰 Dev server avviato su http://localhost:${PORT}`);
  console.log(`\nEndpoints disponibili:`);
  console.log(`  - http://localhost:${PORT}/                    (index.html)`);
  console.log(`  - http://localhost:${PORT}/api/spin            (spin handler)`);
  console.log(`  - http://localhost:${PORT}/api/image           (slot SVG)`);
  console.log(`  - http://localhost:${PORT}/api/lever           (lever SVG)`);
  console.log(`  - http://localhost:${PORT}/api/ratelimit-status (rate limit status)`);
  console.log(`\nPremi Ctrl+C per fermare il server\n`);
});
