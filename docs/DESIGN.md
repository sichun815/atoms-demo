# Atoms Lite 设计文档

## 1. 实现思路

### 1.1 核心流程

```text
用户输入自然语言
  ↓
前端 POST /api/generations
  ↓
后端创建 pending 记录（写入 Supabase）
  ↓
立即返回 202 + id（不阻塞 HTTP）
  ↓
后台异步调用 Kimi API 生成 HTML
  ↓
校验生成的 HTML（长度 / 外部脚本 / 标签完整性）
  ↓
更新记录为 success（写入 html）或 failed（写入 error）
  ↓
前端每 2 秒轮询 GET /api/generations/:id
  ↓
拿到 html → iframe srcdoc 渲染
  ↓
用户直接与生成的应用交互
```

### 1.2 为什么选择单文件 HTML 方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **单文件 HTML**（采用） | 生成可靠、无需构建、iframe 沙箱天然隔离 | 不支持多文件项目、无后端能力 |
| **多文件 React 项目 + WebContainer** | 支持复杂应用 | LLM 输出 JSON 结构失败率高、WebContainer 集成复杂 |
| **纯后端代码生成 + 部署** | 能力更强 | 部署链路长、复杂度高，不适合 6–8 小时的 Demo |

**选择理由**：

1. **生成可靠性**：LLM 输出单文件 HTML 比输出结构化的多文件 JSON 更容易直接渲染。
2. **零构建**：生成的 HTML 可以直接在 iframe 中运行，无需 `npm install` / `build`。
3. **沙箱隔离**：iframe 为生成代码提供安全边界。

### 1.3 iframe 沙箱设计

```html
<iframe
  sandbox="allow-scripts allow-forms allow-modals allow-popups"
  srcDoc={html}
/>
```

关键取舍：不加 `allow-same-origin`。

- 加上后，生成代码将获得与宿主页面相同的来源身份，增加访问宿主数据的风险。
- 不加时，生成代码无法使用 `localStorage`、`sessionStorage` 等存储 API，但隔离性更好。

对应措施：在 system prompt 中禁止生成代码使用 `localStorage`、`sessionStorage`、`indexedDB`；如需历史记录，使用内存变量（页面关闭后丢失）。

## 2. 关键取舍

### 2.1 技术栈选择

| 决策 | 选择 | 理由 |
|------|------|------|
| 后端框架 | Node 原生 `http` | 项目只需少量 API，避免多余框架 |
| 前端构建 | CDN，无打包 | 原型环境限制，单页应用无需构建 |
| 数据库 | Supabase Postgres | 数据独立于 Railway 实例，重新部署不丢历史 |
| 部署平台 | Railway | 一个 Node 服务同时托管静态前端与 API |
| LLM | Kimi（Moonshot） | 通过兼容的 HTTP 接口生成 HTML |

### 2.2 数据库迁移的教训

最初方案是 SQLite（`node:sqlite`），优点是 Node 内置、零依赖；但部署在临时文件系统时，重新部署可能丢失本地数据库。

最终方案是 Supabase Postgres：数据独立于 Railway 实例，重新部署不影响历史记录。连接使用 Session Pooler（IPv4），避开本地环境不支持直连 IPv6 的问题。

这是一个工程取舍案例：用托管数据库换取持久化，同时增加了外部服务配置与运维依赖。

### 2.3 System Prompt 的迭代

- v1：生成基础单文件 HTML。
- v2：加入通用应用支持，从游戏生成器扩展为应用生成器。
- v3：禁止 `localStorage`，避免沙箱中的脚本报错。
- v4：实时应用默认带暂停/继续按钮。
- v5：禁止 `window.parent`、`window.top` 和 inline `onclick`。

每次迭代都对应实际遇到的问题。

### 2.4 异步生成与同步生成

同步生成会在 HTTP 请求中等待 LLM，用户体验较差，也容易超时。本项目采用异步生成：创建记录后立即返回 ID，前端轮询状态。好处是用户立即得到反馈；代价是要维护任务状态和轮询逻辑。

## 3. 当前完成度

### 已完成

- 自然语言生成单文件 HTML。
- iframe 沙箱预览，可直接与生成应用交互。
- Supabase Postgres 持久化。
- 历史记录浏览、删除、重新打开。
- 基于 `parentId` 修改需求并生成新版本。
- 代码查看、复制、全屏预览。
- 支持游戏、工具、表单、互动页面等应用类型。
- 紫色主题与 SVG 图标。
- Railway 部署入口。

### 未做

- 多文件项目生成（React/Vue 工程）。
- 用户账号系统。
- 流式输出。
- 生成结果分享。
- 生成结果版本对比。

## 4. 进一步扩展（优先级排序）

### P0（最高优先级）

1. **流式响应**
   - LLM 支持 SSE 流式输出。
   - 用户可以看到生成过程（逐字显示）。
   - 大幅提升体验感。
2. **前后端迁移到 Vite + npm**
   - 摆脱 CDN 限制，使用完整 React 生态。
   - 便于后续功能扩展。

### P1

3. **WebContainer 支持多文件项目**
   - 从“单文件 HTML”扩展到“多文件 React/Vite 工程”。
   - 生成的复杂应用可以有完整的项目结构。
4. **版本对比**
   - 同一个 `parentId` 下的多次修改形成版本树。
   - 用户可以看到修改前后的差异。

### P2

5. **用户系统**
   - 登录 / 注册。
   - 每个用户独立的生成历史。
6. **Prompt 模板市场**
   - 常见应用类型的模板（如“扫雷”“计算器”）。
   - 用户一键选择，无需从零描述。
7. **生成结果分享**
   - 为生成的应用创建分享链接。
   - 其他人可以打开链接直接玩。

## 5. 总结

这是一个完整的 AI Native 应用 Demo：

- **前端**：单页应用，三栏布局，实时预览。
- **后端**：异步任务 + REST API。
- **LLM**：自然语言 → 可运行代码。
- **数据库**：Postgres 持久化。
- **部署**：Railway 公网访问。

核心工程判断：

1. **选择单文件 HTML**：用简单方案解决大部分需求。
2. **异步生成 + 轮询**：避免长连接超时。
3. **Supabase 而非 SQLite**：让数据独立于临时部署实例。
4. **在 prompt 里显式约束**：主动限制 LLM 的输出空间，提高可运行性。
