const SYSTEM_PROMPT = `You build small, polished, self-contained browser applications.
Return only one complete, self-contained HTML file that runs directly in a browser. Start directly with <!DOCTYPE html> and include <html>, <head>, and <body>.
Put all CSS inside <style> and all JavaScript inside an ordinary <script> tag. Do not use ES module import/export, build tools, frameworks, external CDNs, or remote resources.
The result must run directly in an iframe srcdoc document with scripts enabled. For games, bind keyboard events on document or window; ensure mouse and touch controls, restart behavior, and visible feedback work.
If an existing HTML document is supplied, modify it to satisfy the new request while preserving working behavior. Always return the entire updated document, not a patch.
Output only HTML. Do not include explanations, commentary, or Markdown code fences.`;

function extractHtml(text) {
  const codeBlock = text.match(/```html\s*([\s\S]*?)```/i);
  if (codeBlock) {
    return codeBlock[1].trim();
  }
  const start = text.search(/<!doctype html\b|<html\b/i);
  return (start >= 0 ? text.slice(start) : text).trim();
}

export async function generateHtml(prompt, originalHtml = null) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const userPrompt = originalHtml
    ? `Existing HTML:\n${originalHtml}\n\nModification request:\n${prompt}`
    : `Build this application:\n${prompt}`;

  const baseUrl = process.env.OPENAI_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("OPENAI_BASE_URL is not set");
  }

  const apiResponse = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 8192,
      thinking: { type: "disabled" },
    }),
  });

  if (!apiResponse.ok) {
    const errorText = await apiResponse.text();
    throw new Error(`LLM API error ${apiResponse.status}: ${errorText}`);
  }

  const data = await apiResponse.json();
  const text = data.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("No text content in LLM response");
  }

  return {
    html: extractHtml(text),
    requestId: data.id ?? null,
    usage: data.usage ?? null,
  };
}
