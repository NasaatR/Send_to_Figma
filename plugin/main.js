(function () {
  "use strict";
  const K = {
    collection: "stf-collection",
    last: "stf-last-collection",
    job: "stf-job",
    source: "stf-source",
    meta: "stf-meta",
    layout: "stf-layout",
  };
  let settings = {
    version: 1,
    layout: STFCore.normalizeLayout({}),
    appearance: STFCore.normalizeAppearance({}),
    pairingToken: "",
  };
  let frame = null,
    serial = Promise.resolve();
  const channel = uid() + uid();
  const installationToken = "__STF_INSTALL_TOKEN__";
  const post = (m) => figma.ui.postMessage({ ...m, channel });
  function uid() {
    return (
      "collection-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 14)
    );
  }
  function managed(f) {
    return f.children.filter(
      (n) => n.type === "FRAME" && n.getPluginData(K.job),
    );
  }
  function ordered(f) {
    return managed(f)
      .slice()
      .sort((a, b) => {
        try {
          return (
            JSON.parse(a.getPluginData(K.meta)).sequence -
            JSON.parse(b.getPluginData(K.meta)).sequence
          );
        } catch {
          return 0;
        }
      });
  }
  function targetInfo() {
    return frame && !frame.removed
      ? {
          targetId: frame.getPluginData(K.collection),
          nodeId: frame.id,
          label: figma.root.name + " / " + frame.name,
          count: managed(frame).length,
        }
      : null;
  }
  function unlocked(n) {
    for (let p = n; p; p = p.parent) {
      if (p.locked)
        throw Error(
          "Коллекция или родительский слой заблокированы. Разблокируйте их в Figma",
        );
    }
  }
  async function save(next) {
    await figma.clientStorage.setAsync("stf-settings-v1", next);
    settings = next;
  }
  async function restore() {
    const id = figma.root.getPluginData(K.last);
    if (id) {
      const n = await figma.getNodeByIdAsync(id);
      if (n && n.type === "FRAME" && n.getPluginData(K.collection)) frame = n;
    }
  }
  async function start(mode) {
    if (mode === "restore" && frame && !frame.removed) {
      unlocked(frame);
      post({ type: "target", target: targetInfo() });
      return;
    }
    const selection = figma.currentPage.selection;
    if (
      mode === "selected" &&
      (!selection.length || !["FRAME", "SECTION"].includes(selection[0].type))
    )
      throw Error(
        "Выберите фрейм или секцию, затем нажмите «В выбранный фрейм»",
      );
    const parent = mode === "selected" ? selection[0] : figma.currentPage;
    unlocked(parent);
    // Reuse a managed collection only when the user explicitly selected it.
    if (
      mode === "selected" &&
      parent.type === "FRAME" &&
      parent.getPluginData(K.collection)
    ) {
      frame = parent;
    } else {
      frame = figma.createFrame();
      frame.name = "References";
      frame.fills = [];
      frame.clipsContent = false;
      frame.layoutMode = "NONE";
      frame.setPluginData(K.collection, uid());
      frame.setRelaunchData({ open: "" });
      if (mode === "selected") {
        parent.appendChild(frame);
        frame.x = 24;
        frame.y = 24;
      } else {
        frame.x = figma.viewport.center.x;
        frame.y = figma.viewport.center.y;
      }
      frame.resize(
        settings.layout.padding * 2 + settings.layout.width,
        settings.layout.padding * 2 + 80,
      );
    }
    figma.root.setPluginData(K.last, frame.id);
    post({ type: "target", target: targetInfo() });
  }
  function resizeCollection() {
    const children = frame.children;
    const p = settings.layout.padding;
    frame.resize(
      Math.max(120, ...children.map((n) => n.x + n.width + p)),
      Math.max(80, ...children.map((n) => n.y + n.height + p)),
    );
  }
  function dims(card) {
    let m;
    try {
      m = JSON.parse(card.getPluginData(K.meta));
    } catch {
      throw Error("Данные карточки повреждены");
    }
    return { width: m.width, height: m.height };
  }
  async function positionCard(card, slot, job) {
    card.x = slot.x;
    card.y = slot.y;
    card.resize(slot.width, slot.height);
    card.fills = [];
    card.clipsContent = false;
    card.layoutMode = "NONE";
    const image = card.children.find((n) => n.type === "RECTANGLE");
    if (!image) throw Error("Слой изображения не найден");
    image.x = slot.imageX;
    image.y = 0;
    image.resize(slot.imageWidth, slot.imageHeight);
    image.cornerRadius = Math.min(
      settings.layout.radius,
      slot.imageWidth / 2,
      slot.imageHeight / 2,
    );
    const oldText = card.children.find((n) => n.type === "TEXT");
    if (settings.layout.captions) {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      const text = oldText || figma.createText();
      if (!oldText) card.appendChild(text);
      text.fontName = { family: "Inter", style: "Regular" };
      text.fontSize = 12;
      text.characters =
        String(job.sequence).padStart(3, "0") +
        " · " +
        String(job.title || "Изображение").slice(0, 70);
      text.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
      text.x = 0;
      text.y = slot.imageHeight + 8;
      text.resize(slot.width, 18);
      text.textAutoResize = "TRUNCATE";
      text.maxLines = 1;
    } else if (oldText) {
      oldText.remove();
    }
    card.setPluginData(K.layout, STFCore.signature(settings.layout));
  }
  async function insert(job) {
    if (!frame || frame.removed)
      throw Error(
        "Коллекция недоступна. Выберите получателя и снова запустите приём",
      );
    unlocked(frame);
    if (!job || !/^[-a-zA-Z0-9_]{8,100}$/.test(job.id))
      throw Error("Некорректное отправление");
    if (job.targetId !== frame.getPluginData(K.collection))
      throw Error(
        "Получатель изменился. Изображение осталось в очереди для исходной коллекции",
      );
    const destination = frame;
    const cards = managed(frame),
      old = cards.find((n) => n.getPluginData(K.job) === job.id);
    if (old) return old.id;
    if (
      !Number.isSafeInteger(job.sequence) ||
      job.sequence < 1 ||
      !Number.isFinite(job.width) ||
      !Number.isFinite(job.height) ||
      job.width < 1 ||
      job.height < 1 ||
      job.width > 4096 ||
      job.height > 4096
    )
      throw Error("Некорректные размеры или номер изображения");
    const bytes = new Uint8Array(job.bytes || []);
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw Error("Изображение пустое или больше 20 МБ");
    const image = figma.createImage(bytes),
      size = await image.getSizeAsync();
    if (destination.removed || frame !== destination)
      throw Error(
        "Коллекция изменилась во время загрузки. Повторите отправление из очереди",
      );
    unlocked(destination);
    if (size.width !== job.width || size.height !== job.height)
      throw Error("Размер изображения не соответствует данным");
    const positions = cards.map((n) => ({
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      layoutKey: n.getPluginData(K.layout),
    }));
    const slot = STFCore.appendSlot(positions, size, settings.layout);
    let card;
    try {
      card = figma.createFrame();
      frame.appendChild(card);
      card.name =
        String(job.sequence).padStart(3, "0") +
        " · " +
        String(job.title || "Изображение").slice(0, 90);
      card.fills = [];
      card.layoutMode = "NONE";
      const rectangle = figma.createRectangle();
      card.appendChild(rectangle);
      rectangle.name = "Image";
      rectangle.fills = [
        { type: "IMAGE", imageHash: image.hash, scaleMode: "FIT" },
      ];
      const meta = {
        version: 1,
        id: job.id,
        sequence: job.sequence,
        title: String(job.title || "").slice(0, 160),
        width: job.width,
        height: job.height,
        captureMode: job.captureMode || "original",
        pageUrl: STFCore.safeURL(job.pageUrl),
        sourceUrl: STFCore.safeURL(job.sourceUrl),
      };
      card.setPluginData(K.meta, JSON.stringify(meta));
      card.setPluginData(K.source, meta.pageUrl);
      await positionCard(card, slot, meta);
      // Mark complete last: a failed insertion must not become a replay hit.
      card.setPluginData(K.job, job.id);
      resizeCollection();
      figma.commitUndo();
      post({ type: "collection", target: targetInfo() });
      return card.id;
    } catch (e) {
      if (card && !card.removed) card.remove();
      throw e;
    }
  }
  async function reflow() {
    if (!frame || frame.removed) throw Error("Сначала выберите коллекцию");
    unlocked(frame);
    const cards = ordered(frame);
    for (const c of cards) unlocked(c);
    const slots = STFCore.reflow(cards.map(dims), settings.layout);
    if (settings.layout.captions)
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    for (let i = 0; i < cards.length; i++) {
      await positionCard(
        cards[i],
        slots[i],
        JSON.parse(cards[i].getPluginData(K.meta)),
      );
    }
    resizeCollection();
    figma.commitUndo();
    post({ type: "reflowed", count: cards.length });
  }
  async function handle(m) {
    if (!m || m.channel !== channel || typeof m.type !== "string") return;
    if (m.type === "import") {
      try {
        const nodeId = await insert(m.job);
        post({ type: "import-result", id: m.job.id, ok: true, nodeId });
      } catch (e) {
        post({
          type: "import-result",
          id: m.job && m.job.id,
          ok: false,
          error: e.message || "Не удалось вставить изображение",
        });
      }
      return;
    }
    try {
      switch (m.type) {
        case "start":
          await start(
            ["restore", "new", "selected"].includes(m.mode)
              ? m.mode
              : "restore",
          );
          break;
        case "settings":
          await save({
            version: 1,
            layout: STFCore.normalizeLayout(m.layout),
            appearance: STFCore.normalizeAppearance(m.appearance),
            pairingToken: settings.pairingToken,
          });
          post({ type: "settings-saved", settings });
          break;
        case "pair":
          if (!/^[a-f0-9]{64}$/.test(String(m.token || "")))
            throw Error("Вставьте полный код подключения из расширения");
          await save({ ...settings, pairingToken: m.token });
          post({ type: "paired", settings });
          break;
        case "reflow":
          await reflow();
          break;
        case "reveal":
          if (!frame || frame.removed) throw Error("Коллекция недоступна");
          let page = frame;
          while (page && page.type !== "PAGE") page = page.parent;
          if (!page) throw Error("Страница коллекции недоступна");
          if (figma.currentPage.id !== page.id)
            await figma.setCurrentPageAsync(page);
          figma.currentPage.selection = [frame];
          figma.viewport.scrollAndZoomIntoView([frame]);
          break;
        case "init":
          post({ type: "init", settings, target: targetInfo() });
          break;
      }
    } catch (e) {
      post({ type: "error", error: e.message || "Действие не выполнено" });
    }
  }
  figma.showUI(__html__.split("__STF_CHANNEL__").join(channel), { width: 340, height: 520, themeColors: true });
  figma.ui.onmessage = (m) => {
    serial = serial
      .then(() => handle(m))
      .catch((e) => post({ type: "error", error: e.message }));
    return serial;
  };
  figma.on("selectionchange", () => {
    const selected = figma.currentPage.selection[0];
    post({
      type: "selection",
      usable: !!selected && ["FRAME", "SECTION"].includes(selected.type),
      name: selected ? selected.name : "",
    });
  });
  serial = (async () => {
    if (/^[a-f0-9]{64}$/.test(installationToken)) settings.pairingToken = installationToken;
    try {
      const saved = await figma.clientStorage.getAsync("stf-settings-v1");
      if (saved && saved.version === 1) {
        settings = {
          version: 1,
          layout: STFCore.normalizeLayout(saved.layout),
          appearance: STFCore.normalizeAppearance(saved.appearance),
          pairingToken: /^[a-f0-9]{64}$/.test(saved.pairingToken || "")
            ? saved.pairingToken
            : "",
        };
      }
      if (/^[a-f0-9]{64}$/.test(installationToken)) settings.pairingToken = installationToken;
      await restore();
      post({ type: "init", settings, target: targetInfo() });
    } catch (e) {
      post({ type: "error", error: "Настройки не загрузились: " + e.message });
      post({ type: "init", settings, target: targetInfo() });
    }
  })();
})();
