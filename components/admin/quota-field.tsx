"use client";

import { useEffect, useState } from "react";
import { Input, Label, Select } from "@/components/ui/input";
import { bytesFromQuota, splitQuotaBytes, type QuotaUnit } from "@/lib/format";

export function QuotaField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (bytes: number | null) => void;
}) {
  const initial = splitQuotaBytes(value);
  const [amount, setAmount] = useState(initial.amount);
  const [unit, setUnit] = useState<QuotaUnit>(initial.unit);

  useEffect(() => {
    const next = splitQuotaBytes(value);
    setAmount(next.amount);
    setUnit(next.unit);
  }, [value]);

  function emit(nextAmount: string, nextUnit: QuotaUnit) {
    const n = Number(nextAmount.replace(",", "."));
    if (nextAmount.trim() === "" || !Number.isFinite(n)) {
      onChange(null);
      return;
    }
    onChange(bytesFromQuota(n, nextUnit));
  }

  return (
    <div className="space-y-1.5">
      <Label>Speicherlimit</Label>
      <div className="flex gap-2">
        <Input
          inputMode="decimal"
          placeholder="unbegrenzt"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            emit(e.target.value, unit);
          }}
        />
        <Select
          className="w-24"
          value={unit}
          onChange={(e) => {
            const next = e.target.value as QuotaUnit;
            setUnit(next);
            emit(amount, next);
          }}
        >
          <option value="MB">MB</option>
          <option value="GB">GB</option>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">Leer = unbegrenzt.</p>
    </div>
  );
}
