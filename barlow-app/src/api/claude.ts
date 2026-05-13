export async function callClaude(
  systemPrompt: string,
  userMessage:  string,
  maxTokens:    number = 4000,
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':                           'application/json',
      'anthropic-version':                      '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-api-key': process.env.REACT_APP_ANTHROPIC_API_KEY ?? '',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text: string }>;
    error?:   { message: string };
  };

  if (data.error) throw new Error(`API error: ${data.error.message}`);
  return data.content?.[0]?.text ?? '';
}
