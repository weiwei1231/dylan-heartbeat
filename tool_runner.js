/**
 * tool_runner.js — kc 工具执行引擎
 * 管理所有可用工具的注册、声明和执行
 */

const TOOLS_REGISTRY = {};

/**
 * 注册一个工具
 * @param {string} name - 工具名
 * @param {object} declaration - OpenAI function 格式的声明
 * @param {function} handler - async function(args) => result string
 */
function registerTool(name, declaration, handler) {
  TOOLS_REGISTRY[name] = { declaration, handler };
  console.log('[ToolRunner] 已注册工具:', name);
}

/**
 * 获取所有工具声明（用于发给 Claude 的 tools 参数）
 */
function getToolDeclarations() {
  var decls = [];
  for (var name in TOOLS_REGISTRY) {
    decls.push({
      type: 'function',
      function: TOOLS_REGISTRY[name].declaration
    });
  }
  return decls;
}

/**
 * 执行一个 tool_call
 * @param {string} name - 工具名
 * @param {string} argsJson - JSON 字符串参数
 * @returns {string} 执行结果文本
 */
async function executeTool(name, argsJson) {
  var tool = TOOLS_REGISTRY[name];
  if (!tool) {
    return JSON.stringify({ error: '未知工具: ' + name });
  }
  try {
    var args = {};
    try { args = JSON.parse(argsJson || '{}'); } catch (e) { args = {}; }
    var result = await tool.handler(args);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    console.error('[ToolRunner] 执行失败:', name, err.message);
    return JSON.stringify({ error: err.message });
  }
}

/**
 * 处理 Claude 返回的 tool_calls 数组
 * @param {Array} toolCalls - [{id, function:{name, arguments}}]
 * @returns {Array} tool 结果消息数组
 */
async function handleToolCalls(toolCalls) {
  var results = [];
  for (var i = 0; i < toolCalls.length; i++) {
    var tc = toolCalls[i];
    var funcName = tc.function && tc.function.name || '';
    var funcArgs = tc.function && tc.function.arguments || '{}';
    console.log('[ToolRunner] 执行:', funcName);
    var output = await executeTool(funcName, funcArgs);
    results.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: output
    });
  }
  return results;
}

/**
 * 是否有已注册的工具
 */
function hasTools() {
  return Object.keys(TOOLS_REGISTRY).length > 0;
}

module.exports = {
  registerTool: registerTool,
  getToolDeclarations: getToolDeclarations,
  executeTool: executeTool,
  handleToolCalls: handleToolCalls,
  hasTools: hasTools
};
