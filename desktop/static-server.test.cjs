const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { startStaticServer } = require("./static-server.cjs");

function createFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "slh-tms-desktop-"));
  fs.mkdirSync(path.join(rootDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "index.html"), "<html><body>SLH desktop shell</body></html>");
  fs.writeFileSync(path.join(rootDir, "assets", "app.js"), "console.log('SLH');");
  return rootDir;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("serves the packaged SPA from a localhost HTTP origin", async () => {
  const rootDir = createFixture();
  const { server, origin } = await startStaticServer(rootDir, { port: 0 });
  try {
    assert.match(origin, /^http:\/\/localhost:\d+$/);
    const response = await fetch(`${origin}/operations-wallboard`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /SLH desktop shell/);
  } finally {
    await closeServer(server);
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("serves static assets with an appropriate content type", async () => {
  const rootDir = createFixture();
  const { server, origin } = await startStaticServer(rootDir, { port: 0 });
  try {
    const response = await fetch(`${origin}/assets/app.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /javascript/);
    assert.equal(await response.text(), "console.log('SLH');");
  } finally {
    await closeServer(server);
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
