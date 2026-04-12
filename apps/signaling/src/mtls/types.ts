/**
 * SyncThink mTLS 类型定义
 *
 * 设计参考：syncthink-access-protocol-design.md §三
 */

export interface MtlsConfig {
  /** 是否启用 mTLS（要求客户端证书） */
  enabled: boolean
  /** CA 证书路径（PEM） */
  caCertPath: string
  /** 服务端证书路径（PEM） */
  serverCertPath: string
  /** 服务端私钥路径（PEM） */
  serverKeyPath: string
}

export interface ClientCertInfo {
  /** 证书 CN（Common Name），对应 nodeId */
  cn: string
  /** 证书指纹（SHA-256，hex，无冒号） */
  fingerprint: string
  /** 颁发者 CN */
  issuerCn: string
  /** 证书有效起始时间 */
  validFrom: Date
  /** 证书有效截止时间 */
  validTo: Date
}

export type MtlsCheckResult =
  | { ok: true;  clientInfo: ClientCertInfo }
  | { ok: false; reason: string }
