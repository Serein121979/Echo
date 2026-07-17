export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
type DeepSeekMessage = { role: "system" | "user" | "assistant"; content: string };

export function getDeepSeekKey() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DeepSeek API Key 未配置");
  return key;
}

export async function deepSeekJson<T>(messages: DeepSeekMessage[]) {
  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getDeepSeekKey()}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      stream: false,
      temperature: 0.1,
      max_tokens: 1200,
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek 请求失败 (${response.status})`);
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("DeepSeek 返回了空内容");
  return JSON.parse(content) as T;
}

export async function deepSeekStream(messages: DeepSeekMessage[]) {
  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getDeepSeekKey()}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      thinking: { type: "disabled" },
      stream: true,
      temperature: 0.2,
      max_tokens: 3000,
    }),
  });
  if (!response.ok || !response.body) throw new Error(`DeepSeek 请求失败 (${response.status})`);
  return response.body;
}
