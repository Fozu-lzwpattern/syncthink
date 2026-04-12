#!/usr/bin/env bash
# =============================================================================
# SyncThink PKI 初始化脚本
#
# 生成私有 CA + server 证书 + 可选 agent 客户端证书
#
# 用法：
#   bash setup-pki.sh                       # 初始化 CA + server
#   bash setup-pki.sh --agent <nodeId>      # 颁发 agent 客户端证书
#   bash setup-pki.sh --revoke <nodeId>     # （TODO: CRL 支持）
#   bash setup-pki.sh --status              # 显示已有证书状态
#
# 输出目录：~/.syncthink/pki/
# =============================================================================

set -euo pipefail

PKI_DIR="${HOME}/.syncthink/pki"
CA_KEY="${PKI_DIR}/ca-key.pem"
CA_CERT="${PKI_DIR}/ca-cert.pem"
SERVER_KEY="${PKI_DIR}/server-key.pem"
SERVER_CERT="${PKI_DIR}/server-cert.pem"
SERVER_CSR="${PKI_DIR}/server.csr"

# 有效期（天）
CA_DAYS=3650      # CA 证书 10 年
SERVER_DAYS=365   # Server 证书 1 年
AGENT_DAYS=90     # Agent 客户端证书 90 天

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
BLU='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLU}[pki]${NC} $*"; }
ok()   { echo -e "${GRN}[pki] ✅${NC} $*"; }
warn() { echo -e "${YLW}[pki] ⚠️ ${NC} $*"; }
err()  { echo -e "${RED}[pki] ❌${NC} $*"; exit 1; }

# ─── 检查依赖 ──────────────────────────────────────────────────────────────────
check_deps() {
  if ! command -v openssl &>/dev/null; then
    err "openssl not found — please install it first"
  fi
}

# ─── 初始化 PKI 目录 ───────────────────────────────────────────────────────────
init_dir() {
  mkdir -p "${PKI_DIR}"
  chmod 700 "${PKI_DIR}"
  log "PKI directory: ${PKI_DIR}"
}

# ─── 生成私有 CA ───────────────────────────────────────────────────────────────
gen_ca() {
  if [[ -f "${CA_CERT}" ]]; then
    warn "CA already exists at ${CA_CERT}, skipping"
    return
  fi

  log "Generating private CA..."

  # CA 私钥（ECDSA P-256，比 RSA 4096 更小更快）
  openssl ecparam -genkey -name prime256v1 -noout -out "${CA_KEY}"
  chmod 600 "${CA_KEY}"

  # CA 自签名证书
  openssl req -new -x509 \
    -key "${CA_KEY}" \
    -out "${CA_CERT}" \
    -days "${CA_DAYS}" \
    -subj "/CN=SyncThink-CA/O=SyncThink/OU=PKI" \
    -extensions v3_ca \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"

  ok "CA generated → ${CA_CERT}"
}

# ─── 生成 Server 证书 ──────────────────────────────────────────────────────────
gen_server() {
  if [[ -f "${SERVER_CERT}" ]]; then
    warn "Server cert already exists at ${SERVER_CERT}, skipping"
    return
  fi

  log "Generating server certificate..."

  # Server 私钥
  openssl ecparam -genkey -name prime256v1 -noout -out "${SERVER_KEY}"
  chmod 600 "${SERVER_KEY}"

  # CSR
  openssl req -new \
    -key "${SERVER_KEY}" \
    -out "${SERVER_CSR}" \
    -subj "/CN=syncthink-server/O=SyncThink/OU=Server"

  # 签名（添加 SAN）
  openssl x509 -req \
    -in "${SERVER_CSR}" \
    -CA "${CA_CERT}" \
    -CAkey "${CA_KEY}" \
    -CAcreateserial \
    -out "${SERVER_CERT}" \
    -days "${SERVER_DAYS}" \
    -extfile <(cat <<EOF
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,DNS:syncthink-server,IP:127.0.0.1
EOF
)

  rm -f "${SERVER_CSR}"
  ok "Server cert generated → ${SERVER_CERT}"
}

# ─── 颁发 Agent 客户端证书 ────────────────────────────────────────────────────
gen_agent() {
  local node_id="$1"
  if [[ -z "${node_id}" ]]; then
    err "--agent requires a nodeId argument"
  fi

  local agent_key="${PKI_DIR}/agent-${node_id}-key.pem"
  local agent_csr="${PKI_DIR}/agent-${node_id}.csr"
  local agent_cert="${PKI_DIR}/agent-${node_id}-cert.pem"

  if [[ -f "${agent_cert}" ]]; then
    warn "Agent cert for '${node_id}' already exists, skipping"
    echo "  cert: ${agent_cert}"
    echo "  key:  ${agent_key}"
    return
  fi

  if [[ ! -f "${CA_CERT}" ]]; then
    err "CA not found. Run: bash setup-pki.sh (without --agent) first"
  fi

  log "Generating agent certificate for nodeId='${node_id}'..."

  # Agent 私钥
  openssl ecparam -genkey -name prime256v1 -noout -out "${agent_key}"
  chmod 600 "${agent_key}"

  # CSR（CN = nodeId）
  openssl req -new \
    -key "${agent_key}" \
    -out "${agent_csr}" \
    -subj "/CN=${node_id}/O=SyncThink/OU=Agent"

  # 签名
  openssl x509 -req \
    -in "${agent_csr}" \
    -CA "${CA_CERT}" \
    -CAkey "${CA_KEY}" \
    -CAcreateserial \
    -out "${agent_cert}" \
    -days "${AGENT_DAYS}" \
    -extfile <(cat <<EOF
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=clientAuth
subjectAltName=DNS:${node_id}
EOF
)

  rm -f "${agent_csr}"

  ok "Agent cert generated for '${node_id}'"
  echo ""
  echo "  📄 cert: ${agent_cert}"
  echo "  🔑 key:  ${agent_key}"
  echo "  🏛️  ca:   ${CA_CERT}"
  echo ""
  echo "  Use with CLI:"
  echo "    syncthink-cli --cert ${agent_cert} --key ${agent_key} --ca ${CA_CERT} send <channelId> ..."
}

# ─── 显示 PKI 状态 ────────────────────────────────────────────────────────────
show_status() {
  log "PKI Status (${PKI_DIR}):"
  echo ""

  for f in "${CA_CERT}" "${SERVER_CERT}" "${PKI_DIR}"/agent-*-cert.pem; do
    if [[ -f "$f" ]]; then
      local label
      label=$(basename "$f")
      local expiry
      expiry=$(openssl x509 -in "$f" -noout -enddate 2>/dev/null | sed 's/notAfter=//')
      local cn
      cn=$(openssl x509 -in "$f" -noout -subject 2>/dev/null | grep -o 'CN=[^/,]*' | sed 's/CN=//')
      echo -e "  ${GRN}✓${NC} ${label}"
      echo -e "    CN:     ${cn}"
      echo -e "    Expiry: ${expiry}"
      echo ""
    fi
  done
}

# ─── 主入口 ───────────────────────────────────────────────────────────────────
main() {
  check_deps
  init_dir

  case "${1:-init}" in
    init|"")
      gen_ca
      gen_server
      echo ""
      ok "PKI initialized. To issue an agent cert:"
      echo "  bash setup-pki.sh --agent <nodeId>"
      ;;
    --agent)
      gen_ca    # 确保 CA 存在
      gen_agent "${2:-}"
      ;;
    --status)
      show_status
      ;;
    --help|-h)
      head -20 "$0" | grep "^#" | sed 's/^# //'
      ;;
    *)
      err "Unknown command: $1. Use --help for usage."
      ;;
  esac
}

main "$@"
