import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "./dashboard-store.mjs";

const DEFAULT_MAX_BYTES = 80_000;
const DEFAULT_SEARCH_LIMIT = 50;

const blockedSegments = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".vercel"
]);

const blockedFiles = new Set([
  path.normalize("data/secrets.json").toLowerCase(),
  path.normalize("data/desk-ai-memory.json").toLowerCase()
]);

function parseAllowedFolders() {
  const raw = process.env.COMMAND_CENTER_ALLOWED_FOLDERS || "";
  const entries = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex > 0) {
        return {
          name: entry.slice(0, separatorIndex).trim(),
          root: path.resolve(entry.slice(separatorIndex + 1).trim())
        };
      }
      return { name: `folder-${index + 1}`, root: path.resolve(entry) };
    });

  return [
    { name: "command-center", root: PROJECT_ROOT },
    ...entries
  ];
}

export function allowedFolders() {
  const seen = new Set();
  return parseAllowedFolders().filter((folder) => {
    const key = folder.root.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function folderByName(folderName = "command-center") {
  const folders = allowedFolders();
  const normalizedName = String(folderName || "command-center").toLowerCase();
  const folder = folders.find((item) => item.name.toLowerCase() === normalizedName);
  if (!folder) {
    throw new Error(`Folder is not allowed: ${folderName}`);
  }
  return folder;
}

function assertSafePath(folder, relativePath = ".") {
  const target = path.resolve(folder.root, relativePath || ".");
  const root = path.resolve(folder.root);
  const relative = path.relative(root, target);
  const relativeLower = relative.toLowerCase();

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes allowed folder: ${relativePath}`);
  }

  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.some((part) => blockedSegments.has(part))) {
    throw new Error(`Path is blocked: ${relativePath}`);
  }

  if (blockedFiles.has(path.normalize(relativeLower))) {
    throw new Error(`File is private and cannot be accessed: ${relativePath}`);
  }

  return target;
}

export async function listAllowedFolders() {
  return allowedFolders().map((folder) => ({ name: folder.name, path: folder.root }));
}

export async function listFolder(folderName, relativePath = ".") {
  const folder = folderByName(folderName);
  const target = assertSafePath(folder, relativePath);
  const items = await fs.readdir(target, { withFileTypes: true });

  return items
    .filter((item) => !blockedSegments.has(item.name))
    .map((item) => ({
      name: item.name,
      type: item.isDirectory() ? "folder" : "file",
      path: path.relative(folder.root, path.join(target, item.name)) || "."
    }))
    .sort((a, b) => `${a.type}-${a.name}`.localeCompare(`${b.type}-${b.name}`));
}

export async function readFolderFile(folderName, relativePath, maxBytes = DEFAULT_MAX_BYTES) {
  const folder = folderByName(folderName);
  const target = assertSafePath(folder, relativePath);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error(`Not a file: ${relativePath}`);
  if (stat.size > maxBytes) {
    throw new Error(`File is too large (${stat.size} bytes). Increase maxBytes intentionally if needed.`);
  }
  return {
    folder: folder.name,
    path: path.relative(folder.root, target),
    bytes: stat.size,
    content: await fs.readFile(target, "utf8")
  };
}

export async function writeFolderFile(folderName, relativePath, content, mode = "overwrite") {
  const folder = folderByName(folderName);
  const target = assertSafePath(folder, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });

  if (mode === "append") {
    await fs.appendFile(target, content, "utf8");
  } else {
    await fs.writeFile(target, content, "utf8");
  }

  const stat = await fs.stat(target);
  return {
    folder: folder.name,
    path: path.relative(folder.root, target),
    bytes: stat.size,
    mode
  };
}

async function walk(folder, relativePath, visitor) {
  const target = assertSafePath(folder, relativePath);
  const items = await fs.readdir(target, { withFileTypes: true });

  for (const item of items) {
    if (blockedSegments.has(item.name)) continue;
    const childRelative = path.relative(folder.root, path.join(target, item.name));
    const childPath = assertSafePath(folder, childRelative);
    if (item.isDirectory()) {
      await walk(folder, childRelative, visitor);
    } else if (item.isFile()) {
      await visitor(childPath, childRelative);
    }
  }
}

export async function searchFolderText(folderName, query, relativePath = ".", limit = DEFAULT_SEARCH_LIMIT) {
  const folder = folderByName(folderName);
  const needle = String(query || "").toLowerCase();
  if (!needle) throw new Error("Search query is required.");

  const results = [];
  await walk(folder, relativePath, async (filePath, fileRelative) => {
    if (results.length >= limit) return;
    const stat = await fs.stat(filePath);
    if (stat.size > DEFAULT_MAX_BYTES) return;

    let content = "";
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      return;
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (results.length >= limit) return;
      if (line.toLowerCase().includes(needle)) {
        results.push({
          path: fileRelative,
          line: index + 1,
          text: line.trim().slice(0, 500)
        });
      }
    });
  });

  return { folder: folder.name, query, results };
}
