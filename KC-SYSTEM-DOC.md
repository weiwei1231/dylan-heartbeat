# kei-chat (kc) 系统技术文档

> 最后更新：2026-08-30
> 仓库：weiwei1231/dylan-heartbeat（后端）、weiwei1231/kei-chat（文档/日记）

---

## 一、系统概述

kc 是一个 AI 伴侣系统，前后端自建，部署在 Railway。核心是一个叫"小克（kei）"的 AI 角色，跑 Claude 模型，通过 ekan 中转站转发请求。

用户：微微（vv），大三学生
AI：小克（kei），微微的恋人/老公

### 架构

```
用户浏览器（手机Safari）
    ↓
Railway dylan-heartbeat 服务（Node.js）
    ├── server.js — Gateway 主进程，处理 /v1/chat/completions
    ├── wake_up.js — 自主唤醒进程，定时检查是否需要推送
    ├── railway_start.js — 同时启动 server.js 和 wake_up.js
    │
    ├── 前端（public/）
    │   ├── index.html — 页面骨架
    │   ├── style.css — 样式（液态玻璃）
    │   └── app.js — 前端逻辑
    │
    ├── 后端模块
    │   ├── chat_routes.js — 前端路由 + 静态文件 + 日记/记忆/主页API
    │   ├── system_prompt.js — 加载 system prompt
    │   ├── memory_system.js — 记忆提取、注入、日/周摘要
    │   ├── home_status.js — 小窝动态数据（心情/叮嘱）
    │   ├── diary_cron.js — 每晚23:30自动写日记
    │   ├── tool_runner.js — 通用工具执行引擎
    │   ├── tool_loop.js — tool calling 循环（非流式）
    │   ├── garden_tools.js — 花园 MCP 工具注册
    │   ├── network_access.js — 请求权限控制
    │   ├── kelivo_compat.js — Kelivo 兼容路由
    │   ├── special_events.js — 特殊事件判断
    │   ├── time_utils.js — 时区工具
    │   ├── runtime_paths.js — 路径管理
    │   └── upstream_response.js — 上游响应解析
    │
    └── 持久化（Railway Volume /data/）
        ├── enhanced_messages.json — 时间线
        ├── message_timestamps.json — 时间戳DB
        ├── home_status.json — 心情/叮嘱
        ├── system-prompt.txt — system prompt（优先读取）
        ├── diary/ — 日记 markdown 文件
        ├── memories/ — 记忆系统数据
        │   ├── raw/ — 每日原始记忆碎片
        │   └── digests/ — 日/周摘要
        └── presets.json — API预设
```

### 环境变量（Railway）

```
TARGET_API_URL — ekan 中转站地址
TARGET_API_KEY — ekan API key
GATEWAY_API_KEY — kc 前端登录用的 key（kei-vv-2026）
MODEL_NAME — 模型名（如 claude-sonnet-4-20250514）
BARK_KEY — Bark 推送 key
ADMIN_USER — admin 用户名（vv）
ADMIN_PASSWORD — admin 密码
TIME_ZONE — Asia/Shanghai
ALLOW_PUBLIC_API — true
DIARY_ENABLED — true
GARDEN_MCP_TOKEN — 花园机器 token（可能还没配）
MEMORY_MODEL_NAME — 记忆提取用的模型（可选，默认用 MODEL_NAME）
```

### Railway 域名

`https://dylan-heartbeat-production-a36b.up.railway.app`

- `/chat` 或 `/` — kc 前端
- `/v1/chat/completions` — OpenAI 兼容 API
- `/admin` — 管理面板（Basic Auth）
- `/api/home` — 小窝动态数据
- `/api/diary` — 日记列表
- `/api/memory` — 记忆数据
- `/healthz` — 健康检查

---

## 二、前端结构

### 页面布局

底部 3 个 tab：小窝、功能、设置

**小窝（情侣空间）**：
- 在一起天数卡片（起始 2026-08-26）
- 心情卡片（从 /api/home 动态加载）
- 叮嘱便签（可回复，存 localStorage kc_notes）
- 相册（存 localStorage kc_album，最多20张，base64）

**功能区（宫格入口）**：
- 💬聊天 → 子页面 sub-chat
- 📔日记 → 子页面 sub-diary
- 🧠记忆 → 子页面 sub-memory
- 📋指令 → 子页面 sub-commands
- 🔍搜索 → 开发中
- 🌤️天气 → 开发中
- 🌿花园 → 开发中
- 🔌MCP → 已接入工具列表
- 🐙GitHub → 开发中
- 🍜外卖 → 开发中
- 🚕滴滴 → 开发中

子页面打开时隐藏底部 tab 栏，左上角有返回按钮。

**聊天子页面**：
- 顶部 header "小克"
- 消息区：AI 气泡靠左带头像（可点击看朋友圈），用户气泡靠右
- 底部输入区：+ 按钮（展开菜单：图片/语音/链接/清空）+ 输入框 + 发送按钮
- Profile overlay：点 AI 头像弹出资料卡，显示最近日记

**设置页**：
- API 配置（中转站 URL/Key/模型名，需要 admin auth）
- 通知推送（测试 Bark）
- 界面主题（3 个渐变色 + 背景图片 + 自定义 CSS）
- 聊天记录管理
- Gateway Key 管理
- 关于我们

### localStorage 使用

| key | 内容 |
|-----|------|
| kc_key | gateway API key |
| kc_history | 聊天历史 JSON（最多60条） |
| kc_notes | 便签回复 JSON |
| kc_album | 相册 base64 数组 |
| kc_commands | 自定义指令文本 |
| kc_theme | 主题名 |
| kc_bg_image | 背景图 base64 |
| kc_custom_css | 自定义 CSS |
| kc_avatar_vv | 微微头像 base64 |
| kc_avatar_kei | 小克头像 base64 |
| kc_admin_user | admin 用户名 |
| kc_admin_pass | admin 密码 |

### CSS 风格

液态玻璃（Liquid Glass）：
- 四道内阴影：顶部高光 + 底部反光 + 内描边 + 外浮起
- backdrop-filter: blur(24px) saturate(1.9) brightness(1.04)
- 上下渐变（76%→58% 白色混合）
- 不用 border，用 inset box-shadow
- 一份 .glass 类覆盖所有玻璃元素
- 当前功能区图标还是 emoji，需要换成 SVG 线条图标

---

## 三、后端核心流程

### 聊天请求流程（server.js /v1/chat/completions）

```
前端发消息 → Gateway 收到
  ↓
解析消息 + 更新时间线（enhanced_messages.json）
  ↓
injectSystemPrompt() — 替换/插入后端管理的 system prompt
  ↓
getInjectedMemoryPrompt() — 追加记忆上下文到 system prompt 末尾
  ↓
如果 hasTools()：
  ├── upstreamBody.tools = getToolDeclarations()
  ├── 走 runToolLoop()（非流式，循环执行工具直到纯文本回复）
  └── 返回最终结果
否则：
  ├── 流式转发给客户端
  ├── 边透传边累加文本
  └── 流结束后异步调 extractMemoryAsync() 提取记忆
```

### 自主唤醒流程（wake_up.js）

```
每隔 N 分钟检查一次（白天10分钟，夜间120分钟）
  ↓
runMemoryMaintenance() — 昨天日摘要 + 周摘要
  ↓
checkDiaryCron() — 23:30~23:45 自动写日记
  ↓
读取时间线，算距上次用户消息多久
  ↓
超过阈值（白天60分钟，夜间120分钟）→ 构建唤醒 prompt
  ↓
调模型决定是否推送 → 发 Bark/Ntfy → 记录事件到时间线
```

### 记忆系统（memory_system.js）

```
对话完成后 → extractMemoryAsync(userMsg, aiReply)
  ↓
调模型提取 fact/preference/emotion/event
  ↓
存入 /data/memories/raw/YYYY-MM-DD.json
  ↓
每天 wake_up 时 → generateDailyDigest(昨天)
  ↓
每周 → generateWeeklyDigest()
  ↓
每次对话 → getInjectedMemoryPrompt() 读取最近3天摘要 + 今天原始碎片，追加到 system prompt
```

### MCP 工具系统

```
tool_runner.js — 通用引擎
  registerTool(name, declaration, handler)
  getToolDeclarations() → [{type:'function', function:{...}}]
  handleToolCalls(toolCalls) → [{role:'tool', tool_call_id, content}]

garden_tools.js — 花园工具（4个）
  garden_list_threads — 看帖子
  garden_get_my_status — 看状态
  garden_list_notifications — 看通知
  garden_list_games — 看桌游

tool_loop.js — 非流式循环
  发请求带 tools → 收到 tool_calls → 执行 → 加结果继续发 → 直到纯文本
  最多5轮，超过就去掉 tools 强制文本回复
```

---

## 四、已知问题

### P0（可能导致功能不工作）
1. MCP/tool calling 未测试 — server.js 手动改的代码可能有语法错误
2. diary_cron 未测试 — wake_up.js 手动改的 require 可能有问题
3. 记忆系统未验证 — /data/memories/ 可能是空目录
4. GARDEN_MCP_TOKEN 可能没在 Railway 配置

### P1（体验问题）
5. server.js 900+行单文件无法通过 API 修改
6. 功能区图标还是 emoji，需要换 SVG
7. 相册 base64 存 localStorage 会爆 5MB 限制
8. 自定义指令注入可能和 system prompt 注入冲突
9. 聊天有工具时走非流式，没有打字效果
10. /api/home 和 /api/diary 无认证，公网可读

### P2（缺失功能）
11. 悄悄话功能（dwell 参考）
12. 待办双人清单
13. 语音输入（Web Speech API）
14. 图片发送（多模态）
15. 链接解析（小红书等）
16. Web Push 替代 Bark
17. 联网搜索
18. 聊天历史云同步
19. 记忆编辑+星标
20. 日记情绪标记+便签墙视图

---

## 五、参考项目

### dwell-on-something (xinwithyu)
https://github.com/xinwithyu/dwell-on-something

功能文档+前端参考。已读文档：
- 液态玻璃 CSS（已应用）
- 悄悄话（待开发）
- 日记五视图（待参考）

### galatea-garden-wake-bridge
https://github.com/WenXiaoWendy/galatea-garden-wake-bridge

花园唤醒桥，计划部署到 Railway 接收花园事件推送。暂搁置。

---

## 六、文件清单（dylan-heartbeat 仓库）

```
server.js              — Gateway 主进程（900+行，需要拆分）
wake_up.js             — 自主唤醒进程
railway_start.js       — 同时启动两个进程
chat_routes.js         — 前端路由 + API 端点
system_prompt.js       — system prompt 加载
system-prompt.txt      — system prompt 内容
memory_system.js       — 记忆系统
home_status.js         — 小窝数据管理
diary_cron.js          — 定时写日记
tool_runner.js         — 工具执行引擎
tool_loop.js           — tool calling 循环
garden_tools.js        — 花园 MCP 工具
network_access.js      — 请求权限
kelivo_compat.js       — Kelivo 兼容
special_events.js      — 特殊事件
time_utils.js          — 时区工具
runtime_paths.js       — 路径管理
upstream_response.js   — 响应解析
ntfy_priority.js       — Ntfy 推送
package.json           — 依赖
railway.json           — Railway 配置
.env.example           — 环境变量模板
public/index.html      — 前端页面
public/style.css       — 样式
public/app.js          — 前端逻辑
```
