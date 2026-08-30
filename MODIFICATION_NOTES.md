# 本次修改说明

按照 Claude 截图中的方案，对完整项目做了整理。

## 1. 统一运行时热读取配置

新增 `env_config.js`：

- 每次调用 `readEnvValue()` 都重新读取项目根目录 `.env`。
- `.env` 中存在的值优先于进程启动时的 `process.env`。
- `.env` 没有该键时才回退到 `process.env`。
- 支持简单引号值和 `\\n`。

这解决 Railway 上“进程启动后修改 `.env`，代码仍拿到旧值”的核心问题。

## 2. 已接入热读取的模块

- `server.js`
  - 聊天请求的 `TARGET_API_URL` / `TARGET_API_KEY` 实时读取。
  - `MODEL_NAME`、`MULTIMODAL_MODE`、`ALLOW_PUBLIC_API` 等实时读取。
  - Admin 用户名/密码、Bark Key 实时读取。
- `chat_routes.js`
  - `MODEL_NAME` 改为实时读取。
  - 日记目录配置改为实时读取。
- `memory_system.js`
  - `MEMORY_MODEL_NAME` / `MODEL_NAME` 实时读取。
  - 上游 URL / Key 实时读取。
  - 记忆相关数字配置实时读取。
- `wake_up.js`
  - 唤醒请求的 API URL / Key / Model 实时读取。
  - Push、天气、Prompt、显示名等运行时配置也改为实时读取。
  - Gateway Base URL、日记目录等相关配置按运行时读取。
- `diary_cron.js`
  - 日记任务的 API URL / Key / Model 实时读取。
  - 日记目录实时读取。

Railway 的环境识别本身仍使用 `process.env`，这是合理的：它属于部署环境事实，而不是 Admin 页面要热更新的业务配置。

## 3. 新增 `/admin/models`

新增鉴权接口：

`POST /admin/models`

它会调用当前填写的上游 `/v1/models`，返回标准模型列表。

特别处理了以下 URL：

- `https://xxx/v1/chat/completions` → `https://xxx/v1/models`
- `https://xxx/v1` → `https://xxx/v1/models`
- `https://xxx` → `https://xxx/v1/models`

前端传入的 URL / Key 可以**尚未保存**，所以符合 Claude 截图里的“填好中转站 URL 和 Key，不用先保存，直接拉取模型列表”。

## 4. 前端 API 配置

`public/index.html` / `public/app.js`：

- 增加“拉取模型列表”按钮。
- 拉取成功后显示模型下拉列表。
- 点击模型后自动填入“模型名称”输入框。
- 原来的“保存”逻辑保留。
- 拉取失败会显示错误信息。

因此完整流程是：

1. 打开设置 → API 配置
2. 填 URL + Key
3. 点“拉取模型列表”
4. 选择模型，自动填入模型名称
5. 点“保存”
6. 不需要重启/重新部署
7. 下一条聊天、下一次记忆提取、下一次唤醒/日记任务都会读取新配置

## 5. 测试

运行 `npm test`：

- 21 tests passed
- 0 failed
- 另对修改涉及的 JS 文件执行了 `node --check`，全部通过。

