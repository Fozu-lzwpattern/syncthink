# SyncThink Agent Demo — ConversationNode 消息注入

## 概述

Phase 2 深化后，Agent 可以通过 `conversation:append` 指令向画布上的 **ConversationNode** 实时追加消息。
消息通过 Ed25519 签名鉴权，经由 BroadcastChannel 传递给 AgentBridge，实时更新 Yjs CRDT 同步的画布 shape。

## 快速上手

### 1. 启动 SyncThink

```bash
./quickstart.sh
# 浏览器打开 http://localhost:5173
```

### 2. 在画布上创建一个 ConversationNode

点击顶部 **「+ 对话节点」** 按钮，画布中心会出现一个对话卡片。
**复制该卡片的 Shape ID**（右键 → 开发者工具，或在控制台查看）：

```js
// 浏览器控制台查看当前所有 shape ID
__tldraw_editor.getCurrentPageShapes().filter(s => s.type === 'syncthink-conversation')
```

### 3. 在浏览器控制台运行 Agent

打开**第二个标签页**（同 URL），在控制台运行：

```js
// 动态导入 AgentClient（Vite HMR 模式下可用）
import('/src/agent/client.js').then(async ({ AgentClient }) => {
  const client = await AgentClient.create()
  const CONV_ID = 'shape:YOUR_SHAPE_ID_HERE'  // 替换成实际 ID

  // 追加一条 Agent 消息
  await client.appendToConversation(CONV_ID, '你好！我是 SyncThink Agent，已完成本地生活服务场景分析。')

  // 模拟 Agent 思考过程（多轮）
  const msgs = [
    '📍 检测到用户位置：望京 SOHO 附近（2km 范围）',
    '🎯 发现 3 个活跃优惠活动，为你优选最优惠的一个…',
    '✅ 已为你生成外卖优惠卡片（立减 12 元，有效期 2h）',
  ]
  for (const m of msgs) {
    await new Promise(r => setTimeout(r, 1500))
    await client.appendToConversation(CONV_ID, m, 'LocalServicesAgent')
  }

  client.destroy()
})
```

### 4. 观察效果

- **第一个标签页**：ConversationNode 实时出现新消息，带淡入动效
- 卡片自动扩展高度，最新消息标注 🤖 标识
- Review 模式时间轴记录 `agent_message` 事件

## 指令格式

```ts
// conversation:append 指令结构
{
  action: 'conversation:append',
  data: {
    conversationId: 'shape:xxxxxx',  // 目标 ConversationNode ID
    senderName: 'MyAgent',           // 发送方名称
    content: '消息内容',
    isAgentMessage: true,            // true = 显示 🤖 图标
  }
}
```

## 鉴权说明

所有指令经过 **Ed25519 签名**：
- `AgentClient` 自动生成/持久化密钥对（存 `localStorage`）
- 每条指令携带 `payload + nodeId + publicKey + timestamp + signature`
- `AgentBridge` 验签并检查 ±30s 时间窗口（防重放攻击）
- 验签失败触发 `auth:rejected` 事件，可通过 `agentBridge.onEvent()` 监听

## Phase 2 完成功能清单

| 功能 | 状态 |
|------|------|
| ConversationNode tldraw Shape | ✅ |
| AgentNode tldraw Shape | ✅ |
| Live / Review 双态切换 | ✅ |
| Review 时间轴 + 5 事件历史 | ✅ |
| Ed25519 签名鉴权 | ✅ |
| `conversation:append` 指令 | ✅ |
| `AgentClient.appendToConversation()` | ✅ |
| 新消息淡入动效 | ✅ |
| 卡片高度自适应 | ✅ |
| Interaction Log 记录 `agent_message` | ✅ |
| Yjs CRDT 同步（多标签实时更新） | ✅ |
