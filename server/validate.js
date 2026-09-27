const MAX_HTML_BYTES = 200 * 1024;

export function validateHtml(html) {
  if (typeof html !== "string" || Buffer.byteLength(html, "utf8") >= MAX_HTML_BYTES) {
    throw new Error("Generated HTML must be smaller than 200 KB");
  }

  if (/<script\b[^>]*\bsrc\s*=\s*["']?https?:\/\//i.test(html)) {
    throw new Error("External HTTP scripts are not allowed");
  }

  if (!/<html\b/i.test(html) || !/<\/html\s*>/i.test(html)) {
    throw new Error("Generated HTML must contain <html> and </html>");
  }
}
