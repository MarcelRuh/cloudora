import path from "node:path";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  json: "application/json",
  yaml: "text/yaml; charset=utf-8",
  yml: "text/yaml; charset=utf-8",
  xml: "application/xml",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  ts: "text/plain; charset=utf-8",
  jsx: "text/plain; charset=utf-8",
  tsx: "text/plain; charset=utf-8",
  zip: "application/zip",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

export function mimeFromName(name: string): string {
  const ext = path.extname(name).slice(1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

export function contentDisposition(name: string, type: "attachment" | "inline"): string {
  const encoded = encodeURIComponent(name).replace(/['()]/g, escape);
  return `${type}; filename="${name.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encoded}`;
}
