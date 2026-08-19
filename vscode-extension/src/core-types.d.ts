/** Typy wyniku rdzenia — lustrzane wobec core/src/core.ts (bez importu spoza rootDir). */
export interface AnalyzeReturn {
  image: { format: string; width: number; height: number };
  result: {
    width: number; height: number; megapixels: number;
    orientation: string; aspectRatio: number; aspectDeviationPct: number;
    aspectWarning: boolean;
    formats: { paper: string; dpi: number; capped: boolean; verdict: string }[];
    recommendedMax: string | null; recommendedMaxVerdict: string | null;
    closeViewingMax: string | null; score: number; scoreBreakdown: string;
  };
}
