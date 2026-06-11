export const FREEMODEL_BASE_URL = process.env["FREEMODEL_UPSTREAM_BASE_URL"]?.trim().replace(/\/+$/, "") || "https://api.freemodel.dev";
export const FREEMODEL_PROVIDER = "freemodel-openai" as const;

export type FreemodelProvider = typeof FREEMODEL_PROVIDER;

export interface FreemodelEntry {
  id: string;
  provider: FreemodelProvider;
  created: number;
}

export const FREEMODEL_FALLBACK_MODELS: FreemodelEntry[] = [
  { id: "gpt5.5", provider: FREEMODEL_PROVIDER, created: 1749081600 },
];
