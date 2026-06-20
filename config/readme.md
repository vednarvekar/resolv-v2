# config

Configuration management for resolv.

## Storage

Config is stored at `~/.config/resolv/config.json` with permissions `600` (owner read/write only). API keys are never written to the source tree.

## Schema

```ts
interface ResolvConfig {
  provider: "anthropic" | "google" | "nim" | "ollama";
  model?: string;
  apiKeys: {
    anthropic?: string;
    google?: string;
    nim?: string;
    // ollama needs no key
  };
  githubToken?: string;
  testCommand: string;      // default: "npm test"
  maxHealAttempts: number;  // default: 4
}
```

## Priority

Config is layered (later overrides earlier):

1. Default values in code
2. `~/.config/resolv/config.json`
3. Environment variables (`RESOLV_PROVIDER`, `ANTHROPIC_API_KEY`, etc.)

This means CI can override via env vars without touching the user's config file.

## Key functions

| Function | Description |
|----------|-------------|
| `loadConfig()` | Load + merge config from file and env |
| `saveConfig(config)` | Write config to `~/.config/resolv/config.json` |
| `isFirstRun()` | True if no config file exists yet |
| `isConfigured(config)` | True if the active provider has a key (or is Ollama) |
| `getActiveApiKey(config)` | Returns the API key for the current provider |
| `PROVIDER_INFO` | Metadata for each provider: label, models, description |