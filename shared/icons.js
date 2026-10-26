var STFIcons = (function () {
  "use strict";
  const paths = {
    image:
      "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M3 16l5-5 5 5 3-3 5 5 M8 7h.01",
    refresh: "M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 2 M18 18a8 8 0 0 1-13-2",
    pause: "M8 5v14 M16 5v14",
    play: "m8 5 11 7-11 7Z",
    crop: "M7 3v14h14 M3 7h14v14",
    help: "M9 9a3 3 0 1 1 5 2c-1 .7-2 1-2 3 M12 17h.01 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
    close: "m6 6 12 12 M6 18 18 6",
    check: "m5 12 4 4L19 6",
    clock: "M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
    link: "m10 13 4-4 M8 16H6a4 4 0 0 1 0-8h4 M16 8h2a4 4 0 0 1 0 8h-4",
    search: "m16 16 5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    warning: "m12 3 10 18H2Z M12 9v5 M12 17h.01",
    trash: "M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
    arrow: "M5 12h14 m-5-5 5 5-5 5",
    download: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
  };
  function create(name) {
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg"),
      p = document.createElementNS(ns, "path");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    p.setAttribute("d", paths[name] || paths.image);
    svg.append(p);
    return svg;
  }
  function mount(root = document) {
    root.querySelectorAll("[data-icon]").forEach((el) => {
      el.replaceChildren(create(el.dataset.icon));
    });
  }
  return { create, mount };
})();
