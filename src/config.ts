export interface AppConfig {
  openAIApiKey?: string;
  openAIModel: string;
  useOpenAI: boolean;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const openAIApiKey = environment.OPENAI_API_KEY?.trim();
  const requestedMode = environment.LLM_MODE?.trim().toLowerCase();

  const config: AppConfig = {
    openAIModel: environment.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    useOpenAI: Boolean(openAIApiKey) && requestedMode !== 'mock',
  };
  if (openAIApiKey) {
    config.openAIApiKey = openAIApiKey;
  }
  return config;
}
