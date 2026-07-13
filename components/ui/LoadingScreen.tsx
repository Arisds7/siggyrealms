"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";

const DEFAULT_TIPS = [
  "Every Siggy has a unique consciousness — no two are alike.",
  "Feed your Siggy daily to keep its energy strong.",
  "Battle in the Arena to earn SIG coins and rare rewards.",
  "Each Genesis Crystal holds a dormant entity waiting to emerge.",
  "Game Created By Aris | Universenaga — built on Ritual Network.",
];

interface LoadingScreenProps {
  progress?: number;
  tips?: string[];
}

export default function LoadingScreen({ progress, tips }: LoadingScreenProps) {
  const activeTips = tips && tips.length > 0 ? tips : DEFAULT_TIPS;

  // ── Rotating tip logic ──────────────────────────────────────────────────────
  const [tipIndex, setTipIndex] = useState(0);
  const [tipVisible, setTipVisible] = useState(true);

  useEffect(() => {
    // Set a random initial tip on client mount to avoid server-client mismatch
    setTipIndex(Math.floor(Math.random() * activeTips.length));

    const interval = setInterval(() => {
      // Fade out, change, fade in
      setTipVisible(false);
      setTimeout(() => {
        setTipIndex((i) => (i + 1) % activeTips.length);
        setTipVisible(true);
      }, 400);
    }, 3000);
    return () => clearInterval(interval);
  }, [activeTips.length]);

  // ── Indeterminate progress bar animation ────────────────────────────────────
  // Cycles from 0 → 100 → 0 over ~2.4s when no real progress prop is provided.
  const [indeterminate, setIndeterminate] = useState(0);
  const dirRef = useRef<1 | -1>(1);

  useEffect(() => {
    if (progress !== undefined) return; // skip if real progress provided
    const frame = setInterval(() => {
      setIndeterminate((prev) => {
        const next = prev + dirRef.current * 2;
        if (next >= 100) { dirRef.current = -1; return 100; }
        if (next <= 0)   { dirRef.current =  1; return 0; }
        return next;
      });
    }, 24);
    return () => clearInterval(frame);
  }, [progress]);

  const barWidth = progress !== undefined ? Math.round(progress) : indeterminate;
  const showPercent = progress !== undefined;

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#0d0b14]">
      {/* Full-cover background illustration */}
      <Image
        src="/branding/loading_page.png"
        alt="Siggy Realms — Loading"
        fill
        priority
        className="object-cover"
      />

      {/* Bottom gradient overlay so text stays readable */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 45%, transparent 100%)",
        }}
      />

      {/* Bottom-center: title + rotating tip */}
      <div className="absolute bottom-24 left-0 right-0 flex flex-col items-center gap-2 px-6 text-center">
        <p className="text-white text-2xl font-medium tracking-widest drop-shadow">
          Siggy Realms
        </p>
        <p
          className="text-white/70 text-sm max-w-xs transition-opacity duration-400"
          style={{ opacity: tipVisible ? 1 : 0 }}
        >
          {activeTips[tipIndex]}
        </p>
      </div>

      {/* Bottom-right: progress bar */}
      <div className="absolute bottom-8 right-6 flex flex-col items-end gap-1 w-40">
        {showPercent && (
          <span className="text-white/60 text-xs font-mono">
            {Math.round(progress!)}%
          </span>
        )}
        <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-400 rounded-full transition-all duration-150"
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>
    </div>
  );
}
