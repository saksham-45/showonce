"use client";

// Rating pips: five CSS diamonds, filled to the skill's best rating.
// Geometry, not glyphs — no icon font needed for a 1–5 scale.

export default function Rating({ value, label }: { value: number; label?: string }) {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="pips" role="img" aria-label={label ?? `Rated ${filled} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={n <= filled ? "on" : ""} />
      ))}
    </span>
  );
}
