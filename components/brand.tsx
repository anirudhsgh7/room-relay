export function BrandMark({
  size = "md",
  tone = "light",
}: {
  size?: "sm" | "md" | "lg";
  tone?: "light" | "dark";
}) {
  const dimensions = {
    sm: "size-8 rounded-[0.65rem]",
    md: "size-10 rounded-xl",
    lg: "size-12 rounded-[0.9rem]",
  }[size];

  return (
    <span
      aria-hidden="true"
      className={`${dimensions} inline-flex shrink-0 items-center justify-center ${
        tone === "light"
          ? "bg-brand-400 text-ink-950 shadow-[0_0_0_1px_rgba(255,255,255,0.15)]"
          : "border border-ink-950/10 bg-ink-950 text-brand-300"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className={size === "sm" ? "size-4" : "size-5"}
      >
        <path
          d="M5.5 19V10.4a6.5 6.5 0 0 1 13 0V19"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <path
          d="M9.25 19v-5.15a2.75 2.75 0 0 1 5.5 0V19"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <path
          d="M3.5 19h17"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function Wordmark({ tone = "dark" }: { tone?: "light" | "dark" }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark tone={tone === "light" ? "light" : "dark"} />
      <span
        className={`text-[1.05rem] font-bold tracking-[-0.025em] ${
          tone === "light" ? "text-white" : "text-ink-950"
        }`}
      >
        Room<span className="text-brand-600">Relay</span>
      </span>
    </span>
  );
}
