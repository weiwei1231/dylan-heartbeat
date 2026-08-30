/**
 * garden_tools.js — 花园 MCP 工具注册
 * 通过 Galatea Garden MCP 端点操作花园
 */

const { registerTool } = require('./tool_runner');

const GARDEN_MCP_URL = process.env.GARDEN_MCP_URL || 'https://galatea.abysslumina.com/mcp';
const GARDEN_MCP_TOKEN = process.env.GARDEN_MCP_TOKEN || '';

async function callGardenMCP(method, params) {
  if (!GARDEN_MCP_TOKEN) {
    return { error: 'GARDEN_MCP_TOKEN 未配置' };
  }
  try {
    var body = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: method,
      params: params || {}
    };
    var response = await fetch(GARDEN_MCP_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GARDEN_MCP_TOKEN
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      return { error: 'Garden MCP HTTP ' + response.status };
    }
    var data = await response.json();
    if (data.error) {
      return { error: data.error.message || JSON.stringify(data.error) };
    }
    return data.result || data;
  } catch (err) {
    return { error: err.message };
  }
}

function initGardenTools() {
  if (!GARDEN_MCP_TOKEN) {
    console.log('[Garden] GARDEN_MCP_TOKEN 未配置，跳过花园工具注册');
    return;
  }

  registerTool('garden_list_threads', {
    name: 'garden_list_threads',
    description: '查看花园论坛最新帖子',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回数量，默认5' }
      }
    }
  }, async function(args) {
    var result = await callGardenMCP('tools/call', { name: 'list_threads', arguments: { limit: args.limit || 5, sort: 'latest' } });
    return JSON.stringify(result, null, 2);
  });

  registerTool('garden_get_my_status', {
    name: 'garden_get_my_status',
    description: '查看花园当前状态（游戏、通知等）',
    parameters: {
      type: 'object',
      properties: {
        since_event_id: { type: 'number', description: '事件游标，默认0' }
      }
    }
  }, async function(args) {
    var result = await callGardenMCP('tools/call', { name: 'get_my_status', arguments: { since_event_id: args.since_event_id || 0 } });
    return JSON.stringify(result, null, 2);
  });

  registerTool('garden_list_notifications', {
    name: 'garden_list_notifications',
    description: '查看花园通知（回复、点赞、@提及）',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回数量，默认10' }
      }
    }
  }, async function(args) {
    var result = await callGardenMCP('tools/call', { name: 'list_notifications', arguments: { limit: args.limit || 10 } });
    return JSON.stringify(result, null, 2);
  });

  registerTool('garden_list_games', {
    name: 'garden_list_games',
    description: '查看花园可玩的桌游列表',
    parameters: { type: 'object', properties: {} }
  }, async function() {
    var result = await callGardenMCP('tools/call', { name: 'list_games', arguments: {} });
    return JSON.stringify(result, null, 2);
  });

  console.log('[Garden] 花园工具已注册 (4个)');
}

module.exports = { initGardenTools: initGardenTools };
