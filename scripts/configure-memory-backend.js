import fs from "node:fs";
import path from "node:path";

const settingsFile = process.env.PI_SETTINGS_FILE || "/home/pi/.pi/agent/settings.json";
const requested = String(process.env.PI_MEMORY_BACKEND || "pi-memory").trim().toLowerCase();

const aliases = new Map([
  ["pi-memory", "pi-memory"],
  ["memory", "pi-memory"],
  ["markdown", "pi-memory"],
  ["pi-hermes-memory", "pi-hermes-memory"],
  ["hermes", "pi-hermes-memory"],
  ["none", "none"],
  ["off", "none"],
  ["disabled", "none"]
]);

const backend = aliases.get(requested);
if (!backend) {
  console.error(
    `[entrypoint] PI_MEMORY_BACKEND inválido: ${requested}. Use pi-memory, pi-hermes-memory ou none.`
  );
  process.exit(2);
}

function sourceOf(entry) {
  return typeof entry === "string" ? entry : entry?.source;
}

function npmPackageName(source) {
  if (typeof source !== "string") return "";
  let spec = source.startsWith("npm:") ? source.slice(4) : source;
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    if (slash < 0) return spec;
    const versionAt = spec.indexOf("@", slash + 1);
    return versionAt >= 0 ? spec.slice(0, versionAt) : spec;
  }
  const versionAt = spec.indexOf("@");
  return versionAt >= 0 ? spec.slice(0, versionAt) : spec;
}

function packageName(entry) {
  return npmPackageName(sourceOf(entry));
}

function enable(entry) {
  if (typeof entry === "string") return entry;
  const next = { ...entry };
  delete next.extensions;
  delete next.skills;
  delete next.prompts;
  delete next.themes;
  delete next.autoload;
  return Object.keys(next).length === 1 && next.source ? next.source : next;
}

function disable(entry) {
  const source = sourceOf(entry);
  const next = typeof entry === "object" && entry ? { ...entry } : { source };
  next.source = source;
  next.extensions = [];
  next.skills = [];
  next.prompts = [];
  next.themes = [];
  return next;
}

let settings = {};
if (fs.existsSync(settingsFile)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  } catch (error) {
    console.error(`[entrypoint] settings.json inválido: ${error.message}`);
    process.exit(3);
  }
}

const packages = Array.isArray(settings.packages) ? settings.packages : [];
const wanted = new Set(["pi-memory", "pi-hermes-memory"]);
const found = new Set();

settings.packages = packages.map((entry) => {
  const name = packageName(entry);
  if (!wanted.has(name)) return entry;
  found.add(name);
  return name === backend ? enable(entry) : disable(entry);
});

for (const name of wanted) {
  if (found.has(name)) continue;
  const source = name === "pi-memory"
    ? `npm:pi-memory@${process.env.PI_MEMORY_VERSION || "0.4.0"}`
    : "npm:pi-hermes-memory";
  settings.packages.push(name === backend ? source : disable(source));
}

fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
const temp = `${settingsFile}.${process.pid}.tmp`;
fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temp, settingsFile);

const disabled = [...wanted].filter((name) => name !== backend);
console.log(
  `[entrypoint] Backend de memória ativo: ${backend}; desativado(s): ${disabled.join(", ") || "nenhum"}`
);
