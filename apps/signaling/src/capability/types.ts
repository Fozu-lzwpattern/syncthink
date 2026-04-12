/**
 * SyncThink 能力令牌（Capability Token）类型定义
 *
 * 设计参考：syncthink-access-protocol-design.md §四
 */

// ─── 能力常量 ──────────────────────────────────────────────────────────────────

export const CAPABILITIES = {
  // 形状/卡片操作
  SHAPE_CREATE:   'syncthink:shape:create',
  SHAPE_UPDATE:   'syncthink:shape:update',
  SHAPE_DELETE:   'syncthink:shape:delete',
  SHAPE_CONFIRM:  'syncthink:shape:confirm',

  // 对话/消息操作
  CHAT_SEND:     'syncthink:chat:send',
  CHAT_READ:     'syncthink:chat:read',
  CHAT_DISTILL:  'syncthink:chat:distill',

  // 画布操作
  CANVAS_READ:   'syncthink:canvas:read',
  CANVAS_CLEAR:  'syncthink:canvas:clear',

  // 管理员操作
  AGENT_REGISTER: 'syncthink:agent:register',
  AGENT_REVOKE:   'syncthink:agent:revoke',
} as const

export type Capability = typeof CAPABILITIES[keyof typeof CAPABILITIES]

// ─── 令牌角色 ──────────────────────────────────────────────────────────────────

export type TokenRole = 'observer' | 'collaborator' | 'admin'

/**
 * 角色 → 能力集合的映射
 *
 * - observer:    只读监控型 Agent
 * - collaborator: 普通协作 Agent（能写卡片、发消息，不能删除）
 * - admin:       管理员（完整权限）
 */
export const ROLE_CAPABILITIES: Record<TokenRole, Capability[]> = {
  observer: [
    CAPABILITIES.CANVAS_READ,
    CAPABILITIES.CHAT_READ,
  ],
  collaborator: [
    CAPABILITIES.SHAPE_CREATE,
    CAPABILITIES.SHAPE_UPDATE,
    CAPABILITIES.CHAT_SEND,
    CAPABILITIES.CHAT_READ,
    CAPABILITIES.CANVAS_READ,
  ],
  admin: [
    CAPABILITIES.SHAPE_CREATE,
    CAPABILITIES.SHAPE_UPDATE,
    CAPABILITIES.SHAPE_DELETE,
    CAPABILITIES.SHAPE_CONFIRM,
    CAPABILITIES.CHAT_SEND,
    CAPABILITIES.CHAT_READ,
    CAPABILITIES.CHAT_DISTILL,
    CAPABILITIES.CANVAS_READ,
    CAPABILITIES.CANVAS_CLEAR,
    CAPABILITIES.AGENT_REGISTER,
    CAPABILITIES.AGENT_REVOKE,
  ],
}

/**
 * action 字符串 → 所需 Capability 的映射
 * （对应 AgentCommandBody.command.action）
 */
export const ACTION_CAPABILITY_MAP: Record<string, Capability> = {
  // 画布指令 actions
  'create':                CAPABILITIES.SHAPE_CREATE,
  'update':                CAPABILITIES.SHAPE_UPDATE,
  'delete':                CAPABILITIES.SHAPE_DELETE,
  'clear':                 CAPABILITIES.CANVAS_CLEAR,
  'confirm':               CAPABILITIES.SHAPE_CONFIRM,
  'conversation:append':   CAPABILITIES.CHAT_SEND,
  'channel:create':        CAPABILITIES.AGENT_REGISTER,

  // canvas 查询（GET 端点使用）
  'canvas:read':           CAPABILITIES.CANVAS_READ,
  'chat:distill':          CAPABILITIES.CHAT_DISTILL,
}

// ─── 令牌结构 ──────────────────────────────────────────────────────────────────

/**
 * 能力令牌（未序列化前的完整对象）
 */
export interface CapabilityToken {
  /** 颁发者节点 ID（owner） */
  iss: string
  /** 受众节点 ID（被授权方） */
  aud: string
  /** 能力列表 */
  cap: Capability[]
  /** 生效时间（Unix 秒） */
  nbf: number
  /** 过期时间（Unix 秒） */
  exp: number
  /** 随机数（防重放），hex 字符串 */
  nonce: string
  /** Ed25519 签名，base64url 字符串 */
  sig: string
}

// ─── 验证结果 ──────────────────────────────────────────────────────────────────

export type TokenVerifyResult =
  | { allowed: true;  token: CapabilityToken }
  | { allowed: false; reason: string }
