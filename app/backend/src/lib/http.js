// Utilidades mínimas de servidor HTTP: router, parseo de body y respuestas JSON.
// Escrito sin dependencias externas (sin Express).

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const MAX = 5 * 1024 * 1024; // 5MB
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        reject(new HttpError(413, 'Cuerpo de solicitud demasiado grande'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new HttpError(400, 'JSON inválido en el cuerpo de la solicitud'));
      }
    });
    req.on('error', reject);
  });
}

// Router simple basado en patrones tipo /productos/:id
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, ...handlers) {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern
          .split('/')
          .map((seg) => {
            if (seg.startsWith(':')) {
              keys.push(seg.slice(1));
              return '([^/]+)';
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('/') +
        '/?$'
    );
    this.routes.push({ method, regex, keys, handlers });
  }

  get(pattern, ...h) { this.add('GET', pattern, ...h); }
  post(pattern, ...h) { this.add('POST', pattern, ...h); }
  put(pattern, ...h) { this.add('PUT', pattern, ...h); }
  patch(pattern, ...h) { this.add('PATCH', pattern, ...h); }
  delete(pattern, ...h) { this.add('DELETE', pattern, ...h); }

  // Combina otro router bajo un prefijo
  use(prefix, otherRouter) {
    for (const r of otherRouter.routes) {
      const combinedSource = prefix.replace(/\/$/, '') + r.regex.source.slice(1);
      this.routes.push({ ...r, regex: new RegExp(combinedSource) });
    }
  }

  async handle(req, res, pathname) {
    const method = req.method;
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.regex.exec(pathname);
      if (!match) continue;
      const params = {};
      route.keys.forEach((key, i) => { params[key] = decodeURIComponent(match[i + 1]); });
      req.params = params;
      try {
        for (const handler of route.handlers) {
          let done = false;
          await handler(req, res, () => { done = true; });
          if (res.writableEnded) return true;
          if (!done) break;
        }
        return true;
      } catch (err) {
        if (err instanceof HttpError) {
          sendJson(res, err.status, { error: err.message });
        } else {
          console.error(err);
          sendJson(res, 500, { error: 'Error interno del servidor' });
        }
        return true;
      }
    }
    return false;
  }
}
