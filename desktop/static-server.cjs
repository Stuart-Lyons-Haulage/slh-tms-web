const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function sendFile(filePath, request, response) {
  const stat = fs.statSync(filePath);
  response.statusCode = 200;
  response.setHeader("Content-Type", contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream");
  response.setHeader("Content-Length", stat.size);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  fs.createReadStream(filePath).pipe(response);
}

function resolveRequestFile(rootDir, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl || "/", "http://localhost").pathname);
  } catch {
    return { status: 400 };
  }

  const root = path.resolve(rootDir);
  const candidate = path.resolve(root, `.${pathname}`);
  const insideRoot = candidate === root || candidate.startsWith(`${root}${path.sep}`);
  if (!insideRoot) return { status: 403 };

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return { status: 200, filePath: candidate };
  }

  if (path.extname(pathname)) return { status: 404 };

  const indexPath = path.join(root, "index.html");
  return fs.existsSync(indexPath) ? { status: 200, filePath: indexPath } : { status: 404 };
}

function startStaticServer(rootDir, options = {}) {
  const host = options.host || "127.0.0.1";
  const port = options.port ?? 5173;

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.statusCode = 405;
        response.setHeader("Allow", "GET, HEAD");
        response.end();
        return;
      }

      const resolved = resolveRequestFile(rootDir, request.url);
      if (resolved.status !== 200 || !resolved.filePath) {
        response.statusCode = resolved.status;
        response.end();
        return;
      }

      try {
        sendFile(resolved.filePath, request, response);
      } catch {
        if (!response.headersSent) response.statusCode = 500;
        response.end();
      }
    });

    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({ server, origin: `http://localhost:${actualPort}` });
    });
  });
}

module.exports = { startStaticServer };
