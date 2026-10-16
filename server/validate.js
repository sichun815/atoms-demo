const MAX_HTML_BYTES = 200 * 1024;

/**
 * 就地修复一类常见的生成缺陷：状态快照在状态被修改之后才保存，
 * 导致「撤销」恢复到错误的棋盘。
 *
 * 典型形态（2048 等棋盘游戏）：
 *   board[pos.r][pos.c] = merged[j];   // 先改了状态
 *   ...
 *   saveState();                        // 才保存“上一状态”——此时已是新状态
 *
 * 修法：把 saveState() 提前到第一次真正修改状态之前。
 */
function repairLateSnapshot(html) {
  let result = html;
  let repaired = false;

  // 仅在同时出现 saveState 与「移动后写回棋盘」的脚本中处理，避免误伤
  const moveWriteRe = /(\w+)\[(\w+)\.r\]\[\2\.c\]\s*=\s*(\w+)\[(\w+)\];/;
  if (!/\bsaveState\s*\(\s*\)/.test(result) || !moveWriteRe.test(result)) {
    return { html: result, repaired: false };
  }

  // 找到 move( 函数体，在其内部把第一处 saveState() 移到首次写盘之前
  const moveIdx = result.search(/\bfunction\s+move\s*\(/);
  if (moveIdx < 0) return { html: result, repaired: false };

  const bodyStart = result.indexOf("{", moveIdx);
  if (bodyStart < 0) return { html: result, repaired: false };

  // 粗略配对花括号，取出 move 函数体范围
  let depth = 0;
  let bodyEnd = -1;
  for (let i = bodyStart; i < result.length; i += 1) {
    const ch = result[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) { bodyEnd = i; break; }
    }
  }
  if (bodyEnd < 0) return { html: result, repaired: false };

  const body = result.slice(bodyStart, bodyEnd);

  const saveMatch = body.match(/([ \t]*)saveState\s*\(\s*\)\s*;/);
  const writeMatch = body.match(/\w+\[\w+\.r\]\[\w+\.c\]\s*=\s*\w+\[\w+\];/);
  if (!saveMatch || !writeMatch) return { html: result, repaired: false };

  // saveState 已经在首次写盘之前 → 无需修复
  if (saveMatch.index < writeMatch.index) return { html: result, repaired: false };

  const statement = saveMatch[0];
  const withoutSave = body.slice(0, saveMatch.index) + body.slice(saveMatch.index + statement.length);
  // 找到写盘之前最近的“语句边界”，把 saveState 插到那里
  const writeIdxInBody = withoutSave.indexOf(writeMatch[0]);
  if (writeIdxInBody < 0) return { html: result, repaired: false };

  const before = withoutSave.slice(0, writeIdxInBody);
  const lastSemi = before.lastIndexOf(";");
  const insertAt = lastSemi >= 0 ? lastSemi + 1 : 0;
  const newBody =
    withoutSave.slice(0, insertAt) +
    "\n" + saveMatch[1] + "saveState();" +
    withoutSave.slice(insertAt);

  result = result.slice(0, bodyStart) + newBody + result.slice(bodyEnd);
  repaired = true;
  return { html: result, repaired };
}

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

  const { html: fixed, repaired } = repairLateSnapshot(html);
  if (repaired) {
    console.log("[validate] 修复了「先改状态后存快照」的撤销缺陷");
  }
  return { html: fixed, repaired };
}
