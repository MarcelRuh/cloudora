"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ClipboardList,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Search,
  Settings,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { LogoLockup } from "@/components/layout/logo-lockup";
import { UiAtmosphere } from "@/components/layout/ui-atmosphere";
import { CommandSearch } from "@/components/layout/command-search";
import { TransferProvider } from "@/components/transfers/transfer-provider";
import { TransferSidebar } from "@/components/transfers/transfer-sidebar";
import { api } from "@/lib/api";
import { userHasAnyPermission, type Permission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { APP_VERSION } from "@/lib/version";
import { cn } from "@/lib/utils";

const NAV: Array<{
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  anyOf: Permission[];
  aliases?: string[];
}> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, anyOf: ["files.read"] },
  { href: "/files", label: "Dateien", icon: FolderOpen, anyOf: ["files.read"] },
  { href: "/trash", label: "Papierkorb", icon: Trash2, anyOf: ["files.delete"] },
  {
    href: "/shares",
    label: "Meine Links",
    icon: Link2,
    anyOf: ["shares.create", "shares.manage", "downloads.create", "downloads.manage"],
    aliases: ["/downloads"],
  },
  { href: "/admin", label: "Übersicht", icon: Shield, anyOf: ["system.view"] },
  { href: "/admin/users", label: "Benutzer", icon: Users, anyOf: ["users.view"] },
  { href: "/admin/storage", label: "Speicher", icon: HardDrive, anyOf: ["system.view"] },
  {
    href: "/admin/links",
    label: "Links",
    icon: Link2,
    anyOf: ["shares.manage", "downloads.manage"],
  },
  { href: "/admin/audit", label: "Audit-Log", icon: ClipboardList, anyOf: ["audit.view"] },
  { href: "/admin/system", label: "System", icon: Shield, anyOf: ["system.view"] },
  { href: "/settings", label: "Einstellungen", icon: Settings, anyOf: ["files.read"] },
];

export function AppShell({ children, user }: { children: ReactNode; user: SessionUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const items = NAV.filter((item) => userHasAnyPermission(user, item.anyOf));
  const mainNav = items.filter((i) => !i.href.startsWith("/admin"));
  const adminNav = items.filter((i) => i.href.startsWith("/admin"));

  return (
    <TransferProvider>
    <div className="app-shell relative flex h-dvh overflow-hidden bg-background">
      <UiAtmosphere />
      <aside
        className={cn(
          "app-sidebar fixed inset-y-0 left-0 z-40 flex h-dvh shrink-0 flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground backdrop-blur-md transition-transform lg:static lg:inset-auto lg:h-auto lg:self-stretch lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex shrink-0 items-center gap-3 px-4 py-5">
          <LogoLockup />
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {mainNav.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={navActive(pathname, item.href, item.aliases)}
            />
          ))}
          {adminNav.length ? (
            <>
              <p className="cloudora-section mt-5 px-3 pb-2">Administration</p>
              {adminNav.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={pathname === item.href}
                />
              ))}
            </>
          ) : null}
        </nav>
        <TransferSidebar />
        <div className="app-sidebar-footer shrink-0 space-y-2 border-t p-3">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-[var(--ui-radius)] border border-primary/40 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-muted hover:border-primary hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" />
            Suche
            <kbd className="ml-auto hidden text-[10px] text-sidebar-muted sm:inline">⌘K</kbd>
          </button>
          <p className="px-1 text-[10px] text-sidebar-muted">
            {user.username} · {user.role.name}
          </p>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-sidebar-muted hover:text-primary"
          >
            <LogOut className="h-3.5 w-3.5" />
            Abmelden
          </button>
          <p className="px-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">v{APP_VERSION}</p>
        </div>
      </aside>
      {open ? <button className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} /> : null}
      <div className="app-main relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-20 flex items-center gap-3 bg-background/80 px-4 py-3 backdrop-blur-md lg:hidden">
          <Button variant="outline" size="icon" onClick={() => setOpen(true)}>
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
          <LogoLockup compact />
        </header>
        <main className="flex-1 p-3 md:p-6">{children}</main>
      </div>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} user={user} />
    </div>
    </TransferProvider>
  );
}

function navActive(pathname: string, href: string, aliases?: string[]) {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  return Boolean(aliases?.some((alias) => pathname === alias || pathname.startsWith(`${alias}/`)));
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "app-nav-link flex min-h-11 items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors lg:min-h-0",
        active ? "cloudora-nav-active" : "text-sidebar-muted hover:bg-primary/10 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{label}</span>
    </Link>
  );
}
