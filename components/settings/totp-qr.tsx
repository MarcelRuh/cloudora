"use client";

import { useEffect, useState } from "react";

export function TotpQr({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("qrcode")
      .then((mod) =>
        mod.toDataURL(value, {
          width: 192,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#0a0a0f", light: "#ffffff" },
        }),
      )
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!src) {
    return <div className="h-48 w-48 rounded-lg bg-white/10" aria-hidden />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="QR-Code für die Authenticator-App" className="h-48 w-48 rounded-lg bg-white p-2" />
  );
}
