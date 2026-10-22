#!/usr/bin/env bash
# 番茄时钟 · 发布脚本（方案 B：显式 location + 单行 include）
#
#   ./ops/release.sh --dry-run   # 默认行为：只打印计划与前置检查，不动服务器
#   ./ops/release.sh --yes       # 真正发布（用户已明确确认后才允许）
#
# 设计原则：任一环节失败即停止；配置类动作失败自动回滚配置；上线后验证失败自动整体回滚。
set -euo pipefail

SSH_HOST="${PF_SSH_HOST:-hk}"
SERVER_NAME="${PF_SERVER_NAME:-hk.hsddns.com}"
SITE_CONF="/etc/nginx/sites-enabled/whatsapp-ai-hk"
SNIPPET="/etc/nginx/snippets/pomodoro-focus.conf"
WEBROOT="/var/www/pomodoro-focus"
STAGING="/tmp/pomodoro-focus-staging"
INCLUDE_LINE="    include ${SNIPPET}; # pomodoro-focus"
ANCHOR="    listen 443 ssl; # managed by Certbot"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="/etc/nginx/backups/pre-pomodoro-${TS}"
MODE="dry-run"

case "${1:-}" in
  --yes) MODE="apply" ;;
  --dry-run|"") MODE="dry-run" ;;
  *) echo "用法: $0 [--dry-run|--yes]" >&2; exit 2 ;;
esac

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }
rssh() { ssh -o BatchMode=yes "$SSH_HOST" "$@"; }

# ---------- 1. 本地前置检查（与服务器无关，dry-run 也跑） ----------
log "1/9 本地前置检查"
[[ -f "$REPO_ROOT/index.html" ]] || die "缺少 $REPO_ROOT/index.html（Dev 尚未交付？）"
[[ -d "$REPO_ROOT/assets" ]]     || die "缺少 $REPO_ROOT/assets/"
[[ -f "$REPO_ROOT/ops/nginx/pomodoro-focus.conf" ]] || die "缺少 nginx 片段"
# 绝对路径检查覆盖发布范围内的全部文件（index.html + assets），任一命中即中止
ABS_PAT='(src|href)=["'"'"']?/|from ["'"'"']?/|import\(["'"'"']?/|url\(["'"'"']?/'
if grep -rnE "$ABS_PAT" "$REPO_ROOT/index.html" "$REPO_ROOT/assets" >/dev/null 2>&1; then
  grep -rnE "$ABS_PAT" "$REPO_ROOT/index.html" "$REPO_ROOT/assets" >&2
  die "发布范围内存在绝对路径引用（/xxx），子路径下必 404"
fi
log "   index.html / assets 存在；index.html + assets 全部无绝对路径引用"
log "   HTML=$(wc -c <"$REPO_ROOT/index.html" | tr -d ' ')B  assets=$(find "$REPO_ROOT/assets" -type f | wc -l | tr -d ' ') 个文件"

# 逐个确认发布文件存在（不能只查 index.html）
[ "$(find "$REPO_ROOT/assets" -type f -name '*.css' | wc -l | tr -d ' ')" -ge 1 ] \
  || die "assets 下没有任何 .css"
[ "$(find "$REPO_ROOT/assets/js" -type f -name '*.js' 2>/dev/null | wc -l | tr -d ' ')" -ge 1 ] \
  || die "assets/js 下没有任何 .js"
# index.html 里引用的每一个 ./assets/... 必须真实存在，引用断链当场中止
MISSING_REFS=""
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  [ -f "$REPO_ROOT/${ref#./}" ] || MISSING_REFS="$MISSING_REFS $ref"
done < <(grep -oE '\./assets/[^"'"'"']+' "$REPO_ROOT/index.html" | sort -u)
[ -z "$MISSING_REFS" ] || die "index.html 引用的文件不存在:$MISSING_REFS"
# 发布清单逐个列出（供 leader 核对，不是只报个数）
log "   发布清单："
find "$REPO_ROOT/assets" -type f | sed "s#^$REPO_ROOT/#     #" | sort
printf '     %s\n' "index.html"

# ---------- 2. 远端只读体检 ----------
log "2/9 远端状态体检"
rssh "bash -s" <<'EOS'
set -e
echo "   nginx: $(nginx -v 2>&1)"
echo "   实际生效配置: $(readlink -f /etc/nginx/sites-enabled/whatsapp-ai-hk)"
echo "   location 数: $(grep -cE '^\s*location' /etc/nginx/sites-enabled/whatsapp-ai-hk)（根路径是 301 反代，非静态 root）"
echo "   磁盘: $(df -h /var/www | awk 'NR==2{print $4" 可用 ("$5" 已用)"}')"
EOS

if [[ "$MODE" == "dry-run" ]]; then
  cat <<EOF

[dry-run] 将要执行（未做任何改动）：
  1) 备份配置 → $BACKUP
  2) 上传片段 → $SNIPPET
  3) 在 $SITE_CONF 的「$ANCHOR」之前插入一行 include
  4) nginx -t（失败即还原配置并退出）
  5) 白名单打包（仅 index.html + assets/，qa/docs/ops/.git 不外发）→ $STAGING，
     校验后原子切换到 $WEBROOT（旧目录留为 .bak-$TS）
  6) nginx -s reload
  7) 验证: / 仍 301→/whtasapp/、/whtasapp/ 200、/health 200、/json/ 200、/asset/ 200、
          /frostfall/ 200、/pomodoro-focus 301、/pomodoro-focus/ 200、assets/js/app.js 200，
          并打印两处 Cache-Control
  8) 任一不符 → 自动整体回滚（配置 + 目录）

确认发布请由用户拍板后执行：$0 --yes
EOF
  exit 0
fi

# ---------- 3. 备份 ----------
log "3/9 备份 nginx 配置 → $BACKUP"
rssh "set -e; mkdir -p '$BACKUP'; cp -a /etc/nginx/nginx.conf /etc/nginx/sites-enabled /etc/nginx/sites-available /etc/nginx/snippets /etc/nginx/conf.d '$BACKUP'/ 2>/dev/null || true; nginx -T > '$BACKUP/nginx-T-$TS.conf' 2>/dev/null; echo '   备份完成'"

rollback_config() {
  log "↩ 回滚 nginx 配置"
  rssh "set -e
    cp -a '$BACKUP/nginx.conf' /etc/nginx/nginx.conf
    cp -a '$BACKUP/sites-enabled/.' /etc/nginx/sites-enabled/
    rm -f '$SNIPPET'
    nginx -t" || { printf '✗ 配置回滚后 nginx -t 仍失败，请人工介入\n' >&2; return 1; }
}

# 整体回滚：配置 + 代码目录（首次部署无 .bak 时直接移除新目录）
rollback_all() {
  log "↩ 整体回滚（配置 + 目录）"
  rssh "set -e
    cp -a '$BACKUP/sites-enabled/.' /etc/nginx/sites-enabled/
    rm -f '$SNIPPET'
    if [ -e '$WEBROOT.bak-$TS' ]; then
      rm -rf '$WEBROOT'; mv '$WEBROOT.bak-$TS' '$WEBROOT'
    else
      rm -rf '$WEBROOT'
    fi
    nginx -t && nginx -s reload" || { printf '✗ 回滚未完全成功，请人工介入\n' >&2; return 1; }
}

# ---------- 4. 上片段 ----------
log "4/9 安装片段 → $SNIPPET"
scp -q -o BatchMode=yes "$REPO_ROOT/ops/nginx/pomodoro-focus.conf" "$SSH_HOST:$SNIPPET.tmp"
rssh "set -e; grep -q 'location = /pomodoro-focus' '$SNIPPET.tmp' || { echo '片段内容异常' >&2; exit 1; }; mv '$SNIPPET.tmp' '$SNIPPET'; echo '   已安装'"

# ---------- 5. 注入 include（幂等） ----------
log "5/9 注入 include 行"
rssh "bash -s" <<EOS
set -e
python3 - <<'PY'
p='$SITE_CONF'; anchor='''$ANCHOR'''; inc='''$INCLUDE_LINE'''
s=open(p).read()
if 'pomodoro-focus.conf' in s:
    print('   include 已存在，跳过')
else:
    assert s.count(anchor)==1, 'anchor 不唯一，停止：'+repr(anchor)
    open(p,'w').write(s.replace(anchor, inc+'\n\n'+anchor))
    print('   已插入 include')
PY
EOS

# ---------- 6. 配置校验 ----------
log "6/9 nginx -t"
if ! rssh "nginx -t" 2>&1 | tail -3; then
  rollback_config
  die "nginx -t 未通过，已回滚配置，未 reload"
fi

# ---------- 7. 代码上线（白名单打包 + 原子切换） ----------
log "7/9 白名单打包并上传 → $STAGING"
STAGE_LOCAL="$(mktemp -d)"
trap 'rm -rf "$STAGE_LOCAL"' EXIT
cp -a "$REPO_ROOT/index.html" "$STAGE_LOCAL/"
cp -a "$REPO_ROOT/assets"     "$STAGE_LOCAL/"
# 权限修正（1630 事故根因）：mktemp -d 建的是 0700，rsync -a 会把 0700 带到服务器，
# nginx worker 以 www-data 运行 → 目录不可穿越 → 403 Permission denied。
# 这里统一成 0755 目录 / 0644 文件，与服务器上可正常访问的 /var/www/json-tool 一致。
chmod 755 "$STAGE_LOCAL"
find "$STAGE_LOCAL" -type d -exec chmod 755 {} +
find "$STAGE_LOCAL" -type f -exec chmod 644 {} +
# 白名单硬校验：只有 index.html + assets/ 会被发布，qa/ docs/ ops/ .git/ 永不外发
UNEXPECTED="$(cd "$STAGE_LOCAL" && find . -mindepth 1 -maxdepth 1 ! -name index.html ! -name assets -print)"
[[ -z "$UNEXPECTED" ]] || die "打包目录出现非预期内容，已中止: $UNEXPECTED"
log "   待发布: index.html + $(find "$STAGE_LOCAL/assets" -type f | wc -l | tr -d ' ') 个静态文件（qa/docs/ops 已排除）"
rsync -a --delete "$STAGE_LOCAL/" "$SSH_HOST:$STAGING/"
rssh "set -e
  test -f '$STAGING/index.html'
  test -d '$STAGING/assets'
  if [ -e '$WEBROOT' ]; then mv '$WEBROOT' '$WEBROOT.bak-$TS'; fi
  mv '$STAGING' '$WEBROOT'
  # 双保险：无论上传端权限如何，落地后一律修正为 www-data 可读（目录 755 / 文件 644）
  chmod -R a+rX '$WEBROOT'
  # rsync -a 会把本地 macOS 的 uid 501/staff 原样带过来（服务器上显示 UNKNOWN:staff），统一归位 root:root
  chown -R root:root '$WEBROOT'
  echo \"   目录已切换；旧版（若有）: $WEBROOT.bak-$TS\""

# reload 前的权限门禁（1630 事故后加）：目录可穿越 + 以 worker 身份逐个真读一遍
log "7a/9 权限门禁（1/2）目录可穿越性"
ROOT_STAT="$(rssh "stat -c '%a %U:%G' '$WEBROOT'")"
log "   $WEBROOT → $ROOT_STAT（nginx 以 www-data 运行，需要 755 或等价）"
if [[ "${ROOT_STAT%% *}" != "755" ]]; then
  rollback_all
  die "目标目录权限是 ${ROOT_STAT%% *}，不是 755，nginx 会 403，已整体回滚"
fi
if ! rssh "runuser -u www-data -- test -x '$WEBROOT'" 2>/dev/null; then
  rollback_all
  die "www-data 无法穿越 $WEBROOT，已整体回滚"
fi
log "   ✓ www-data 可穿越目录"

log "7a/9 权限门禁（2/2）以 www-data 身份逐个实测可读"
if ! rssh "set -e
  for f in \$(find '$WEBROOT' -type f); do
    if runuser -u www-data -- test -r \"\$f\" 2>/dev/null; then
      echo \"     ✓ \$f\"
    else
      echo \"     ✗ \$f 不可读（正是 403 的成因）\" >&2
      namei -l \"\$f\" >&2 || true
      exit 1
    fi
  done"; then
  rollback_all
  die "存在 www-data 不可读的文件，nginx 必 403，已整体回滚（未 reload）"
fi

# ---------- 7b. 上线目录白名单核对（服务器实际落盘） ----------
log "7b/9 核对服务器上实际落盘的文件清单"
MANIFEST="$(rssh "find '$WEBROOT' -type f | sort")"
[ -n "$MANIFEST" ] || { printf '✗ 目标目录为空\n' >&2; MANIFEST=""; }
BAD_FILES="$(printf '%s\n' "$MANIFEST" | grep -vE "^${WEBROOT}/(index\.html|assets/.+)$" || true)"
printf '%s\n' "$MANIFEST" | sed 's/^/   /'
log "   ls -R 实际落盘（供核对，qa/docs/ops/.git 应完全不出现）："
rssh "ls -R '$WEBROOT'" | sed 's/^/     /'
if [ -n "$BAD_FILES" ]; then
  printf '✗ 白名单外文件:\n%s\n' "$BAD_FILES" >&2
  rollback_all
  die "上线目录出现白名单外文件，已整体回滚"
fi
log "   白名单核对通过：$(printf '%s\n' "$MANIFEST" | wc -l | tr -d ' ') 个文件，仅 index.html 与 assets/**"

# ---------- 8. reload ----------
log "8/9 nginx -s reload"
rssh "nginx -t" 2>&1 | tail -2
rssh "nginx -s reload && echo '   已 reload'"

# ---------- 9. 验证 ----------
log "9/9 线上验证"
VERIFY_FAIL=0
check() { # path expected [note]
  local code; code=$(rssh "curl -s -o /dev/null -w '%{http_code}' -k --resolve '$SERVER_NAME:443:127.0.0.1' 'https://$SERVER_NAME$1'")
  if [[ "$code" == "$2" ]]; then printf '   ✓ %-34s %s\n' "$1" "$code"
  else printf '   ✗ %-34s 期望 %s 实际 %s\n' "$1" "$2" "$code"; VERIFY_FAIL=1; fi
}
check /            301
check /whtasapp/   200
check /health      200
check /json/       200
check /asset/      200
check /frostfall/  200
check /pomodoro-focus       301
check /pomodoro-focus/      200
check /pomodoro-focus/assets/js/app.js 200

printf '   %-34s ' 'assets 缓存头'
rssh "curl -sI -k --resolve '$SERVER_NAME:443:127.0.0.1' 'https://$SERVER_NAME/pomodoro-focus/assets/js/app.js' | grep -i '^cache-control' | tr -d '\r'"
printf '   %-34s ' 'index 缓存头'
rssh "curl -sI -k --resolve '$SERVER_NAME:443:127.0.0.1' 'https://$SERVER_NAME/pomodoro-focus/' | grep -i '^cache-control' | tr -d '\r'"

if [[ "$VERIFY_FAIL" != 0 ]]; then
  log "✗ 验证失败，开始整体回滚"
  rollback_all
  die "已回滚到发布前状态，请查 nginx error.log 与服务器 journalctl"
fi

cat <<EOF

✓ 发布完成 $TS
  代码: $WEBROOT
  片段: $SNIPPET
  备份: $BACKUP
  上线文件清单（白名单核对通过）:
EOF
printf '%s\n' "$MANIFEST" | sed 's/^/    /'
cat <<EOF
  回滚: rm -f $SNIPPET; sed -i '/pomodoro-focus/d' $SITE_CONF; nginx -t && nginx -s reload
        代码回滚: mv $WEBROOT $WEBROOT.failed && mv $WEBROOT.bak-$TS $WEBROOT
EOF
