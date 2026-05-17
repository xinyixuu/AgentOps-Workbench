# AgentOps Studio

AgentOps Studio 是一个面向 AI Agent 应用开发的可视化编排与调试平台。项目提供应用管理、React Flow 工作流编辑器、RAG 知识库、Skill 工具系统和 AI 调试中心，用于把 LLM、知识库、工具调用和人工输入组织成可运行、可调试、可沉淀的 AI 工作流。

## 当前功能

### 应用与工作流编排

- 应用管理：创建、编辑、发布、取消发布和删除应用。
- 可视化工作流：基于 React Flow 编辑节点和连线。
- 支持节点：开始、用户输入、LLM、RAG 检索、条件分支、Skill 工具、输出。
- 工作流运行：后端根据 nodes / edges 构建执行图，支持普通运行和 SSE 流式状态回传。
- 默认示例：seed 会创建一个「默认RAG演示应用」和「默认RAG工作流」。

### RAG 知识库

- 知识库 CRUD。
- 文档上传、文本切片、chunk 存储和检索。
- 知识库配置：embedding model、chunk size、chunk overlap、topK、similarity threshold。
- 调试中心可关联知识库进行 AI 聊天，并展示参考文档片段。

### Skill 与 MCP

- Skill 模块支持内置工具和自定义工具。
- 当前内置 Skill：时间、HTTP 请求、JSON parse/stringify、正则匹配。
- 工作流中的 Skill 节点可调用工具执行结果。
- MCP 模块提供工具发现和调用示例，目前包含 echo / calculator 等轻量示例能力。

### AI 调试中心

- AI Chat：支持普通聊天、RAG 关联知识库、会话历史。
- Workflow Debug：选择应用工作流并运行，查看节点执行反馈。
- 支持 SSE 返回流式执行状态，前端通过 `eventsource-parser` 解析。

### 用户与数据

- JWT 登录鉴权。
- Prisma ORM + SQLite 数据库。
- 统一响应拦截器、全局异常过滤器、全局 ValidationPipe。
- 默认演示账号：`admin / admin123`。

## 技术栈

### 前端

- React 18 + Vite
- React Router v6
- Zustand
- Ant Design
- React Flow
- Axios
- eventsource-parser

### 后端

- NestJS
- Prisma ORM
- SQLite
- JWT + Passport
- class-validator / class-transformer
- Qwen-compatible Chat API
- Server-Sent Events

## 目录结构

```text
.
├── agentops-studio-frontend
│   ├── src/components          # 布局组件、工作流画布和节点组件
│   ├── src/pages               # 工作台、编辑器、知识库、工具、调试页面
│   ├── src/router              # 路由和鉴权守卫
│   ├── src/store               # Zustand store slices
│   └── src/types               # 前端类型定义
├── agentops-studio-backend
│   ├── prisma                  # Prisma schema、SQLite dev.db、seed
│   └── src
│       ├── common              # Guard、decorator、filter、interceptor、Prisma service
│       ├── config              # 环境配置
│       └── modules             # user、app、workflow、rag、skill、mcp、ai
└── knowledge                   # Obsidian 项目知识库
```

## 快速开始

### 环境要求

- Node.js 18+
- npm 9+

### 1. 启动后端

```bash
cd agentops-studio-backend
npm install
cp .env.example .env
npx prisma db push
npx prisma db seed
npm run start:dev
```

后端默认运行在：

```text
http://localhost:3000
```

`.env` 关键配置：

```env
PORT=3000
DATABASE_URL="file:./dev.db"
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=7d
QWEN_API_KEY=your-api-key
QWEN_BASE_URL=https://api.silra.cn/v1/chat/completions
```

### 2. 启动前端

```bash
cd agentops-studio-frontend
npm install
npm run dev
```

前端默认运行在：

```text
http://localhost:5173
```

Vite 会把 `/api` 代理到：

```text
http://localhost:3000
```

## 默认数据

执行 `npx prisma db seed` 后会写入：

- 默认用户：`admin / admin123`
- 默认知识库：`默认知识库`
- 默认文档：`AgentOps Studio 功能介绍.md`
- 默认应用：`默认RAG演示应用`
- 默认工作流：开始 -> RAG 检索 -> 输出

## 验证路径

### 页面方式

1. 打开 `http://localhost:5173`。
2. 使用 `admin / admin123` 登录。
3. 进入「工作台」，确认存在「默认RAG演示应用」。
4. 进入「知识库」，确认存在「默认知识库」和默认文档。
5. 进入「调试中心」的 AI 聊天，选择默认知识库后提问：

```text
AgentOps Studio 有什么核心特性？
```

### API 方式

```bash
# 登录获取 token
TOKEN=$(curl -s -X POST http://localhost:3000/api/users/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).data.token))")

# 获取知识库
curl -s http://localhost:3000/api/rag/knowledge-bases \
  -H "Authorization: Bearer $TOKEN"

# RAG 检索
curl -s -X POST http://localhost:3000/api/rag/retrieve \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"AgentOps Studio 有什么核心特性？","knowledgeBaseId":"KB_ID","topK":3}'
```

## 常用脚本

### 后端

```bash
cd agentops-studio-backend
npm run build
npm run start:dev
npx prisma validate
npx prisma db push
npx prisma db seed
```

### 前端

```bash
cd agentops-studio-frontend
npm run dev
npm run build
npm run preview
```

## 当前边界

- RAG 当前主要处理文本类上传内容，向量存储使用 JSON 字符串落库。
- MCP 模块目前是示例工具发现/调用能力，尚未与 Skill 系统完全统一为 Tool Registry。
- 工作流已有执行记录模型，但前端 Trace / Step 级可观测性仍可继续增强。
- 前端构建可能出现 chunk size warning，不影响功能运行。
