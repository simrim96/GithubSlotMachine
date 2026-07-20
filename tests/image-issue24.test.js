// Test per ISSUE-24: /api/image fallback GitHub non gestisce content assente.
//
// Se `r.ok` è true ma `data.content` è undefined/null (repo esistente ma
// slot.svg vuoto o risposta inattesa), il vecchio codice chiamava
// `Buffer.from(undefined, 'base64')` → eccezione non gestita.
// Ora deve servire un errorSVG con status 200 invece di crashare.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Evita l'invio di eventi Sentry reali durante i test.
vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
}));

// Niente Redis in test: forza il ramo GitHub.
vi.mock('../api/_lib/kv.js', () => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  kvEnabled: false,
}));

function makeResponse(ok, status, body) {
  return {
    ok,
    status,
    headers: {
      get: () => null,
    },
    json: async () => body,
  };
}

describe('ISSUE-24 · /api/image fallback con content assente', () => {
  let realFetch;
  beforeEach(() => {
    realFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.GITHUB_PAT;
  });

  it('content undefined → non crasha, serve errorSVG (200)', async () => {
    global.fetch = vi.fn(async () =>
      makeResponse(true, 200, { sha: 'abc', content: undefined })
    );
    const handler = (await import('../api/image.js')).default;
    const res = {
      statusCode: null,
      body: null,
      setHeader: vi.fn(),
      status(c) {
        this.statusCode = c;
        return this;
      },
      send(b) {
        this.body = b;
        return this;
      },
    };
    process.env.GITHUB_PAT = 'tok-24';
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('Slot image unavailable');
  });

  it('content null → non crasha, serve errorSVG (200)', async () => {
    global.fetch = vi.fn(async () =>
      makeResponse(true, 200, { sha: 'abc', content: null })
    );
    const handler = (await import('../api/image.js')).default;
    const res = {
      statusCode: null,
      body: null,
      setHeader: vi.fn(),
      status(c) {
        this.statusCode = c;
        return this;
      },
      send(b) {
        this.body = b;
        return this;
      },
    };
    process.env.GITHUB_PAT = 'tok-24';
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<svg');
  });

  it('body vuoto (nessun content) → non crasha, serve errorSVG (200)', async () => {
    global.fetch = vi.fn(async () => makeResponse(true, 200, {}));
    const handler = (await import('../api/image.js')).default;
    const res = {
      statusCode: null,
      body: null,
      setHeader: vi.fn(),
      status(c) {
        this.statusCode = c;
        return this;
      },
      send(b) {
        this.body = b;
        return this;
      },
    };
    process.env.GITHUB_PAT = 'tok-24';
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<svg');
  });

  it('content presente → serve l’SVG decodificato normalmente', async () => {
    const svg = '<svg id="slot"></svg>';
    global.fetch = vi.fn(async () =>
      makeResponse(true, 200, {
        content: Buffer.from(svg).toString('base64'),
        sha: 'abc',
      })
    );
    const handler = (await import('../api/image.js')).default;
    const res = {
      statusCode: null,
      body: null,
      setHeader: vi.fn(),
      status(c) {
        this.statusCode = c;
        return this;
      },
      send(b) {
        this.body = b;
        return this;
      },
    };
    process.env.GITHUB_PAT = 'tok-24';
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(svg);
  });
});

describe('B4 · /api/image errore GitHub (!r.ok) non torna 404 in chiaro', () => {
  let realFetch;
  beforeEach(() => {
    realFetch = global.fetch;
    vi.clearAllMocks();
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.GITHUB_PAT;
  });

  it('404 GitHub → 200 con SVG di degrado + Content-Type image/svg+xml + Sentry', async () => {
    global.fetch = vi.fn(async () =>
      makeResponse(false, 404, { message: 'Not Found' })
    );
    const { default: handler } = await import('../api/image.js');
    const Sentry = await import('@sentry/node');
    const res = {
      statusCode: null,
      body: null,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      status(c) {
        this.statusCode = c;
        return this;
      },
      send(b) {
        this.body = b;
        return this;
      },
    };
    process.env.GITHUB_PAT = 'tok-24';
    await handler({ method: 'GET', query: {} }, res);

    // Niente più 404 in chiaro: degradazione graceful a 200.
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('Slot image unavailable');
    // Content-Type esplicito (ISSUE-B4).
    expect(res.headers['Content-Type']).toBe('image/svg+xml');
    // L'errore finisce in Sentry (ISSUE-B4).
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('500 GitHub → 200 con SVG di degrado + Sentry (nessun crash)', async () => {
    global.fetch = vi.fn(async () =>
      makeResponse(false, 500, { message: 'Internal Server Error' })
    );
    const { default: handler } = await import('../api/image.js');
    const Sentry = await import('@sentry/node');
    const res = {
      statusCode: null,
      body: null,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      status(c) {
        this.statusCode = c;
        return this;
      },
      send(b) {
        this.body = b;
        return this;
      },
    };
    process.env.GITHUB_PAT = 'tok-24';
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<svg');
    expect(res.headers['Content-Type']).toBe('image/svg+xml');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
