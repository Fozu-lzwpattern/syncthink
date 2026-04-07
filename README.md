# SyncThink

> 本地优先、P2P 分布式、多人实时协同的无限结构化画布系统
> 团队级分布式思考节点网络

## 产品定位

每个人自带 Agent 的团队分布式思考画布——没有中心服务器，没有云端锁定，数据永远在你手里。

## 核心特性

- **无限画布** — 基于 tldraw，无限延伸，流畅操作
- **真 P2P 分布式** — Yjs CRDT + WebRTC，无中心服务器，每人完整副本
- **四大场景模式** — 会议讨论 / 情报分析 / 目标拆解 / 发散收敛，强约束结构
- **Agent 第一人称** — 每人接入本地 Claw/Agent，Agent 是参与者而非旁观者
- **本地优先** — 离线可用，重连自动同步，数据自主掌控

## 技术栈

| 层 | 技术 |
|---|---|
| 画布 | tldraw v2 |
| 同步 | Yjs + y-webrtc |
| 持久化 | y-indexeddb |
| 框架 | React 18 + TypeScript + Vite |
| 样式 | TailwindCSS |
| 桌面端（P2） | Tauri |

## 快速开始

```bash
# 即将支持
pnpm install
pnpm dev
```

## 设计文档

见 [syncthink-design.md](docs/syncthink-design.md)

## 路线图

- [ ] Phase 1：MVP — 画布 + P2P 同步 + 会议模式 + Agent 接口
- [ ] Phase 2：完整四大场景 + 自定义 Schema + 桌面端

---

*SyncThink — 思考不应该被困在云端*
