import { Suspense } from "react";
import { UsersAdmin } from "@/components/admin/users-admin";

export default function UsersPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Lade Benutzer…</p>}>
      <UsersAdmin />
    </Suspense>
  );
}
