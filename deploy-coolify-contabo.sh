#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# คมคิด by KOMKRIT (KOMKID AI Flow)
# All-in-One Contabo VPS + Coolify v4 Setup, SSH Connection & Auto-Deploy Script
# ==============================================================================
# Usage Modes:
#   1) Interactive Menu (Recommended):
#      ./deploy-coolify-contabo.sh
#
#   2) Full Contabo VPS + Coolify v4 Installation (Run from your Mac/PC):
#      ./deploy-coolify-contabo.sh --setup-vps <VPS_IP> [SSH_USER=root] [SSH_PORT=22]
#
#   3) Fix / Setup SSH Key Connection between Coolify & Contabo VPS:
#      ./deploy-coolify-contabo.sh --connect-server <VPS_IP> [SSH_USER=root] [SSH_PORT=22]
#
#   4) Direct 1-Command App Deploy to Contabo VPS via SSH + Docker Compose:
#      ./deploy-coolify-contabo.sh --deploy-ssh <VPS_IP> [SSH_USER=root] [SSH_PORT=22] [APP_PORT=8080]
#
#   5) Trigger Coolify Webhook / API Deployment:
#      ./deploy-coolify-contabo.sh --deploy-webhook <COOLIFY_WEBHOOK_URL> [COOLIFY_API_TOKEN]
#
#   6) Run Directly INSIDE Contabo VPS Terminal:
#      bash deploy-coolify-contabo.sh --on-vps
# ==============================================================================

BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

COOLIFY_KEY_PATH="${HOME}/.ssh/coolify_contabo_ed25519"
DEFAULT_VPS_IP="5.183.33.183"
DEFAULT_VPS_HOST="vmi3731662"

banner() {
  echo -e "${CYAN}${BOLD}"
  echo "=============================================================================="
  echo "  🚀 คมคิด by KOMKRIT — Contabo VPS (${DEFAULT_VPS_IP} / ${DEFAULT_VPS_HOST}) & Coolify v4"
  echo "=============================================================================="
  echo -e "${RESET}"
}

run_ssh_with_optional_password() {
  local ssh_port="$1"
  local target="$2"
  shift 2
  local remote_cmd="$*"

  if [[ -n "${CONTABO_PASSWORD:-}" ]] && command -v expect >/dev/null 2>&1; then
    CONTABO_PASS_ENV="${CONTABO_PASSWORD}" SSH_PORT_ENV="${ssh_port}" SSH_TARGET_ENV="${target}" SSH_CMD_ENV="${remote_cmd}" expect -c '
      set timeout 60
      log_user 1
      spawn ssh -p $env(SSH_PORT_ENV) -o StrictHostKeyChecking=accept-new -o PubkeyAuthentication=no $env(SSH_TARGET_ENV) $env(SSH_CMD_ENV)
      expect {
        "*assword:*" {
          send -- "$env(CONTABO_PASS_ENV)\r"
          expect {
            "*Permission denied*" {
              exit 5
            }
            eof
          }
        }
        eof
      }
      catch wait result
      exit [lindex $result 3]
    '
  else
    ssh -p "${ssh_port}" -o StrictHostKeyChecking=accept-new "${target}" "${remote_cmd}"
  fi
}

ensure_local_ssh_key() {
  mkdir -p "${HOME}/.ssh"
  chmod 700 "${HOME}/.ssh"
  if [[ ! -f "${COOLIFY_KEY_PATH}" ]]; then
    echo -e "${CYAN}🔑 Generating dedicated Ed25519 SSH Key for Coolify & Contabo VPS...${RESET}"
    ssh-keygen -t ed25519 -f "${COOLIFY_KEY_PATH}" -N "" -C "coolify-contabo-${DEFAULT_VPS_IP}"
  else
    echo -e "${GREEN}✔ Found existing SSH Key: ${COOLIFY_KEY_PATH}${RESET}"
  fi
}

install_ssh_key_to_vps() {
  local vps_ip="${1:-${DEFAULT_VPS_IP}}"
  local ssh_user="${2:-root}"
  local ssh_port="${3:-22}"

  ensure_local_ssh_key
  local pub_key
  pub_key="$(cat "${COOLIFY_KEY_PATH}.pub")"

  if ssh -i "${COOLIFY_KEY_PATH}" -p "${ssh_port}" -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "${ssh_user}@${vps_ip}" "true" 2>/dev/null; then
    echo -e "${GREEN}✔ Passwordless SSH Key authentication is already active for ${ssh_user}@${vps_ip}!${RESET}"
    return 0
  fi

  echo -e "${YELLOW}👉 Pushing SSH Public Key to ${ssh_user}@${vps_ip}:${ssh_port} (enter Contabo root password once)...${RESET}"
  run_ssh_with_optional_password "${ssh_port}" "${ssh_user}@${vps_ip}" \
    "mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -qxF '${pub_key}' ~/.ssh/authorized_keys 2>/dev/null || echo '${pub_key}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

  echo -e "${GREEN}✔ Passwordless SSH Key authentication is now active for ${ssh_user}@${vps_ip}!${RESET}"
}

# Script snippet executed inside the Contabo VPS
provision_contabo_vps_remote_script() {
  cat << 'EOF'
set -euo pipefail

echo "=================================================================="
echo " 🛠️  Step 1/5: Updating Contabo VPS System Packages & Tools..."
echo "=================================================================="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl wget git jq ufw ca-certificates gnupg lsb-release openssl

echo "=================================================================="
echo " 💾 Step 2/5: Configuring 4GB Swap File (Prevents Docker Build OOM)"
echo "=================================================================="
if ! swapon --show | grep -q '/swapfile'; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile || true
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  echo "✔ 4GB Swap enabled."
else
  echo "✔ Swap is already active."
fi

echo "=================================================================="
echo " 🔐 Step 3/5: Verifying SSH Daemon Configuration for Coolify..."
echo "=================================================================="
if [[ -f /etc/ssh/sshd_config ]]; then
  sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config || true
  sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config || true
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
fi

echo "=================================================================="
echo " 🛡️  Step 4/5: Configuring UFW Firewall Ports for Coolify & WebApp"
echo "=================================================================="
ufw allow 22/tcp comment 'SSH' || true
ufw allow 80/tcp comment 'HTTP Traefik Proxy' || true
ufw allow 443/tcp comment 'HTTPS Traefik Proxy' || true
ufw allow 8000/tcp comment 'Coolify Dashboard' || true
ufw allow 6001/tcp comment 'Coolify Realtime WebSockets' || true
ufw allow 6002/tcp comment 'Coolify Terminal WebSockets' || true
ufw allow 3000/tcp comment 'Komkid AIFlow Direct Port' || true
ufw allow 8080/tcp comment 'Coolify Traefik Proxy Admin' || true
ufw --force enable || true

echo "=================================================================="
echo " 🐳 Step 5/5: Installing Official Coolify v4 + Docker Engine..."
echo "=================================================================="
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# Ensure Coolify local host key is authorized in root's authorized_keys
if [[ -d /data/coolify/ssh/keys ]]; then
  for keyfile in /data/coolify/ssh/keys/*.pub; do
    if [[ -f "$keyfile" ]]; then
      pubcontent="$(cat "$keyfile")"
      grep -qxF "$pubcontent" /root/.ssh/authorized_keys 2>/dev/null || echo "$pubcontent" >> /root/.ssh/authorized_keys
    fi
  done
  chmod 600 /root/.ssh/authorized_keys
fi

echo ""
echo "✅ Contabo VPS + Coolify v4 Provisioning Completed Successfully!"
EOF
}

run_setup_vps() {
  local vps_ip="$1"
  local ssh_user="${2:-root}"
  local ssh_port="${3:-22}"

  install_ssh_key_to_vps "${vps_ip}" "${ssh_user}" "${ssh_port}"

  echo -e "${CYAN}🚀 Running automated Contabo VPS + Coolify v4 setup on ${vps_ip}...${RESET}"
  provision_contabo_vps_remote_script | ssh -i "${COOLIFY_KEY_PATH}" -p "${ssh_port}" "${ssh_user}@${vps_ip}" "bash -s"

  print_connection_summary "${vps_ip}" "${ssh_user}" "${ssh_port}"
}

run_connect_server_only() {
  local vps_ip="$1"
  local ssh_user="${2:-root}"
  local ssh_port="${3:-22}"

  install_ssh_key_to_vps "${vps_ip}" "${ssh_user}" "${ssh_port}"

  echo -e "${CYAN}🔧 Ensuring Docker & SSH settings on Contabo VPS (${vps_ip}) are ready for Coolify...${RESET}"
  ssh -i "${COOLIFY_KEY_PATH}" -p "${ssh_port}" "${ssh_user}@${vps_ip}" '
    set -e
    if ! command -v docker >/dev/null 2>&1; then
      echo "Installing Docker Engine on Contabo VPS..."
      curl -fsSL https://get.docker.com | sh
      systemctl enable --now docker
    fi
    if [[ -d /data/coolify/ssh/keys ]]; then
      for keyfile in /data/coolify/ssh/keys/*.pub; do
        if [[ -f "$keyfile" ]]; then
          pubcontent="$(cat "$keyfile")"
          grep -qxF "$pubcontent" ~/.ssh/authorized_keys 2>/dev/null || echo "$pubcontent" >> ~/.ssh/authorized_keys
        fi
      done
      chmod 600 ~/.ssh/authorized_keys
    fi
    docker --version
  '

  print_connection_summary "${vps_ip}" "${ssh_user}" "${ssh_port}"
}

print_connection_summary() {
  local vps_ip="$1"
  local ssh_user="${2:-root}"
  local ssh_port="${3:-22}"

  echo ""
  echo -e "${GREEN}${BOLD}==============================================================================${RESET}"
  echo -e "${GREEN}${BOLD} 🎉 CONTABO VPS + COOLIFY SETUP & SSH CONNECTION READY!${RESET}"
  echo -e "${GREEN}${BOLD}==============================================================================${RESET}"
  echo -e " 🌐 ${BOLD}Coolify Dashboard URL${RESET} : http://${vps_ip}:8000"
  echo -e " 🖥️  ${BOLD}Server IP / Host${RESET}      : ${vps_ip} (or host.docker.internal if Localhost)"
  echo -e " 👤 ${BOLD}SSH User / Port${RESET}       : ${ssh_user} / ${ssh_port}"
  echo ""
  echo -e "${YELLOW}${BOLD}📋 IF CONNECTING THIS CONTABO VPS AS A REMOTE SERVER IN COOLIFY:${RESET}"
  echo "   1. Go to Coolify -> Keys & Tokens -> Private Keys -> + Add"
  echo "   2. Paste the Private Key below:"
  echo "------------------------------------------------------------------------------"
  cat "${COOLIFY_KEY_PATH}"
  echo "------------------------------------------------------------------------------"
  echo "   3. Go to Coolify -> Servers -> + Add Server"
  echo "      • IP Address : ${vps_ip}"
  echo "      • Port       : ${ssh_port}"
  echo "      • User       : ${ssh_user}"
  echo "      • Private Key: Select the key you just added -> Click 'Validate Server'"
  echo ""
  echo -e "${CYAN}${BOLD}📦 TO DEPLOY 'คมคิด by KOMKRIT (aiflow)' IN COOLIFY:${RESET}"
  echo "   1. Projects -> + Add -> Create Resource -> Public/Private Git Repository (or Docker Compose)"
  echo "   2. Build Pack       : Dockerfile (or Docker Compose -> docker-compose.yml)"
  echo "   3. Port Exposes     : 8080"
  echo "   4. Healthcheck Path : /api/health"
  echo "   5. Persistent Storage (Volumes):"
  echo "      • Source: komkid_aiflow_data    -> Destination: /app/data"
  echo "      • Source: komkid_aiflow_uploads -> Destination: /app/uploads"
  echo -e "${GREEN}${BOLD}==============================================================================${RESET}"
}

run_direct_ssh_deploy() {
  local vps_ip="$1"
  local ssh_user="${2:-root}"
  local ssh_port="${3:-22}"
  local app_port="${4:-3000}"
  local remote_dir="/opt/komkid-aiflow"

  install_ssh_key_to_vps "${vps_ip}" "${ssh_user}" "${ssh_port}"

  echo -e "${CYAN}📦 Step 1/3: Ensuring Docker & UFW ports are ready on ${vps_ip}...${RESET}"
  ssh -i "${COOLIFY_KEY_PATH}" -p "${ssh_port}" "${ssh_user}@${vps_ip}" "
    if ! command -v docker >/dev/null 2>&1; then
      curl -fsSL https://get.docker.com | sh
      systemctl enable --now docker
    fi
    docker network inspect coolify >/dev/null 2>&1 || docker network create --attachable coolify || true
    ufw allow ${app_port}/tcp >/dev/null 2>&1 || true
    mkdir -p ${remote_dir}
  "

  echo -e "${CYAN}🚀 Step 2/3: Uploading project source to ${ssh_user}@${vps_ip}:${remote_dir}...${RESET}"
  COPYFILE_DISABLE=1 tar \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='.git' \
    --exclude='.microcode' \
    --exclude='data/*.db*' \
    -czf - . | ssh -i "${COOLIFY_KEY_PATH}" -p "${ssh_port}" "${ssh_user}@${vps_ip}" "tar -xzf - -C ${remote_dir} 2>/dev/null"

  echo -e "${CYAN}🐳 Step 3/3: Building & Starting Container on Contabo VPS (Port ${app_port} & Port 80)...${RESET}"
  ssh -i "${COOLIFY_KEY_PATH}" -p "${ssh_port}" "${ssh_user}@${vps_ip}" "
    cd ${remote_dir}
    if [[ ! -f .env && -f .env.example ]]; then
      cp .env.example .env
    fi
    APP_HOST_PORT=${app_port} docker compose up -d --build
    sleep 4
    docker compose ps
    curl -fsS http://127.0.0.1:${app_port}/api/health || true
  "

  echo ""
  echo -e "${GREEN}${BOLD}✅ Deployment Complete!${RESET}"
  echo -e "🌐 Live Application URL (Port 80)   : ${BOLD}http://${vps_ip}${RESET}"
  echo -e "🌐 Live Application URL (Port ${app_port}) : ${BOLD}http://${vps_ip}:${app_port}${RESET}"
  echo -e "🩺 Healthcheck URL                  : ${BOLD}http://${vps_ip}:${app_port}/api/health${RESET}"
}

run_webhook_deploy() {
  local webhook_url="$1"
  local api_token="${2:-}"

  echo -e "${CYAN}🚀 Triggering Coolify Deployment Webhook...${RESET}"
  if [[ -n "${api_token}" ]]; then
    curl -fsSL -X GET "${webhook_url}" \
      -H "Authorization: Bearer ${api_token}" \
      -H "Accept: application/json"
  else
    curl -fsSL -X GET "${webhook_url}" \
      -H "Accept: application/json"
  fi
  echo ""
  echo -e "${GREEN}✅ Coolify deployment triggered successfully!${RESET}"
}

run_setup_cicd() {
  local vps_ip="${1:-${DEFAULT_VPS_IP}}"
  local ssh_user="${2:-root}"
  local ssh_port="${3:-22}"
  local bare_repo="/opt/komkid-aiflow.git"
  local work_tree="/opt/komkid-aiflow"

  ensure_local_ssh_key "${vps_ip}"

  echo -e "${CYAN}⚙️  Step 1/3: Setting up Git Push-to-Deploy bare repository & post-receive hook on ${ssh_user}@${vps_ip}...${RESET}"
  ssh -i "${COOLIFY_KEY_PATH}" -p "${ssh_port}" "${ssh_user}@${vps_ip}" "bash -s" <<EOF
set -e
mkdir -p "${bare_repo}" "${work_tree}/data" "${work_tree}/uploads"
if [[ ! -f "${bare_repo}/HEAD" ]]; then
  git init --bare "${bare_repo}"
fi
cat > "${bare_repo}/hooks/post-receive" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
WORK_TREE="/opt/komkid-aiflow"
GIT_DIR="/opt/komkid-aiflow.git"
echo "======================================================"
echo "🚀 [CI/CD] Received Git push -> Deploying to Contabo VPS..."
echo "======================================================"
mkdir -p "\${WORK_TREE}/data" "\${WORK_TREE}/uploads"
git --work-tree="\${WORK_TREE}" --git-dir="\${GIT_DIR}" checkout -f main || git --work-tree="\${WORK_TREE}" --git-dir="\${GIT_DIR}" checkout -f
cd "\${WORK_TREE}"
if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
fi
docker network inspect coolify >/dev/null 2>&1 || docker network create --attachable coolify
APP_HOST_PORT=3000 docker compose up -d --build --remove-orphans
for i in \$(seq 1 25); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "✅ [CI/CD] Live & Healthy at http://${vps_ip} and http://${vps_ip}:3000"
    exit 0
  fi
  sleep 2
done
echo "⚠️  [CI/CD] Container started; check logs with: docker compose logs -f"
HOOK
chmod +x "${bare_repo}/hooks/post-receive"
EOF

  echo -e "${CYAN}🔗 Step 2/3: Configuring local git remote 'contabo' & GitHub Actions Secrets...${RESET}"
  if git remote get-url contabo >/dev/null 2>&1; then
    git remote set-url contabo "ssh://${ssh_user}@${vps_ip}:${ssh_port}${bare_repo}"
  else
    git remote add contabo "ssh://${ssh_user}@${vps_ip}:${ssh_port}${bare_repo}"
  fi
  git config core.sshCommand "ssh -i ${COOLIFY_KEY_PATH} -o StrictHostKeyChecking=no"

  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    gh secret set VPS_HOST --body "${vps_ip}" || true
    gh secret set VPS_USER --body "${ssh_user}" || true
    gh secret set VPS_PORT --body "${ssh_port}" || true
    gh secret set VPS_SSH_KEY < "${COOLIFY_KEY_PATH}" || true
    echo -e "${GREEN}✅ GitHub Actions Secrets (VPS_HOST, VPS_USER, VPS_PORT, VPS_SSH_KEY) configured on GitHub!${RESET}"
  fi

  echo -e "${CYAN}📦 Step 3/3: Registering Project & Application inside Coolify v4 on ${vps_ip}...${RESET}"
  ssh -i "${COOLIFY_KEY_PATH}" -p "${ssh_port}" "${ssh_user}@${vps_ip}" "docker exec coolify php artisan tinker --execute='
\$project = \App\Models\Project::firstOrCreate(
  [\"name\" => \"คมคิด by KOMKRIT (aiflow)\", \"team_id\" => 0],
  [\"uuid\" => \"komkid-project-prod\", \"description\" => \"Production AI Ad Studio & 9-Agent Content Flow\"]
);
\$env = \App\Models\Environment::firstOrCreate(
  [\"name\" => \"production\", \"project_id\" => \$project->id],
  [\"uuid\" => \"komkid-env-prod\", \"description\" => \"Production Environment on Contabo VPS\"]
);
\$app = \App\Models\Application::updateOrCreate(
  [\"uuid\" => \"komkid-aiflow-app\"],
  [
    \"name\" => \"komkid-by-komkrit-aiflow\",
    \"description\" => \"คมคิด by KOMKRIT — Production WebApp & API\",
    \"fqdn\" => \"http://${vps_ip}.sslip.io\",
    \"git_repository\" => \"XevilA/komkid-by-komkrit-aiflow\",
    \"git_branch\" => \"main\",
    \"git_full_url\" => \"https://github.com/XevilA/komkid-by-komkrit-aiflow.git\",
    \"build_pack\" => \"dockerfile\",
    \"dockerfile_location\" => \"/Dockerfile\",
    \"ports_exposes\" => \"8080\",
    \"base_directory\" => \"/\",
    \"health_check_enabled\" => true,
    \"health_check_path\" => \"/api/health\",
    \"health_check_port\" => \"8080\",
    \"health_check_Method\" => \"GET\",
    \"health_check_return_code\" => 200,
    \"status\" => \"running:healthy\",
    \"environment_id\" => \$env->id,
    \"destination_id\" => 0,
    \"destination_type\" => \App\Models\StandaloneDocker::class,
    \"source_id\" => 0,
    \"source_type\" => \App\Models\GithubApp::class,
    \"private_key_id\" => 0,
    \"manual_webhook_secret_github\" => \"komkid-coolify-webhook-secret\"
  ]
);
echo \"Coolify Registered App UUID: \" . \$app->uuid . \"\n\";
'"

  echo ""
  echo -e "${GREEN}${BOLD}✅ CI/CD Setup Complete!${RESET}"
  echo -e "  • GitHub Actions CI/CD : Push to ${BOLD}origin main${RESET} -> Auto Typecheck + Build + Deploy to ${vps_ip}"
  echo -e "  • Direct Git Push CD   : Run ${BOLD}git push contabo main${RESET} -> Instant build & deploy on ${vps_ip}"
  echo -e "  • Coolify Resource     : Registered in Coolify Dashboard (${BOLD}http://${vps_ip}:8000${RESET})"
}

interactive_menu() {
  banner
  echo "Target Contabo VPS Detected: ${DEFAULT_VPS_HOST} (${DEFAULT_VPS_IP} — Cloud VPS Plus 6, 300 GB)"
  echo ""
  echo "Select what you want to do for your Customer's Contabo VPS & Coolify:"
  echo ""
  echo "  1) 🌟 FULL ALL-IN-ONE: Install Coolify v4 + Setup VPS + Deploy 'คมคิด by KOMKRIT' on ${DEFAULT_VPS_IP}"
  echo "  2) 🛠️  Install Coolify v4 + Docker + Firewall + Swap on Contabo VPS (${DEFAULT_VPS_IP})"
  echo "  3) 🔑 Connect Contabo VPS (${DEFAULT_VPS_IP}) to Existing Coolify (SSH Key + Docker)"
  echo "  4) 🚀 Deploy 'คมคิด by KOMKRIT (aiflow)' Directly to Contabo VPS (${DEFAULT_VPS_IP}:8080)"
  echo "  5) 🌐 Trigger Coolify Auto-Deploy via Webhook URL / API Token"
  echo "  6) 🖥️  Run Setup Directly Inside Contabo VPS Terminal (--on-vps)"
  echo ""
  read -r -p "Enter option [1-6, default: 1]: " choice
  choice="${choice:-1}"

  case "${choice}" in
    1)
      read -r -p "Enter Contabo VPS IP [default: ${DEFAULT_VPS_IP}]: " vps_ip
      read -r -p "Enter SSH Username [default: root]: " ssh_user
      read -r -p "Enter SSH Port [default: 22]: " ssh_port
      read -r -p "Enter App Host Port [default: 8080]: " app_port
      run_setup_vps "${vps_ip:-${DEFAULT_VPS_IP}}" "${ssh_user:-root}" "${ssh_port:-22}"
      run_direct_ssh_deploy "${vps_ip:-${DEFAULT_VPS_IP}}" "${ssh_user:-root}" "${ssh_port:-22}" "${app_port:-8080}"
      ;;
    2)
      read -r -p "Enter Contabo VPS IP [default: ${DEFAULT_VPS_IP}]: " vps_ip
      read -r -p "Enter SSH Username [default: root]: " ssh_user
      read -r -p "Enter SSH Port [default: 22]: " ssh_port
      run_setup_vps "${vps_ip:-${DEFAULT_VPS_IP}}" "${ssh_user:-root}" "${ssh_port:-22}"
      ;;
    3)
      read -r -p "Enter Contabo VPS IP [default: ${DEFAULT_VPS_IP}]: " vps_ip
      read -r -p "Enter SSH Username [default: root]: " ssh_user
      read -r -p "Enter SSH Port [default: 22]: " ssh_port
      run_connect_server_only "${vps_ip:-${DEFAULT_VPS_IP}}" "${ssh_user:-root}" "${ssh_port:-22}"
      ;;
    4)
      read -r -p "Enter Contabo VPS IP [default: ${DEFAULT_VPS_IP}]: " vps_ip
      read -r -p "Enter SSH Username [default: root]: " ssh_user
      read -r -p "Enter SSH Port [default: 22]: " ssh_port
      read -r -p "Enter Host Port to expose [default: 8080]: " app_port
      run_direct_ssh_deploy "${vps_ip:-${DEFAULT_VPS_IP}}" "${ssh_user:-root}" "${ssh_port:-22}" "${app_port:-8080}"
      ;;
    5)
      read -r -p "Enter Coolify Webhook URL (e.g. https://coolify.domain.com/api/v1/deploy?uuid=...): " wh_url
      read -r -p "Enter Coolify API Bearer Token (optional, press Enter to skip): " api_token
      run_webhook_deploy "${wh_url}" "${api_token}"
      ;;
    6)
      provision_contabo_vps_remote_script | bash
      ;;
    *)
      echo -e "${RED}Invalid selection.${RESET}"
      exit 1
      ;;
  esac
}

# --- CLI Argument Dispatcher ---
MODE="${1:-}"
case "${MODE}" in
  --full-all)
    banner
    run_setup_vps "${2:-${DEFAULT_VPS_IP}}" "${3:-root}" "${4:-22}"
    run_direct_ssh_deploy "${2:-${DEFAULT_VPS_IP}}" "${3:-root}" "${4:-22}" "${5:-3000}"
    ;;
  --setup-vps)
    banner
    run_setup_vps "${2:-${DEFAULT_VPS_IP}}" "${3:-root}" "${4:-22}"
    ;;
  --connect-server)
    banner
    run_connect_server_only "${2:-${DEFAULT_VPS_IP}}" "${3:-root}" "${4:-22}"
    ;;
  --deploy-ssh)
    banner
    run_direct_ssh_deploy "${2:-${DEFAULT_VPS_IP}}" "${3:-root}" "${4:-22}" "${5:-3000}"
    ;;
  --setup-cicd)
    banner
    run_setup_cicd "${2:-${DEFAULT_VPS_IP}}" "${3:-root}" "${4:-22}"
    ;;
  --deploy-webhook)
    banner
    run_webhook_deploy "${2:?Missing COOLIFY_WEBHOOK_URL}" "${3:-}"
    ;;
  --on-vps)
    banner
    provision_contabo_vps_remote_script | bash
    ;;
  *)
    interactive_menu
    ;;
esac
