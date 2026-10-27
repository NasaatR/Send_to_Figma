const assert=require("node:assert/strict"), fs=require("node:fs"), path=require("node:path");
const root=path.join(__dirname,"..");
function pluginSource() {
  const built = path.join(
    root,
    "release",
    "Send-to-Figma-" + require("../package.json").version,
    "figma-plugin/code.js",
  );
  return fs.existsSync(built)
    ? fs.readFileSync(built, "utf8")
    : fs.readFileSync(path.join(root, "plugin/core.js"), "utf8") +
        "\n" +
        fs.readFileSync(path.join(root, "plugin/main.js"), "utf8");
}

function fixture() {
  let next = 0;
  const nodes = new Map(),
    messages = [],
    storage = new Map();
  function node(type) {
    const n = {
      id: `1:${++next}`,
      type,
      name: type,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [],
      parent: null,
      removed: false,
      layoutMode: "NONE",
      fills: [],
      locked: false,
      metadata: {},
      resize(w, h) {
        this.width = w;
        this.height = h;
      },
      appendChild(child) {
        if (child.parent)
          child.parent.children = child.parent.children.filter(
            (x) => x !== child,
          );
        this.children.push(child);
        child.parent = this;
      },
      remove() {
        this.removed = true;
        if (this.parent)
          this.parent.children = this.parent.children.filter((x) => x !== this);
        nodes.delete(this.id);
      },
      getPluginData(k) {
        return this.metadata[k] || "";
      },
      setPluginData(k, v) {
        this.metadata[k] = v;
      },
      setRelaunchData() {},
    };
    nodes.set(n.id, n);
    return n;
  }
  const document = node("DOCUMENT");
  document.name = "Test file";
  const page = node("PAGE");
  page.name = "Page 1";
  page.selection = [];
  document.appendChild(page);
  const figma = {
    root: document,
    currentPage: page,
    ui: { postMessage: (m) => messages.push(m) },
    clientStorage: {
      getAsync: async (k) => storage.get(k),
      setAsync: async (k, v) => storage.set(k, v),
    },
    showUI(html) { figma.shownHTML = html; },
    on() {},
    notify() {},
    commitUndo() {},
    viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView() {} },
    getNodeByIdAsync: async (id) => nodes.get(id) || null,
    loadFontAsync: async () => {},
    createImage(bytes) {
      assert.ok(bytes.length > 0);
      return {
        hash: "image-hash",
        getSizeAsync: async () => ({ width: 400, height: 200 }),
      };
    },
    createFrame() {
      const n = node("FRAME");
      page.appendChild(n);
      return n;
    },
    createRectangle() {
      const n = node("RECTANGLE");
      page.appendChild(n);
      return n;
    },
    createText() {
      const n = node("TEXT");
      page.appendChild(n);
      return n;
    },
  };
  return { figma, messages, nodes, storage, node, page };
}

module.exports={fixture,pluginSource};
