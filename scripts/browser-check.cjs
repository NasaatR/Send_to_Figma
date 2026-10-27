// Real Chromium rendering and image decoding; extension/Figma APIs are explicit fixtures.
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const root = path.resolve(__dirname, ".."),
  version = require("../package.json").version,
  release = path.join(root, "release", "Send-to-Figma-" + version),
  base = path.join(release, "extension"),
  output = path.join(root, ".build", "ui");
fs.mkdirSync(output, { recursive: true });
const candidates = [
  process.env.STF_CHROME_EXECUTABLE,
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  process.env.PROGRAMFILES &&
    path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
  process.env["PROGRAMFILES(X86)"] &&
    path.join(
      process.env["PROGRAMFILES(X86)"],
      "Google/Chrome/Application/chrome.exe",
    ),
].filter(Boolean);
const executablePath = candidates.find((p) => fs.existsSync(p));
if (!executablePath)
  throw Error(
    "Set STF_CHROME_EXECUTABLE to an installed Chrome/Chromium executable",
  );
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    ),
    file =
      pathname === "/receiver.html"
        ? path.join(release, "figma-plugin/ui.html")
        : path.resolve(base, "." + pathname);
  if (
    file !== path.join(release, "figma-plugin/ui.html") &&
    !file.startsWith(base + path.sep)
  ) {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    "Content-Type",
    {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".png": "image/png",
    }[path.extname(file)] || "application/octet-stream",
  );
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: process.platform === "linux" ? ["--no-sandbox"] : [],
    });
    const decode = await browser.newPage();
    await decode.addInitScript(() => {
      window.chrome = {
        runtime: {
          id: "fixture",
          onMessage: { addListener: (f) => (window.normalizeFixture = f) },
        },
      };
    });
    await decode.goto(url + "/offscreen.html");
    const imageData = fs
      .readFileSync(path.join(base, "test-image.png"))
      .toString("base64");
    const normalized = await decode.evaluate(
      (data) =>
        new Promise((resolve) =>
          normalizeFixture(
            {
              destination: "offscreen",
              type: "normalize",
              data,
              mime: "image/png",
            },
            { id: "fixture" },
            resolve,
          ),
        ),
      imageData,
    );
    assert.equal(normalized.ok, true, normalized.error);
    assert.equal(normalized.width, 640);
    assert.equal(normalized.height, 400);
    assert.equal(normalized.data, imageData);
    assert.match(normalized.preview, /^data:image\/jpeg;base64,/);
    const crop = await decode.evaluate(
      (data) =>
        new Promise((resolve) =>
          normalizeFixture(
            {
              destination: "offscreen",
              type: "normalize",
              data,
              mime: "image/png",
              crop: {
                rect: { x: 20, y: 10, width: 100, height: 60 },
                viewport: { width: 320, height: 200 },
              },
            },
            { id: "fixture" },
            resolve,
          ),
        ),
      imageData,
    );
    assert.equal(crop.ok, true, crop.error);
    assert.equal(crop.width, 200);
    assert.equal(crop.height, 120);
    assert.equal(crop.captureMode, "screen");
    await decode.close();
    const page = await browser.newPage({
      viewport: { width: 384, height: 600 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const status = {
      version,
      paused: false,
      targetId: "collection-demo",
      targetLabel: "References / Brand inspiration",
      pending: 2,
      failed: 1,
      done: 1,
      history: 1,
      queueBytes: 1048576,
      pairingToken: "a".repeat(64),
      receivers: [
        {
          targetId: "collection-demo",
          label: "References / Brand inspiration",
        },
      ],
      jobs: [
        {
          id: "request-photo",
          sequence: 4,
          title: "Текстуры / Северный фасад · длинное название",
          status: "ready",
          size: 100,
          width: 1600,
          height: 1000,
          hasPreview: true,
          hasSource: true,
          targetId: "collection-demo",
        },
        {
          id: "request-failed",
          sequence: 3,
          title: "Architectural reference",
          status: "failed",
          error: "Коллекция заблокирована. Разблокируй её и повтори.",
          size: 100,
          width: 1200,
          height: 800,
          hasPreview: true,
          targetId: "collection-demo",
        },
        {
          id: "request-busy",
          sequence: 2,
          title: "Interface inspiration",
          status: "capturing",
          size: 0,
          targetId: "collection-demo",
        },
        {
          id: "request-done",
          sequence: 1,
          title: "Moodboard",
          status: "done",
          size: 100,
          width: 1200,
          height: 800,
          hasPreview: true,
          hasSource: true,
          targetId: "collection-demo",
        },
      ],
    };
    await page.addInitScript(
      ({ state, preview, version }) => {
        window.chrome = {
          runtime: {
            id: "fixture",
            getManifest: () => ({ version }),
            getURL: (p) => p,
            sendMessage: async (m) => {
              const command = m.command;
              if (command === "thumbnail")
                return { ok: true, data: { data: preview } };
              if (command === "pause") state.paused = m.data.paused;
              if (command === "source")
                return { ok: true, data: { url: "https://example.com/" } };
              if (command === "cancel")
                state.jobs.find((j) => j.id === m.data.id).status = "cancelled";
              return { ok: true, data: structuredClone(state) };
            },
          },
          storage: {
            local: {
              get: async () => ({
                appearance: { theme: "dark", density: "compact" },
              }),
              set: async () => {},
            },
          },
          tabs: { create: async () => {} },
        };
      },
      { state: status, preview: normalized.preview, version },
    );
    await page.goto(url + "/popup.html");
    await page.locator(".job").first().waitFor();
    await page.locator(".job-thumb img").first().waitFor();
    await page.screenshot({animations:"disabled", path: path.join(output, "popup-dark.png") });
    assert.equal(await page.locator(".job").count(), 4);
    const rowWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert.ok(rowWidth <= 384, "Horizontal overflow");
    assert.ok(await page.evaluate(()=>document.querySelector("main").scrollWidth<=document.querySelector("main").clientWidth),"Popup main has hidden horizontal overflow");
    await page.locator("#search").fill("северный");
    assert.equal(await page.locator(".job").count(), 1);
    await page.locator("#search").press("Escape");
    assert.equal(await page.locator(".job").count(), 4);
    await page.locator("#pause-queue").click();
    await page
      .getByRole("button", { name: "Продолжить очередь", exact: true })
      .waitFor();
    await page.locator("[data-filter=active]").click();
    await page.locator("#cancel-waiting").click();
    await page.locator("#confirm-dialog").waitFor();
    await page.screenshot({animations:"disabled", path: path.join(output, "confirm-dark.png") });
    await page.locator("#confirm-dialog").press("Escape");
    assert.equal(await page.locator("#confirm-dialog").isVisible(), false);
    await page.locator("#settings-tab").click();
    await page.locator("#theme").selectOption("light");
    await page.screenshot({animations:"disabled", path: path.join(output, "settings-light.png") });
    assert.equal(await page.locator("#theme").inputValue(), "light");
    assert.deepEqual(errors, []);
    await page.close();
    const receiver = await browser.newPage({
      viewport: { width: 340, height: 520 },
    });
    const settings = {
      version: 1,
      layout: {
        columns: 4,
        width: 320,
        gap: 24,
        padding: 24,
        maxHeight: 480,
        radius: 8,
        captions: false,
      },
      appearance: { theme: "dark", density: "compact" },
      pairingToken: "",
    };
    const receiverErrors = [];
    receiver.on("pageerror", (e) => receiverErrors.push(e.message));
    await receiver.addInitScript((settings) => {
      window.postMessage = (message) => {
        if (message.pluginMessage?.type === "init")
          setTimeout(
            () =>
              dispatchEvent(
                new MessageEvent("message", {
                  source: null,
                  data: {
                    pluginMessage: { type: "init", channel: message.pluginMessage.channel, settings, target: null },
                  },
                }),
              ),
            0,
          );
      };
    }, settings);
    await receiver.goto(url + "/receiver.html");
    await receiver.waitForFunction(() => document.getElementById("connection-text").textContent === "Готово к подключению");
    await receiver.screenshot({animations:"disabled",path:path.join(output,"receiver-start.png")});
    await receiver.locator("#layout-tab").click();
    await receiver.locator("#layout-preset").selectOption("compact");
    assert.equal(await receiver.locator("#columns").inputValue(), "6");
    await receiver.screenshot({animations:"disabled",
      path: path.join(output, "receiver-layout.png"),
    });
    assert.ok(
      await receiver.evaluate(
        () => document.documentElement.scrollWidth <= 340,
      ),
    );
    assert.deepEqual(receiverErrors, []);
    await receiver.close();
    console.log(
      "Chromium UI smoke passed: light/dark panels, search, pause, modal Escape, layout preset, no horizontal overflow; original PNG and crop decoded by actual Chromium. API boundaries remain fixtures.",
    );
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
