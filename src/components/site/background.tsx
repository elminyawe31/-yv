export function AmbientBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {/* Base */}
      <div className="absolute inset-0 bg-[#070709]" />

      {/* Ambient glows */}
      <div
        className="absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full blur-[120px] animate-pulse-glow"
        style={{
          background:
            "radial-gradient(closest-side, rgba(233,162,59,0.13), rgba(233,162,59,0.04) 60%, transparent)",
        }}
      />
      <div
        className="absolute top-[35%] -right-52 h-[480px] w-[480px] rounded-full blur-[110px] animate-drift"
        style={{
          background:
            "radial-gradient(closest-side, rgba(45,212,167,0.05), transparent 70%)",
        }}
      />
      <div
        className="absolute bottom-[-180px] -left-40 h-[520px] w-[520px] rounded-full blur-[110px] animate-drift"
        style={{
          animationDelay: "-8s",
          background:
            "radial-gradient(closest-side, rgba(184,122,30,0.08), transparent 70%)",
        }}
      />

      {/* Aurora ribbons — slow warm currents (luxury ambience) */}
      <div
        className="absolute top-[12%] left-[8%] h-[340px] w-[620px] rounded-full opacity-60 blur-[130px] animate-drift"
        style={{
          animationDelay: "-14s",
          animationDuration: "34s",
          background:
            "radial-gradient(closest-side, rgba(233,162,59,0.09), rgba(201,138,45,0.03) 55%, transparent)",
        }}
      />
      <div
        className="absolute bottom-[8%] right-[5%] h-[380px] w-[560px] rounded-full opacity-50 blur-[140px] animate-drift"
        style={{
          animationDelay: "-20s",
          animationDuration: "40s",
          background:
            "radial-gradient(closest-side, rgba(255,217,142,0.06), transparent 60%)",
        }}
      />

      {/* Grid */}
      <div className="absolute inset-0 bg-grid" />

      {/* Horizon line */}
      <div
        className="absolute top-0 left-1/2 h-px w-[70%] -translate-x-1/2"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(233,162,59,0.35), transparent)",
        }}
      />

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 120% 90% at 50% 40%, transparent 55%, rgba(0,0,0,0.5) 100%)",
        }}
      />
    </div>
  )
}
