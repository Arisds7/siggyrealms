"use client";

import LoadingScreen from "@/components/ui/LoadingScreen";

// Next.js App Router convention: this file is automatically displayed when pages in the (game) group are being server-side rendered. Since there is no actual progress data here, use indeterminate mode.
export default function GameLoading() {
  return <LoadingScreen />;
}
