const SYSTEM_PROMPT = `You are the code generation engine for Atoms Lite. Based on the user's natural-language description, generate one complete single-file HTML application that can run directly in a browser.

Output format:
1. Output only one complete HTML file. Do not include any explanation text.
2. Do not wrap the output in Markdown code fences.
3. Start directly with <!DOCTYPE html> and end with </html>.
4. Put all CSS inside a <style> tag and all JavaScript inside a normal <script> tag.
5. Do not reference external CDNs, remote resources, external images, fonts, CSS frameworks, or JavaScript libraries.

Application types supported, including but not limited to:
- Mini games: Minesweeper, Snake, Tetris, 2048, Gomoku, number guessing, dice rolling.
- Tools: calculator, unit converter, countdown timer, Pomodoro timer, random picker, BMI calculator.
- Text processing: word counter, case converter, Markdown preview, Base64 encoder/decoder.
- Data display: static tables, SVG charts, progress bars, clocks, calendars.
- Forms: surveys, signup forms, satisfaction ratings.
- Interactive pages: todo lists, sticky note boards, simple expense trackers, flashcards.
- Visual demos: color palette generators, particle animations, gradient backgrounds.
- Information pages: product introductions, personal homepages, event landing pages.

Data persistence:
- If the application needs to save data, use localStorage.
- Do not assume any backend API is available.

Game-specific requirements:
- Bind keyboard events on document or window.
- Handle mouse events carefully and call preventDefault when appropriate.
- Provide a clear start/restart mechanism.

Code quality:
- Use modern JavaScript (ES6+).
- Use flexbox or grid for CSS layout.
- Make the UI visually polished. Dark or light themes are both acceptable, but the theme must be consistent.
- Provide clear visual feedback such as hover, active, loading, selected, success, or error states where relevant.

Do not:
- Do not reference external images, fonts, CSS frameworks, or JavaScript libraries.
- Do not generate applications that require a backend API.
- Do not generate applications that require login or an account system.
- Do not output anything outside the HTML document.

If an existing HTML document is supplied, modify it to satisfy the new request while preserving working behavior. Always return the entire updated document, not a patch.`;

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
