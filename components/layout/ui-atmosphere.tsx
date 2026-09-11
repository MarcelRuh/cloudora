export function UiAtmosphere() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        className="cloudora-orb"
        style={{
          top: "-8%",
          left: "-6%",
          width: 420,
          height: 420,
          background: "radial-gradient(circle, color-mix(in srgb, var(--cloudora-pink) 55%, transparent), transparent 70%)",
        }}
      />
      <div
        className="cloudora-orb"
        style={{
          bottom: "-12%",
          right: "-8%",
          width: 480,
          height: 480,
          background: "radial-gradient(circle, color-mix(in srgb, var(--cloudora-blue) 40%, transparent), transparent 70%)",
          animationDelay: "-4s",
        }}
      />
      <div
        className="cloudora-orb"
        style={{
          top: "38%",
          right: "18%",
          width: 280,
          height: 280,
          background: "radial-gradient(circle, color-mix(in srgb, var(--cloudora-purple) 35%, transparent), transparent 70%)",
          animationDelay: "-7s",
        }}
      />
    </div>
  );
}
