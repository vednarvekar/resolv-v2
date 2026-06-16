export interface GenerateFixOptions {
  prompt: string;
  apiKey: string;
  model: string;
}

export async function generateFix(
  options: GenerateFixOptions
): Promise<string> {

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          {
            role: "user",
            content: options.prompt
          }
        ]
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `LLM request failed: ${response.status}`
    );
  }

  const data = await response.json();

  return (
    data.choices?.[0]?.message?.content ?? ""
  );
}