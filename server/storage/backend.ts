/**
 * Storage backends (local filesystem today, S3 / WebDAV later) should implement this shape.
 * Version 1 ships a local disk backend only.
 */
export type StorageObject = {
  key: string;
  size: number;
  isDir: boolean;
  modifiedAt: Date;
};

export interface StorageBackend {
  kind: "local" | "s3" | "webdav";
  list(prefix: string): Promise<StorageObject[]>;
  readStream(key: string): Promise<NodeJS.ReadableStream>;
  writeStream(key: string, stream: NodeJS.ReadableStream): Promise<number>;
  remove(key: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  mkdir(key: string): Promise<void>;
  stat(key: string): Promise<StorageObject | null>;
}
