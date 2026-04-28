export const DEFAULT_CODEX_MODEL = "gpt5.5-xhigh";

export const FALLBACK_CODEX_MODEL = "gpt5.4-xhigh";

export const DEFAULT_MAX_ITERATIONS: number | null = null;

export function normalizeCodexModel(model: string): {
  model: string;
  modelReasoningEffort?: string;
} {
  if (model === "gpt5.5-xhigh") {
    return { model: "gpt-5.5", modelReasoningEffort: "xhigh" };
  }

  if (model === "gpt5.4-xhigh") {
    return { model: "gpt-5.4", modelReasoningEffort: "xhigh" };
  }

  return { model };
}
