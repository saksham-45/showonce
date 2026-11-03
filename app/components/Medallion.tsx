"use client";

// Badge medallion: a solid coin in the badge's tier color, ice ring when
// earned, dimmed when locked. The mark is set in the display face.

import type { BadgeDef } from "@/lib/progress";

const MARKS: Record<string, string> = {
  "first-light": "FL",
  "full-circuit": "FC",
  "clean-run": "CR",
  "quick-study": "QS",
  "triple-threat": "TT",
  "masters-mark": "MM",
};

export default function Medallion({ badge, earned }: { badge: BadgeDef; earned: boolean }) {
  const gold = badge.id === "masters-mark";
  return (
    <div className={`medallion${earned ? "" : " locked"}${gold && earned ? " gold" : ""}`}>
      <div className="coin" aria-hidden="true">
        {MARKS[badge.id] ?? "SO"}
      </div>
      <h3>{badge.name}</h3>
      <p>{badge.desc}</p>
      <p className="bonus">+{badge.bonus} pts{earned ? " · earned" : " · locked"}</p>
    </div>
  );
}
