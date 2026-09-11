import type { Permission } from "@/lib/permissions";

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  email: string;
  status: "ACTIVE" | "DISABLED";
  homePathEnabled: boolean;
  homePath: string;
  quotaBytes: number | null;
  usedBytes: number;
  canUpload: boolean;
  canDownload: boolean;
  canDelete: boolean;
  canEdit: boolean;
  canShare: boolean;
  canOneTimeDownload: boolean;
  appearance: string;
  totpEnabled: boolean;
  role: {
    id: string;
    name: string;
    slug: string;
    permissions: Permission[];
  };
};

export type FileKind = "folder" | "image" | "pdf" | "text" | "code" | "archive" | "video" | "audio" | "other";

export type ExplorerEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: string;
  mimeType: string | null;
  kind: FileKind;
  editable: boolean;
};

export type Breadcrumb = {
  name: string;
  path: string;
};
