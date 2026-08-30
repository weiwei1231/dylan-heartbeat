/**
 * tool_loop.js — tool calling 循环处理
 * 当 Claude 返回 tool_calls 时，执行工具并继续对话直到返回纯文本
 */

const { handleToolCalls, hasTools, getToolDeclarations } = require("./tool_runner");

const MAX_TOOL_ROUNDS = 5;

/**
 * 执行 tool calling 循环（非流式）
 * @param {string} apiUrl - 上游API URL
 * @param {string} apiKey - 上游API Key
 * @param {object} requestBody - 原始请求body（含messages, model, tools等）
 * @returns {object} 最终的API响应JSON
 */
async function runToolLoop(apiUrl, apiKey, requestBody) {
  var body = Object.assign({}, requestBody, { stream: false });
  if (hasTools()) body.tools = getToolDeclarations();

  var messages = body.messages.slice();
  var round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    round++;
    body.messages = messages;

    var response = await fetch(apiUrl, {
      method: "POST",
      signal: AbortSignal.timeout(120000),
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      var errText = await response.text();
      return { error: true, status: response.status, body: errText };
    }

    var data = await response.json();
    var choice = data.choices && data.choices[0];
    if (!choice) return { error: false, data: data };

    var msg = choice.message;
    if (!msg) return { error: false, data: data };

    // 如果没有 tool_calls，说明是最终回复
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { error: false, data: data };
    }

    // 有 tool_calls，执行工具
    console.log("[ToolLoop] Round " + round + ": " + msg.tool_calls.length + " tool calls");

    // 把 assistant 的 tool_calls 消息加到 messages
    messages.push({
      role: "assistant",
      content: msg.content || null,
      tool_calls: msg.tool_calls
    });

    // 执行所有 tool calls
    var toolResults = await handleToolCalls(msg.tool_calls);
    for (var i = 0; i < toolResults.length; i++) {
      messages.push(toolResults[i]);
    }

    console.log("[ToolLoop] Tools executed, continuing...");
  }

  // 超过最大轮次，发最后一轮不带 tools 强制获取文本回复
  console.log("[ToolLoop] Max rounds reached, forcing text reply");
  delete body.tools;
  body.messages = messages;

  var finalResponse = await fetch(apiUrl, {
    method: "POST",
    signal: AbortSignal.timeout(120000),
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    body: JSON.stringify(body)
  });

  if (!finalResponse.ok) {
    var errText2 = await finalResponse.text();
    return { error: true, status: finalResponse.status, body: errText2 };
  }

  return { error: false, data: await finalResponse.json() };
}

module.exports = { runToolLoop: runToolLoop };
