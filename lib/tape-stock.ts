export type TapeStockPreset = {
  group: string;
  product: string;
  quantity: number;
};

export const TAPE_GROUP_NOTE_PREFIX = "[TAPE_GROUP:";

export function buildTapeGroupNotes(group: string, notes?: string | null): string {
  const marker = `${TAPE_GROUP_NOTE_PREFIX}${group}]`;
  const clean = (notes || "").trim();
  if (!clean) return marker;
  if (clean.includes(marker)) return clean;
  return `${marker} ${clean}`.trim();
}

export function extractTapeGroupFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = notes.match(/\[TAPE_GROUP:([^\]]+)\]/);
  return match?.[1]?.trim() || null;
}

export const TAPE_STOCK_PRESETS: TapeStockPreset[] = [
  { group: "Acma Bandi", product: "Adalya 3 mm X 8000m.", quantity: 0 },
  { group: "Acma Bandi", product: "Gold 2 mm", quantity: 98 },
  { group: "Acma Bandi", product: "Gold Line 2 mm", quantity: 264 },
  { group: "Acma Bandi", product: "Gumus 2 mm", quantity: 131 },
  { group: "Acma Bandi", product: "Kirmizi 2 mm", quantity: 2726 },
  { group: "Acma Bandi", product: "Kirmizi 4 mm", quantity: 187 },
  { group: "Acma Bandi", product: "Seffaf 2 mm", quantity: 1831 },
  { group: "Acma Bandi", product: "Seffaf 4 mm", quantity: 165 },

  { group: "Kapak Banti", product: "Kapak bandi Metalize Antistatik", quantity: 141 },
  { group: "Kapak Banti", product: "Kargo bandi 750m.", quantity: 11 },
  { group: "Kapak Banti", product: "Kargo Bandi Gofrajli", quantity: 562 },
  { group: "Kapak Banti", product: "Kargo Banti", quantity: -1 },
  { group: "Kapak Banti", product: "Kargo Banti Metalize 750m.", quantity: 27 },
  { group: "Kapak Banti", product: "OPP Antistatik GENIS Sag", quantity: 0 },
  { group: "Kapak Banti", product: "OPP Antistatik Sag", quantity: 1 },
  { group: "Kapak Banti", product: "OPP Antistatik Sag MINI", quantity: 24 },
  { group: "Kapak Banti", product: "OPP Antistatik Sol", quantity: 117 },
  { group: "Kapak Banti", product: "OPP Antistatik Sol MINI", quantity: 110 },
  { group: "Kapak Banti", product: "OPP Eko Sag", quantity: 162 },
  { group: "Kapak Banti", product: "OPP Eko Sol", quantity: 4 },
  { group: "Kapak Banti", product: "OPP GENIS Sag", quantity: 52 },
  { group: "Kapak Banti", product: "OPP GENIS Sol", quantity: 15 },
  { group: "Kapak Banti", product: "OPP MINI Sag", quantity: 2 },
  { group: "Kapak Banti", product: "OPP MINI SOL", quantity: 46 },
  { group: "Kapak Banti", product: "OPP Sag", quantity: 714 },
  { group: "Kapak Banti", product: "OPP Sol", quantity: 3 },
  { group: "Kapak Banti", product: "PE Antistatik Sag", quantity: 73 },
  { group: "Kapak Banti", product: "PE Antistatik Sol", quantity: 11 },
  { group: "Kapak Banti", product: "PE GENIS Antistatik Sag", quantity: 42 },
  { group: "Kapak Banti", product: "PE GENIS Sag", quantity: 225 },
  { group: "Kapak Banti", product: "PE GENIS Sol", quantity: 293 },
  { group: "Kapak Banti", product: "PE Sag", quantity: 339 },
  { group: "Kapak Banti", product: "PE Sol", quantity: 116 },

  { group: "Silikonlu Film", product: "20 mm Silikonlu Metalize", quantity: 20760 },
  { group: "Silikonlu Film", product: "20 mm Silikonlu OPP", quantity: 91380 },
  { group: "Silikonlu Film", product: "20 mm Silikonlu PE", quantity: 0 },
  { group: "Silikonlu Film", product: "20 mm Silikonlu SEDEF", quantity: 22860 },
  { group: "Silikonlu Film", product: "500 mm Silikonlu OPP", quantity: 0 },
  { group: "Silikonlu Film", product: "520 mm Silikonlu Metalize", quantity: 50860 },
  { group: "Silikonlu Film", product: "520 mm Silikonlu OPP", quantity: 35572 },

  { group: "Tutkal", product: "TUTKAL CU5005-TURUNCU", quantity: 25 },
  { group: "Tutkal", product: "TUTKAL CU5006-KIRMIZI", quantity: 0 },
];

export function getTapePresetGroups(): string[] {
  return Array.from(new Set(TAPE_STOCK_PRESETS.map((p) => p.group))).sort();
}

export function getTapeProductsByGroup(group: string): TapeStockPreset[] {
  return TAPE_STOCK_PRESETS.filter((p) => p.group === group);
}
