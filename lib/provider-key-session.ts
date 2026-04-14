import type { ProviderId } from "@/components/comparator/comparator-data";

export const EMPTY_PROVIDER_KEYS: Record<ProviderId, string> = {
  kanana: "",
  openai: "",
  gemini: "",
  claude: "",
};

const PROVIDER_KEYS_SESSION_KEY = "kanana-llm-comparator.provider-keys";

function normalizeProviderKeys(
  value: Partial<Record<ProviderId, unknown>> | null | undefined,
): Record<ProviderId, string> {
  return {
    kanana: typeof value?.kanana === "string" ? value.kanana : "",
    openai: typeof value?.openai === "string" ? value.openai : "",
    gemini: typeof value?.gemini === "string" ? value.gemini : "",
    claude: typeof value?.claude === "string" ? value.claude : "",
  };
}

export function readSessionProviderKeys(): Record<ProviderId, string> {
  if (typeof window === "undefined") {
    return { ...EMPTY_PROVIDER_KEYS };
  }

  try {
    const raw = window.sessionStorage.getItem(PROVIDER_KEYS_SESSION_KEY);
    if (!raw) {
      return { ...EMPTY_PROVIDER_KEYS };
    }

    return normalizeProviderKeys(
      JSON.parse(raw) as Partial<Record<ProviderId, unknown>>,
    );
  } catch {
    return { ...EMPTY_PROVIDER_KEYS };
  }
}

export function writeSessionProviderKeys(
  keys: Record<ProviderId, string>,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      PROVIDER_KEYS_SESSION_KEY,
      JSON.stringify(normalizeProviderKeys(keys)),
    );
  } catch {
    // Ignore storage failures and keep runtime state in memory.
  }
}
