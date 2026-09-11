import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
} from "lucide-react";
import type { FileKind } from "@/lib/types";

const MAP: Record<FileKind, typeof File> = {
  folder: Folder,
  image: FileImage,
  pdf: FileText,
  text: FileText,
  code: FileCode,
  archive: FileArchive,
  video: FileVideo,
  audio: FileAudio,
  other: File,
};

export function FileGlyph({ kind, className }: { kind: FileKind; className?: string }) {
  const Icon = MAP[kind] ?? File;
  return <Icon className={className} />;
}
