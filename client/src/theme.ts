export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "chat-agent-theme-mode";
export const PROMPT_STORAGE_KEY = "chat-agent-current-prompt";

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === "light" ? "light" : "dark";
}

export function storeTheme(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
}

export function readStoredPrompt(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(PROMPT_STORAGE_KEY) ?? "";
}

export function storePrompt(prompt: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROMPT_STORAGE_KEY, prompt);
}
