#!/usr/bin/env bash
# static-check.sh —— 静态门禁（不启浏览器），覆盖 Arch §5.1 硬规则与 §4.1 契约
#
# 用法: ./qa/static-check.sh
# 退出码: 0=全过；1=有违规
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 2
bad=0
ok()   { echo "  PASS  $*"; }
no()   { echo "  FAIL  $*"; bad=$((bad+1)); }

echo "== 1. 资源必须全相对路径（禁止 /assets/ 这类站点根路径）=="
if grep -rnE '(src|href)="/|url\(/|["'"'"']/assets/' index.html assets/ 2>/dev/null | grep -v '^\s*//' ; then
  no "发现以 / 开头的资源路径（线上子路径会 404）"
else ok "无站根绝对路径"; fi

echo "== 2. 零外链（Arch §5.1：禁止 CDN/字体/图标/统计）=="
if grep -rnE 'https?://|//cdn\.|@import url\(https?' index.html assets/ 2>/dev/null ; then
  no "存在外部引用"
else ok "无外部引用"; fi

echo "== 3. data-testid 契约（§4.1 共 11 个，名字不许改）=="
want="btn-pause btn-reset btn-settings btn-skip btn-start phase-label progress round-count settings-panel status-label time-display"
have="$(grep -o 'data-testid="[^"]*"' index.html | sed 's/data-testid="//;s/"//' | sort -u | tr '\n' ' ' | sed 's/ $//')"
missing=""
for id in $want; do case " $have " in *" $id "*) ;; *) missing="$missing $id" ;; esac; done
if [[ -n "$missing" ]]; then no "缺少 testid:$missing"; else ok "11 个 testid 齐全"; fi
extra=""
for id in $have; do case " $want " in *" $id "*) ;; *) extra="$extra $id" ;; esac; done
[[ -z "$extra" ]] && ok "无多余 testid" || echo "  NOTE  额外 testid:$extra（不算失败，确认是否契约外新增）"

echo "== 4. 调试口只在 ?debug=1 挂载（§4.2）=="
if grep -q "get('debug') === '1'\|get('debug')==='1'" assets/js/*.js && grep -q 'window.__pf' assets/js/*.js ; then
  ok "存在 debug 守卫（运行时由 c02-nondebug 再验）"
else no "未找到 debug 参数守卫或 __pf 挂载"; fi

echo "== 5. 持久化 key 前缀（Arch §4.3）=="
if grep -q "pomodoro-focus:v1" assets/js/storage.js ; then ok "key = pomodoro-focus:v1"; else no "storage key 不是 pomodoro-focus:v1"; fi

echo "== 6. nginx 片段硬规则（方案 B：无 alias/try_files/autoindex）=="
SNIP="$(ls ops/*.conf docs/*.conf 2>/dev/null | head -1)"
if [[ -n "$SNIP" ]]; then
  if grep -nE '\balias\b|\btry_files\b|\bautoindex\b' "$SNIP"; then no "$SNIP 含禁用指令"; else ok "$SNIP 不含 alias/try_files/autoindex"; fi
  grep -qE 'location = /pomodoro-focus' "$SNIP" && ok "含补尾斜杠 301 规则" || no "$SNIP 缺少 location = /pomodoro-focus 301"
  grep -qE 'root\s+/var/www' "$SNIP" && ok "自带 root /var/www（不依赖继承）" || no "$SNIP 缺少 root /var/www"
else
  echo "  NOTE  未找到 ops/*.conf，跳过（Ops 交付片段后再跑）"
fi

echo "== 7. 计时模型不得用递减计数（R1：禁止 remaining--）=="
if grep -rnE 'remaining\s*--|remainingMs\s*-=\s*[0-9]' assets/js/*.js ; then
  no "发现递减式计时（后台会漂移）"
else ok "未发现 remaining-- 递减式计时"; fi

echo "------"
[[ "$bad" -eq 0 ]] && { echo "静态门禁全过"; exit 0; } || { echo "静态门禁失败 $bad 项"; exit 1; }
