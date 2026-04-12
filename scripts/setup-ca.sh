#!/usr/bin/env bash
# SyncThink 私有 CA 管理脚本
#
# 用法：
#   ./scripts/setup-ca.sh init          初始化 CA（生成 root CA + server cert）
#   ./scripts/setup-ca.sh issue <name>  为 Agent 颁发客户端证书
#   ./scripts/setup-ca.sh revoke <name> 吊销 Agent 证书（从 agent-certs 中删除）
#   ./scripts/setup-ca.sh list          列出所有已颁发证书
#   ./scripts/setup-ca.sh status        查看 CA 状态

set -euo pipefail

CA_DIR="$HOME/.syncthink/ca"
AGENT_CERTS_DIR="$HOME/.syncthink/agent-certs"

# ─── 工具函数 ─────────────────────────────────────────────────────────────────

check_openssl() {
  if ! command -v openssl &>/dev/null; then
    echo "❌ openssl 未找到，请安装 openssl 后重试"
    exit 1
  fi
}

check_ca_initialized() {
  if [[ ! -f "$CA_DIR/ca.crt" || ! -f "$CA_DIR/ca.key" ]]; then
    echo "❌ CA 尚未初始化，请先运行："
    echo "   $0 init"
    exit 1
  fi
}

# ─── init：初始化 CA ──────────────────────────────────────────────────────────

cmd_init() {
  check_openssl

  if [[ -f "$CA_DIR/ca.crt" ]]; then
    echo "⚠️  CA 已存在：$CA_DIR/ca.crt"
    echo "   若要重新初始化，请先手动删除 $CA_DIR 目录"
    exit 1
  fi

  echo "🔐 初始化 SyncThink 私有 CA..."
  mkdir -p "$CA_DIR"

  # 1. 生成 CA 私钥（4096位）
  echo "  ① 生成 CA 私钥（4096位）..."
  openssl genrsa -out "$CA_DIR/ca.key" 4096 2>/dev/null
  chmod 600 "$CA_DIR/ca.key"

  # 2. 生成自签名 CA 证书（10年有效）
  echo "  ② 生成自签名 CA 证书（有效期 10 年）..."
  openssl req -x509 -new -nodes \
    -key "$CA_DIR/ca.key" \
    -sha256 \
    -days 3650 \
    -out "$CA_DIR/ca.crt" \
    -subj "/CN=SyncThink CA/O=SyncThink/C=CN" \
    2>/dev/null
  chmod 644 "$CA_DIR/ca.crt"

  # 3. 生成 server 私钥（2048位）
  echo "  ③ 生成 server 私钥（2048位）..."
  openssl genrsa -out "$CA_DIR/server.key" 2048 2>/dev/null
  chmod 600 "$CA_DIR/server.key"

  # 4. 生成 server CSR（带 SAN）
  echo "  ④ 生成 server CSR（SAN: localhost, 127.0.0.1）..."
  # 创建 SAN 扩展配置文件
  cat > "$CA_DIR/server_ext.cnf" <<EOF
[req]
req_extensions = v3_req
distinguished_name = req_distinguished_name

[req_distinguished_name]

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1  = 127.0.0.1
EOF

  openssl req -new \
    -key "$CA_DIR/server.key" \
    -out "$CA_DIR/server.csr" \
    -subj "/CN=localhost/O=SyncThink/C=CN" \
    -config "$CA_DIR/server_ext.cnf" \
    2>/dev/null

  # 5. 用 CA 签发 server 证书（2年有效）
  echo "  ⑤ 用 CA 签发 server 证书（有效期 2 年）..."
  openssl x509 -req \
    -in "$CA_DIR/server.csr" \
    -CA "$CA_DIR/ca.crt" \
    -CAkey "$CA_DIR/ca.key" \
    -CAcreateserial \
    -out "$CA_DIR/server.crt" \
    -days 730 \
    -sha256 \
    -extfile "$CA_DIR/server_ext.cnf" \
    -extensions v3_req \
    2>/dev/null
  chmod 644 "$CA_DIR/server.crt"

  # 清理临时文件
  rm -f "$CA_DIR/server.csr" "$CA_DIR/server_ext.cnf"

  echo ""
  echo "✅ CA 初始化完成！文件位于："
  echo "   CA 证书:     $CA_DIR/ca.crt"
  echo "   CA 私钥:     $CA_DIR/ca.key  (请妥善保管)"
  echo "   Server 证书: $CA_DIR/server.crt"
  echo "   Server 私钥: $CA_DIR/server.key"
  echo ""
  echo "📋 下一步："
  echo "   为 Agent 颁发客户端证书："
  echo "   $0 issue <agent-name>"
  echo ""
  echo "   重启 SyncThink signaling server 后 mTLS 将自动启用。"
}

# ─── issue：为 Agent 颁发客户端证书 ──────────────────────────────────────────

cmd_issue() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    echo "❌ 用法: $0 issue <name>"
    echo "   例如: $0 issue openclaw-agent"
    exit 1
  fi

  check_openssl
  check_ca_initialized

  mkdir -p "$AGENT_CERTS_DIR"

  local key_path="$AGENT_CERTS_DIR/$name.key"
  local csr_path="$AGENT_CERTS_DIR/$name.csr"
  local crt_path="$AGENT_CERTS_DIR/$name.crt"

  if [[ -f "$crt_path" ]]; then
    echo "⚠️  证书已存在: $crt_path"
    echo "   如需重新颁发，请先运行: $0 revoke $name"
    exit 1
  fi

  echo "🔏 为 Agent '$name' 颁发客户端证书..."

  # 1. 生成 Agent 私钥（2048位）
  openssl genrsa -out "$key_path" 2048 2>/dev/null
  chmod 600 "$key_path"

  # 2. 生成 CSR
  openssl req -new \
    -key "$key_path" \
    -out "$csr_path" \
    -subj "/CN=$name/O=SyncThink-Agent/C=CN" \
    2>/dev/null

  # 3. 用 CA 签发证书（180天）
  openssl x509 -req \
    -in "$csr_path" \
    -CA "$CA_DIR/ca.crt" \
    -CAkey "$CA_DIR/ca.key" \
    -CAcreateserial \
    -out "$crt_path" \
    -days 180 \
    -sha256 \
    2>/dev/null
  chmod 644 "$crt_path"

  # 清理 CSR
  rm -f "$csr_path"

  local expiry
  expiry=$(openssl x509 -noout -enddate -in "$crt_path" | sed 's/notAfter=//')

  echo ""
  echo "✅ 证书颁发完成：$name"
  echo "   证书: $crt_path"
  echo "   私钥: $key_path"
  echo "   到期: $expiry"
  echo ""
  echo "📋 使用方式："
  echo "   CLI 参数（Node.js）:"
  echo "     --cert $crt_path \\"
  echo "     --key  $key_path \\"
  echo "     --ca   $CA_DIR/ca.crt"
  echo ""
  echo "   环境变量："
  echo "     SYNCTHINK_CLIENT_CERT=$crt_path"
  echo "     SYNCTHINK_CLIENT_KEY=$key_path"
  echo "     SYNCTHINK_CA_CERT=$CA_DIR/ca.crt"
}

# ─── revoke：吊销 Agent 证书 ─────────────────────────────────────────────────

cmd_revoke() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    echo "❌ 用法: $0 revoke <name>"
    exit 1
  fi

  local key_path="$AGENT_CERTS_DIR/$name.key"
  local crt_path="$AGENT_CERTS_DIR/$name.crt"

  if [[ ! -f "$crt_path" ]]; then
    echo "❌ 证书不存在: $crt_path"
    exit 1
  fi

  echo "🗑️  吊销 Agent '$name' 的证书..."
  rm -f "$crt_path" "$key_path"
  echo "✅ 已删除: $crt_path"
  [[ -f "$key_path" ]] || echo "   已删除: $key_path"
  echo ""
  echo "⚠️  注意：简单删除不会阻止已在传输中的连接。"
  echo "   如需即时生效，请重启 SyncThink signaling server。"
  echo "   如需 CRL/OCSP 吊销支持，请手动配置（超出本脚本范围）。"
}

# ─── list：列出所有已颁发证书 ─────────────────────────────────────────────────

cmd_list() {
  if [[ ! -d "$AGENT_CERTS_DIR" ]]; then
    echo "📋 暂无颁发的 Agent 证书（$AGENT_CERTS_DIR 不存在）"
    return
  fi

  local certs
  certs=$(find "$AGENT_CERTS_DIR" -name "*.crt" 2>/dev/null | sort)

  if [[ -z "$certs" ]]; then
    echo "📋 暂无颁发的 Agent 证书"
    return
  fi

  echo "📋 已颁发的 Agent 证书："
  echo ""
  printf "  %-30s %-20s %s\n" "名称" "CN" "到期时间"
  printf "  %-30s %-20s %s\n" "──────────────────────────────" "────────────────────" "────────────────────"

  while IFS= read -r crt; do
    local name
    name=$(basename "$crt" .crt)
    local cn
    cn=$(openssl x509 -noout -subject -in "$crt" 2>/dev/null | sed 's/.*CN\s*=\s*//' | sed 's/,.*//')
    local expiry
    expiry=$(openssl x509 -noout -enddate -in "$crt" 2>/dev/null | sed 's/notAfter=//')
    printf "  %-30s %-20s %s\n" "$name" "$cn" "$expiry"
  done <<< "$certs"

  echo ""
}

# ─── status：查看 CA 状态 ─────────────────────────────────────────────────────

cmd_status() {
  echo "📊 SyncThink CA 状态"
  echo ""

  if [[ ! -f "$CA_DIR/ca.crt" ]]; then
    echo "  CA: ❌ 未初始化"
    echo ""
    echo "  运行以下命令初始化："
    echo "    $0 init"
    return
  fi

  local ca_expiry
  ca_expiry=$(openssl x509 -noout -enddate -in "$CA_DIR/ca.crt" 2>/dev/null | sed 's/notAfter=//')
  local ca_cn
  ca_cn=$(openssl x509 -noout -subject -in "$CA_DIR/ca.crt" 2>/dev/null | sed 's/.*CN\s*=\s*//' | sed 's/,.*//')

  echo "  CA 证书:     ✅ $CA_DIR/ca.crt"
  echo "  CA CN:       $ca_cn"
  echo "  CA 到期:     $ca_expiry"
  echo ""

  if [[ -f "$CA_DIR/server.crt" ]]; then
    local server_expiry
    server_expiry=$(openssl x509 -noout -enddate -in "$CA_DIR/server.crt" 2>/dev/null | sed 's/notAfter=//')
    echo "  Server 证书: ✅ $CA_DIR/server.crt"
    echo "  Server 到期: $server_expiry"
  else
    echo "  Server 证书: ❌ 不存在（运行 $0 init 生成）"
  fi

  echo ""

  # 统计 Agent 证书数量
  local agent_count=0
  if [[ -d "$AGENT_CERTS_DIR" ]]; then
    agent_count=$(find "$AGENT_CERTS_DIR" -name "*.crt" 2>/dev/null | wc -l | tr -d ' ')
  fi
  echo "  Agent 证书数: $agent_count"

  if [[ "$agent_count" -gt 0 ]]; then
    echo "  （运行 $0 list 查看详情）"
  fi
  echo ""
}

# ─── 主入口 ───────────────────────────────────────────────────────────────────

CMD="${1:-}"

case "$CMD" in
  init)
    cmd_init
    ;;
  issue)
    cmd_issue "${2:-}"
    ;;
  revoke)
    cmd_revoke "${2:-}"
    ;;
  list)
    cmd_list
    ;;
  status)
    cmd_status
    ;;
  *)
    echo "SyncThink 私有 CA 管理脚本"
    echo ""
    echo "用法："
    echo "  $0 init            初始化 CA（生成 root CA + server cert）"
    echo "  $0 issue <name>    为 Agent 颁发客户端证书（180天有效）"
    echo "  $0 revoke <name>   吊销 Agent 证书"
    echo "  $0 list            列出所有已颁发证书"
    echo "  $0 status          查看 CA 状态"
    echo ""
    echo "示例："
    echo "  $0 init"
    echo "  $0 issue openclaw-agent"
    echo "  $0 list"
    exit 1
    ;;
esac
