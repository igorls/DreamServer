import { invoke } from "@tauri-apps/api/core";

export interface EnvConfig {
  ollama_port: number;
  whisper_port: number;
  llm_backend: string;
  llm_api_url: string;
}

let cachedConfig: EnvConfig | null = null;

export async function fetchEnvConfig(): Promise<EnvConfig> {
  if (cachedConfig) return cachedConfig;

  try {
    const config = await invoke<EnvConfig>("get_env_config");
    cachedConfig = config;
    return config;
  } catch (err) {
    console.error("Failed to fetch env config from backend:", err);
    // Fallback defaults
    return {
      ollama_port: 11434,
      whisper_port: 9000,
      llm_backend: "llamacpp",
      llm_api_url: "http://localhost:8080/v1",
    };
  }
}
