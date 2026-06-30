# config

Configuration management for resolv.

## Storage

Config is stored at `~/.config/resolv/config.json` with permissions `600` (owner read/write only). API keys are never written to the source tree.

## Schema

```ts
interface ResolvConfig {
  provider: "anthropic" | "google" | "nim" | "ollama" | "openai" | "grok" | "openrouter";
  model?: string;
  apiKeys: {
    anthropic?: string;
    google?: string;
    nim?: string;
    openai?: string;
    grok?: string;
    openrouter?: string;
    // ollama needs no key
  };
  githubToken?: string;
  testCommand: string;      // default: "npm test"
  maxHealAttempts: number;  // default: 4
  maxToolCallRounds: number; // default: 24
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
| `PROVIDER_INFO` | Stable provider metadata: label, key env, default model, description |

## Notes

- The active provider and model can be overridden via environment variables.
- Model lists are fetched from providers at runtime; config stores only the selected model.
- Request timeouts are now reset while streaming progress is received, preventing slow model responses from being aborted prematurely.
