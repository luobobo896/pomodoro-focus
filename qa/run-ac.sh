#!/usr/bin/env bash
# run-ac.sh —— 按 AC 逐条执行（默认无头/静默），每轮写一行 test-runs.log
#
# 用法:
#   ./qa/run-ac.sh              # 全量
#   ./qa/run-ac.sh ac05         # 只跑某个 spec（前缀匹配）
#   CHANNEL=external ./qa/run-ac.sh   # 走外部浏览器通道（默认无头），默认 orca
#
# 前置: 在 "/Users/hanson/work/个人文档" 下起 python3 -m http.server 8231（保证子路径 /pomodoro-focus/）
# 退出码: 0=全绿；1=有用例红；2=环境问题（服务不通/执行器缺失）
#
# 规则（群公告 7/8）:
#   - 默认静默通道，绝不起有头窗口
#   - 每轮落一行：时间 | 通道 | URL | 目的 | 耗时 | 结果
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WS="/Users/hanson/.dsh/bot/workspace"
OUT="$HERE/out"
LOG="$WS/test-runs.log"
BASE="http://127.0.0.1:8231/pomodoro-focus/"
CHANNEL="${CHANNEL:-orca}"
FILTER="${1:-}"
TIMEOUT="${TIMEOUT:-110}"

case "$CHANNEL" in
  orca)     RUNNER="$WS/orca-verify.sh" ;;
  external) RUNNER="$WS/real-browser.sh" ;;
  *) echo "CHANNEL 只支持 orca|external（当前: $CHANNEL）" >&2; exit 2 ;;
esac
[[ -x "$RUNNER" ]] || { echo "执行器缺失: $RUNNER" >&2; exit 2; }
curl -s -o /dev/null --max-time 3 "${BASE}?debug=1" || { echo "本地服务不通: $BASE" >&2; exit 2; }

mkdir -p "$OUT"
printf '时间 | 通道 | URL | 目的 | 耗时 | 结果\n' >> "$LOG" 2>/dev/null || true

pass=0; fail=0; red=""
for spec in "$HERE"/specs/*.json; do
  name="$(basename "$spec" .json)"
  [[ -n "$FILTER" && "$name" != *"$FILTER"* ]] && continue
  case_dir="$OUT/$name"
  rm -rf "$case_dir"; mkdir -p "$case_dir"
  start=$(perl -MTime::HiRes=time -e 'printf "%d", time*1000')
  init="$HERE/specs/${name}.init.js"
  run_args=(--spec "$spec" --out "$case_dir" --timeout "$TIMEOUT")
  [[ -f "$init" ]] && run_args+=(--init-script "$init")
  "$RUNNER" "${run_args[@]}" >"$case_dir/run.log" 2>&1
  rc=$?
  ms=$(( $(perl -MTime::HiRes=time -e 'printf "%d", time*1000') - start ))

  json="$(ls -t "$case_dir"/*.json 2>/dev/null | head -1)"
  status="no-json"
  if [[ -n "$json" ]] && jq -e . "$json" >/dev/null 2>&1; then
    status="$(jq -r '.status // "unknown"' "$json")"
    # 运行时错误一律判红（favicon 已在执行器侧白名单）
    cerr="$(jq -r '(.consoleErrors|length) // 0' "$json" 2>/dev/null)"
    perr="$(jq -r '(.pageErrors|length) // 0' "$json" 2>/dev/null)"
    herr="$(jq -r '(.httpErrors|length) // 0' "$json" 2>/dev/null)"
    if [[ "${cerr:-0}" != "0" || "${perr:-0}" != "0" || "${herr:-0}" != "0" ]]; then
      status="fail(runtime-error)"
    fi
  fi

  verdict="FAIL"
  if [[ "$rc" -eq 0 && "$status" == "pass" ]]; then verdict="PASS"; pass=$((pass+1)); else fail=$((fail+1)); red="$red $name(rc=$rc,$status)"; fi
  printf '%s | %s | %s | %s | %ss | %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$CHANNEL" "$BASE" "$name" "$((ms/1000))" "$verdict" >> "$LOG"
  printf '%-24s %-6s rc=%s status=%s %ss\n' "$name" "$verdict" "$rc" "$status" "$((ms/1000))"
done

echo "------"
echo "通过 $pass / 失败 $fail"
[[ "$fail" -eq 0 ]] || { echo "红:$red"; echo "证据: $OUT"; exit 1; }
echo "全绿。证据: $OUT ；日志: $LOG"
exit 0
