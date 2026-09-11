"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import yaml from "js-yaml";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiRequestError } from "@/lib/api";
import { monacoLanguage } from "@/lib/file-kinds";
import { EDITOR_NAME, EDITOR_TAGLINE } from "@/lib/version";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export function FormatorEditor({ path }: { path: string }) {
  const router = useRouter();
  const file = useQuery({
    queryKey: ["content", path],
    queryFn: () => api<{ path: string; name: string; content: string }>(`/api/files/content?path=${encodeURIComponent(path)}`),
  });

  const [content, setContent] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [saveAs, setSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");

  const current = content ?? file.data?.content ?? "";
  const baseline = original ?? file.data?.content ?? "";
  const dirty = current !== baseline;
  const name = saveAsName || file.data?.name || "";
  const save = useMutation({
    mutationFn: async (asName?: string) =>
      api("/api/files/content", {
        method: "PUT",
        body: JSON.stringify({
          path: asName ? path.slice(0, path.lastIndexOf("/") + 1) || "/" : path,
          content: current,
          saveAsName: asName,
        }),
      }),
    onSuccess: () => {
      setOriginal(current);
      setSaveAs(false);
      toast.success("Gespeichert");
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Speichern fehlgeschlagen"),
  });

  function formatDoc() {
    try {
      const lang = monacoLanguage(file.data?.name ?? "");
      if (lang === "json") setContent(JSON.stringify(JSON.parse(current), null, 2));
      else if (lang === "yaml") setContent(yaml.dump(yaml.load(current)));
      else toast.message("Für diesen Typ ist kein Formatter hinterlegt.");
    } catch {
      toast.error("Inhalt konnte nicht formatiert werden.");
    }
  }

  return (
    <div className="flex h-[calc(100vh-5.5rem)] flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="cloudora-section">{EDITOR_NAME}</p>
          <h1 className="cloudora-title text-xl">{file.data?.name ?? "…"}</h1>
          <p className="text-xs text-muted-foreground">{EDITOR_TAGLINE}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push(`/files?path=${encodeURIComponent(path.slice(0, path.lastIndexOf("/") + 1) || "/")}`)}>
            Zurück
          </Button>
          <Button variant="outline" onClick={formatDoc}>
            Format
          </Button>
          <Button variant="outline" onClick={() => setContent(baseline)} disabled={!dirty}>
            Verwerfen
          </Button>
          <Button variant="outline" onClick={() => setSaveAs(true)}>
            Speichern unter
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={!dirty || save.isPending}>
            Speichern
          </Button>
        </div>
      </div>
      <div className="cloudora-panel min-h-0 flex-1 overflow-hidden">
        {file.isLoading ? <p className="p-6 text-sm text-muted-foreground">Lade Datei…</p> : null}
        {file.isError ? <p className="p-6 text-sm text-destructive">Datei konnte nicht geöffnet werden.</p> : null}
        {file.data ? (
          <Monaco
            theme="vs-dark"
            language={monacoLanguage(file.data.name)}
            value={current}
            onChange={(v) => setContent(v ?? "")}
            options={{
              minimap: { enabled: true },
              fontSize: 13,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              wordWrap: "on",
            }}
          />
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{dirty ? "Ungespeicherte Änderungen" : "Gespeichert"}</span>
        <span>{EDITOR_NAME}</span>
      </div>
      {saveAs ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setSaveAs(false)}>
          <div className="cloudora-panel w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold">Speichern unter</h3>
            <Input value={name} onChange={(e) => setSaveAsName(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSaveAs(false)}>
                Abbrechen
              </Button>
              <Button onClick={() => save.mutate(name)}>Speichern</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
