# Atoms Lite

用自然语言描述需求，AI 生成可运行的网页应用。对标 [Atoms.dev](https://atoms.dev) 的核心体验。

## 在线 Demo

https://atoms-demo-production-6135.up.railway.app

## 一句话介绍

用户在左侧输入自然语言需求（如“做一个扫雷游戏”），后端调用 LLM 生成一个完整的单文件 HTML 应用，前端通过 iframe 沙箱实时渲染，用户可以直接在页面上玩或使用生成的应用。

## 核心功能

### 1. 自然语言生成

- 输入任意自然语言描述（游戏、工具、表单、互动页面等）。
- LLM（Kimi k2.6）生成完整的单文件 HTML 应用。
- 生成的代码全部内联（CSS + JS），无外部依赖。

### 2. 实时预览与沙箱隔离

- 生成的应用通过 iframe `srcdoc` 渲染。
- 沙箱配置 `allow-scripts allow-forms allow-modals allow-popups`。
- 生成代码无法访问父页面，安全隔离。

### 3. 数据持久化

- 使用 Supabase Postgres 存储所有生成记录。
- 历史记录跨会话保留，重新部署不影响数据。
- 单表 `generations`，字段包含 `id`、`prompt`、`html`、`status`、`parent_id`、`created_at` 等。

### 4. 历史记录管理

- 左栏显示最近 5 条生成记录。
- History 页面显示历史记录。
- 支持删除单条记录。
- 点击历史记录可重新打开预览。

### 5. 修改需求（迭代生成）

- 对已生成的应用可以继续追加需求。
- 后端基于 `parentId` 追溯生成来源。
- 每次修改创建一条新记录，形成版本链。

### 6. 代码查看

- 右栏显示生成的完整 HTML 源码。
- 支持复制代码、全屏预览。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 (CDN) + Tailwind CSS (CDN) + Babel Standalone |
| 后端 | Node.js 24 原生 `http` 模块（无 Express） |
| 数据库 | Supabase Postgres（`pg` 驱动，连接池 + SSL） |
| LLM | Kimi API（`kimi-k2.6`，OpenAI 兼容接口） |
| 部署 | Railway |
| 版本控制 | Git + GitHub |

## 项目结构

```text
atoms-demo/
├── server/
│   ├── index.js       # HTTP 服务 + 6 个 REST API
│   ├── db.js          # Supabase Postgres 数据访问层
│   ├── llm.js         # Kimi API 调用 + system prompt + HTML 提取
│   └── validate.js    # 生成结果校验
├── index.html         # 单文件前端（React + Tailwind CDN）
├── package.json
├── .env.example
└── docs/
    └── DESIGN.md      # 详细设计文档
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/generations` | 创建生成任务 |
| GET | `/api/generations` | 列出历史记录 |
| GET | `/api/generations/:id` | 获取单条记录 |
| POST | `/api/generations/:id/retry` | 重试生成 |
| DELETE | `/api/generations/:id` | 删除记录 |

## 本地运行

```bash
# 1. 克隆仓库
git clone https://github.com/sichun815/atoms-demo.git
cd atoms-demo

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入：
#   OPENAI_API_KEY=<你的 Kimi API key>
#   OPENAI_BASE_URL=https://api.moonshot.cn/v1
#   OPENAI_MODEL=kimi-k2.6
#   DATABASE_URL=<你的 Supabase Postgres Session Pooler 连接串>
#   PORT=3002（本地前端的 API 地址固定为 3002）

# 3. 安装依赖
npm install

# 4. 启动服务（Node.js 24）
node --env-file=.env server/index.js

# 5. 在浏览器打开 http://localhost:3002
```

### 数据库初始化

在 Supabase SQL Editor 执行：

```sql
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  html TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  parent_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_generations_created_at
  ON generations(created_at DESC);
```

## 已知限制

- **单文件应用**：不支持多文件项目（如完整 React/Vue 工程）或生成应用所需的后端 API。
- **生成质量波动**：复杂图形化需求可能不稳定，重新生成可能改善结果。
- **无用户系统**：所有生成记录共享，无登录或账号隔离。
- **无流式输出**：生成过程不可见，用户需要等待生成完成。

## 进一步扩展方向

见 [设计文档](docs/DESIGN.md) 第 4 节。

## License

MIT
