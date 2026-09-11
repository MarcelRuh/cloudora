import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  HardDrive,
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

export function FileGlyph({
  kind,
  className,
  mount,
}: {
  kind: FileKind;
  className?: string;
  mount?: boolean;
}) {
  if (mount) return <HardDrive className={className} />;
  const Icon = MAP[kind] ?? File;
  return <Icon className={className} />;
}
