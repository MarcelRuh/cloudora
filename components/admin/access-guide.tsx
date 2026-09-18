import Link from "next/link";
import { FolderOpen, Link2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    n: "1",
    href: "/admin/users",
    icon: Users,
    title: "Benutzer anlegen",
    text: "Konto, Rolle und was das Konto darf (Upload, Links erstellen …). Das gibt noch keinen Ordner im Explorer.",
  },
  {
    n: "2",
    href: "/admin/storage",
    icon: FolderOpen,
    title: "Ordnerzugriff zuweisen",
    text: "Welchen Host-Ordner der Benutzer im Explorer sieht — Lesen oder Schreiben.",
  },
  {
    n: "3",
    href: "/files",
    icon: Link2,
    title: "Link nach draußen",
    text: "Im Explorer über „Teilen“ (öffentlich oder einmal). Das ist eine URL, kein Explorer-Zugriff.",
  },
] as const;

export function AccessGuide({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("grid gap-3", compact ? "md:grid-cols-3" : "gap-4 md:grid-cols-3")}>
      {STEPS.map((step) => (
        <Link key={step.n} href={step.href} className="block">
          <Card className="h-full transition-colors hover:border-primary/50">
            <p className="cloudora-section">Schritt {step.n}</p>
            <h2 className="mt-2 flex items-center gap-2 font-semibold">
              <step.icon className="h-4 w-4 shrink-0 text-primary" />
              {step.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export function AccessHint() {
  return (
    <p className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Ordnerzugriff</span> bestimmt, was im Explorer liegt.{" "}
      <span className="font-medium text-foreground">Links</span> sind URLs nach draußen. Das sind zwei verschiedene
      Dinge.
    </p>
  );
}
