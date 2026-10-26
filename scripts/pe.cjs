// Inspect the resource table of the exact shipped PE, not source templates.
const fs = require("node:fs");
function inspect(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 0, 2) !== "MZ") throw Error("Not a PE: " + file);
  const pe = b.readUInt32LE(0x3c);
  if (b.toString("binary", pe, pe + 4) !== "PE\0\0")
    throw Error("Bad PE signature");
  const machine = b.readUInt16LE(pe + 4),
    count = b.readUInt16LE(pe + 6),
    optional = pe + 24,
    optionalSize = b.readUInt16LE(pe + 20),
    magic = b.readUInt16LE(optional),
    table = optional + optionalSize;
  function offset(rva) {
    for (let i = 0; i < count; i++) {
      const p = table + i * 40,
        size = Math.max(b.readUInt32LE(p + 8), b.readUInt32LE(p + 16)),
        va = b.readUInt32LE(p + 12);
      if (rva >= va && rva < va + size)
        return b.readUInt32LE(p + 20) + rva - va;
    }
    throw Error("Unmapped resource RVA");
  }
  const dir = optional + (magic === 0x20b ? 112 : 96),
    resourceRVA = b.readUInt32LE(dir + 16);
  if (!resourceRVA) throw Error("Missing resources: " + file);
  const base = offset(resourceRVA),
    resources = new Map();
  function walk(relative, type, depth = 0) {
    if (depth > 5) throw Error("Invalid resource tree");
    const p = base + relative,
      n = b.readUInt16LE(p + 12) + b.readUInt16LE(p + 14);
    for (let i = 0; i < n; i++) {
      const e = p + 16 + i * 8,
        id = b.readUInt32LE(e),
        entry = b.readUInt32LE(e + 4),
        kind = type ?? id;
      if (entry & 0x80000000) walk(entry & 0x7fffffff, kind, depth + 1);
      else {
        const leaf = base + entry,
          start = offset(b.readUInt32LE(leaf)),
          size = b.readUInt32LE(leaf + 4);
        if (start + size > b.length) throw Error("Invalid resource size");
        const list = resources.get(kind) || [];
        list.push(b.subarray(start, start + size));
        resources.set(kind, list);
      }
    }
  }
  walk(0);
  return { machine, subsystem: b.readUInt16LE(optional + 68), resources };
}
module.exports = { inspect };
