import type { FileKind } from "@/lib/types";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);
const PDF_EXT = new Set(["pdf"]);
const TEXT_EXT = new Set(["txt", "log", "json", "yaml", "yml", "xml", "csv", "md", "ini", "conf", "toml", "env"]);
const CODE_EXT = new Set([
  "js",
  "ts",
  "jsx",
  "tsx",
  "css",
  "html",
  "htm",
  "php",
  "py",
  "sh",
  "bash",
  "zsh",
  "sql",
  "dockerfile",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "h",
  "cpp",
  "hpp",
  "rb",
  "vue",
  "svelte",
]);
const ARCHIVE_EXT = new Set(["zip", "tar", "gz", "tgz", "bz2", "7z", "rar", "xz"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mkv", "mov", "avi"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "flac", "m4a"]);

export const EDITABLE_EXT = new Set([...TEXT_EXT, ...CODE_EXT]);

const MONACO_LANG: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  md: "markdown",
  py: "python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  php: "php",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  rb: "ruby",
  dockerfile: "dockerfile",
  csv: "plaintext",
  txt: "plaintext",
  log: "plaintext",
  ini: "ini",
  conf: "ini",
  toml: "ini",
  env: "plaintext",
};

export function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.endsWith(".dockerfile")) return "dockerfile";
  const idx = lower.lastIndexOf(".");
  if (idx <= 0) return "";
  return lower.slice(idx + 1);
}

export function kindOf(name: string, isDir: boolean): FileKind {
  if (isDir) return "folder";
  const ext = extensionOf(name);
  if (IMAGE_EXT.has(ext)) return "image";
  if (PDF_EXT.has(ext)) return "pdf";
  if (CODE_EXT.has(ext)) return "code";
  if (TEXT_EXT.has(ext)) return "text";
  if (ARCHIVE_EXT.has(ext)) return "archive";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "other";
}

export function isEditable(name: string, isDir: boolean): boolean {
  if (isDir) return false;
  const ext = extensionOf(name);
  if (!ext && name.toLowerCase() === "dockerfile") return true;
  return EDITABLE_EXT.has(ext);
}

export function monacoLanguage(name: string): string {
  return MONACO_LANG[extensionOf(name)] ?? "plaintext";
}

export function previewable(kind: FileKind): boolean {
  return kind === "image" || kind === "pdf" || kind === "text" || kind === "code" || kind === "video" || kind === "audio";
}
