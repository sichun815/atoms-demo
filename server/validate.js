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

/**
 * 修复另一类常见缺陷：分数在快照之前就被修改。
 *
 * 典型形态（2048 等棋盘游戏）：
 *   function slideRowLeft(row) { ... score += merged; ... }  // 移动过程中先加分
 *   function moveLeft() { slideRowLeft(...); ... saveState(); } // 后存快照
 * 结果：撤销时恢复的 score 是“加分之后”的值，分数永远不回退。
 *
 * 修法（确定性、与变量命名无关）：
 *   1. 在含 saveState() 的移动函数体最前面记录 const __atomsPreScore = <score>;
 *   2. 把 saveState(); 替换为
 *      { const __atomsCur = <score>; <score> = __atomsPreScore; saveState(); <score> = __atomsCur; }
 *   这样快照里的 score 是移动前的值，而移动本身的分数逻辑保持不变。
 */
function repairScoreSnapshot(html) {
  let result = html;
  let repaired = false;

  // 从 saveState 定义中提取分数变量名（形如 score: score）
  const saveStateIdx = result.search(/\bfunction\s+saveState\s*\(/);
  if (saveStateIdx < 0) return { html: result, repaired: false };

  const ssBodyStart = result.indexOf("{", saveStateIdx);
  if (ssBodyStart < 0) return { html: result, repaired: false };

  let ssDepth = 0;
  let ssBodyEnd = -1;
  for (let i = ssBodyStart; i < result.length; i += 1) {
    const ch = result[i];
    if (ch === "{") ssDepth += 1;
    else if (ch === "}") {
      ssDepth -= 1;
      if (ssDepth === 0) { ssBodyEnd = i; break; }
    }
  }
  if (ssBodyEnd < 0) return { html: result, repaired: false };

  const saveStateBody = result.slice(ssBodyStart, ssBodyEnd);
  // 优先匹配 score 字段（如 score: score / score: currentScore）；退化为对象里任意 “xx: xx” 的值名不可取
  let scoreName = null;
  const scoreField = saveStateBody.match(/(\w*[sS]core\w*)\s*:\s*([A-Za-z_$][\w$]*)/);
  if (scoreField) {
    scoreName = scoreField[2];
  } else {
    // saveState 里若直接引用某个分数变量（无对象字面量），取第一个像分数的标识符
    const bare = saveStateBody.match(/\b(\w*[sS]core\w*)\b/);
    if (bare) scoreName = bare[1];
  }
  if (!scoreName || !/^[A-Za-z_$][\w$]*$/.test(scoreName)) return { html: result, repaired: false };

  // 遍历所有「函数体内含 saveState() 且此前修改过分数」的函数
  const fnRe = /function\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let match;
  while ((match = fnRe.exec(result)) !== null) {
    const bodyStart = match.index + match[0].length - 1;
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
    if (bodyEnd < 0) continue;

    const body = result.slice(bodyStart, bodyEnd);
    const saveCall = body.match(/\bsaveState\s*\(\s*\)\s*;/);
    if (!saveCall) continue;

    // 分数在本函数内、saveState 之前被修改？(slideXxx 内部改分也算，因为调用发生在本函数内)
    const beforeSave = body.slice(0, saveCall.index);
    const scoreMutated =
      new RegExp(`\\b${scoreName}\\s*(\\+=|-=|=[^=])`).test(beforeSave) ||
      new RegExp(`\\b${scoreName}\\s*(\\+\\+|--)`).test(beforeSave) ||
      // 分数在被调用的子函数（slideRowXxx 等）里改：检测把 board 行/列传入已知会改分的函数
      new RegExp(`\\bslide\\w*\\s*\\(`).test(beforeSave);
    if (!scoreMutated) continue;

    // 已有保护（例如本函数开头已经有 __atomsPreScore）→ 跳过
    if (body.includes("__atomsPreScore")) continue;

    const indentMatch = body.match(/\n([ \t]*)/);
    const indent = indentMatch ? indentMatch[1] : "      ";

    // body[0] 是函数体的 "{"，常量必须插到它后面（函数体内部）
    const inner = body.slice(1);
    const patched =
      "{" +
      "\n" + indent + `const __atomsPreScore = ${scoreName};` +
      inner.slice(0, saveCall.index - 1) +
      `{ const __atomsCur = ${scoreName}; ${scoreName} = __atomsPreScore; saveState(); ${scoreName} = __atomsCur; }` +
      inner.slice(saveCall.index - 1 + saveCall[0].length);

    result = result.slice(0, bodyStart) + patched + result.slice(bodyEnd);
    repaired = true;
    // 重新开始扫描（字符串已变化）
    fnRe.lastIndex = 0;
  }

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

  const first = repairLateSnapshot(html);
  const second = repairScoreSnapshot(first.html);
  const repaired = first.repaired || second.repaired;
  if (first.repaired) {
    console.log("[validate] 修复了「先改状态后存快照」的撤销缺陷");
  }
  if (second.repaired) {
    console.log("[validate] 修复了「分数先变、快照后存」的撤销缺陷");
  }
  return { html: second.html, repaired };
}
