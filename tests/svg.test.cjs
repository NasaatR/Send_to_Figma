const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { JSDOM } = require("jsdom");
async function preprocess(text) {
  const dom = new JSDOM(""),
    w = dom.window;
  let listener,
    svg = "";
  class ImageBoundary {
    set src(v) {
      this.url = v;
    }
    async decode() {
      svg = await (await fetch(this.url)).text();
      throw Error("decoder boundary reached");
    }
  }
  const context = {
    chrome: {
      runtime: {
        id: "test-id",
        onMessage: { addListener: (f) => (listener = f) },
      },
    },
    URL,
    Blob,
    Image: ImageBoundary,
    DOMParser: w.DOMParser,
    XMLSerializer: w.XMLSerializer,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Error,
    Number,
    String,
    Promise,
    console,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
  };
  vm.createContext(context);
  for (const n of ["capture-core.js", "offscreen.js"])
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "../extension", n), "utf8"),
      context,
    );
  const result = await new Promise((resolve) =>
    listener(
      {
        type: "normalize",
        destination: "offscreen",
        data: Buffer.from(text).toString("base64"),
        mime: "image/svg+xml",
      },
      { id: "test-id" },
      resolve,
    ),
  );
  const parsed = new w.DOMParser().parseFromString(
    svg || "<svg/>",
    "image/svg+xml",
  );
  return { svg, parsed, result, close: () => dom.window.close() };
}
test("SVG preprocessing preserves class styling and quoted local gradients", async () => {
  const r = await preprocess(
    `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><style>.paint{fill:#c00;stroke:url('#g')}</style><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><rect class="paint" fill="url('#g')" width="12" height="8"/></svg>`,
  );
  try {
    assert.match(
      r.parsed.querySelector("style")?.textContent || "",
      /fill:#c00/,
    );
    assert.equal(
      r.parsed.querySelector("rect").getAttribute("fill"),
      "url('#g')",
    );
  } finally {
    r.close();
  }
});
test("SVG with external paint resource is rejected instead of silently changed", async () => {
  const r = await preprocess(
    `<svg xmlns="http://www.w3.org/2000/svg"><style>.paint{fill:url(https://example.com/paint.svg)}</style><rect class="paint"/></svg>`,
  );
  try {
    assert.equal(r.svg, "");
    assert.match(r.result.error, /внешн|ресурс|област/i);
  } finally {
    r.close();
  }
});
