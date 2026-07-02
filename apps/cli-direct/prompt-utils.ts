import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

export interface EscapableSecretPromptResult {
  value: string;
  escaped: boolean;
}

export async function promptEscapableSecret(message: string): Promise<EscapableSecretPromptResult> {
  return await new Promise((resolve) => {
    const rl = readline.createInterface({
      input,
      output,
      terminal: true,
    });

    const originalRawMode = input.isTTY ? input.isRaw : undefined;
    if (input.isTTY && typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }

    let value = "";
    process.stdout.write(message);

    const cleanup = (escaped: boolean) => {
      rl.close();
      if (input.isTTY && typeof input.setRawMode === "function" && originalRawMode !== undefined) {
        input.setRawMode(originalRawMode);
      } else if (input.isTTY && typeof input.setRawMode === "function") {
        input.setRawMode(false);
      }
      process.stdout.write("\n");
      resolve({ value, escaped });
    };

    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 27) {
          input.off("data", onData);
          cleanup(true);
          return;
        }
        if (byte === 3) {
          input.off("data", onData);
          cleanup(true);
          return;
        }
        if (byte === 13 || byte === 10) {
          input.off("data", onData);
          cleanup(false);
          return;
        }
        if (byte === 127 || byte === 8) {
          value = value.slice(0, -1);
          continue;
        }
        value += String.fromCharCode(byte);
      }
    };

    input.on("data", onData);
  });
}
