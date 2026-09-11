import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renamePath } from "@/server/storage/fs";

describe("renamePath", () => {
  it("moves files in a temporary directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cloudora-move-"));
    const from = path.join(root, "a.txt");
    const to = path.join(root, "b.txt");
    await fs.writeFile(from, "hello");
    await renamePath(from, to);
    expect(await fs.readFile(to, "utf8")).toBe("hello");
    await expect(fs.access(from)).rejects.toThrow();
  });
});
