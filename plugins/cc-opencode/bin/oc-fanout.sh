#!/usr/bin/env bash
# oc-fanout.sh — N개 spec 을 동시에 oc-delegate.sh 로 발사하고 모두 끝나면 합본
# 리포트를 출력. CC Opus 가 한 번의 Bash 호출 (보통 run_in_background=true) 로
# N개 병렬 위임을 트리거하기 위한 진입점.
#
# 동기:
#   메인 Opus 의 호출 흐름이 본질적으로 직렬이라 oc-delegate.sh 를 매 메시지마다
#   한 개씩 background 로 띄워도 turn 간 추론 시간 (수십 초~수 분) 때문에 데몬에
#   실제 도달 시각이 벌어진다. 한 Bash 호출 안에서 N개를 동시 발사하면 turn 추론
#   대기가 끼어들 여지가 없어 데몬이 진짜 병렬 처리한다.
#
# 동시성 제한:
#   기본은 최대 4개 delegate 만 동시에 실행하고 (CC_OC_FANOUT_CONCURRENCY, 기본 4),
#   나머지는 슬롯이 나면 순차 투입한다. 과도한 동시 실행은 provider rate 및 CPU/IO
#   경합으로 개별 세션을 느리게 만들어 stall watchdog(60s 무응답)을 유발할 수 있다.
#   CC_OC_FANOUT_CONCURRENCY=0 이면 무제한(전부 동시 발사 — 구버전 동작).
#
# usage:
#   oc-fanout.sh --dir D [--timeout SEC] spec1.md spec2.md spec3.md ...
#   CC_OC_FANOUT_CONCURRENCY=2 oc-fanout.sh --dir D spec1.md ... spec9.md
#
# stdout (예 N=3):
#   fanout: 3 specs  wall=19597ms  sum=51908ms  ratio=2.65  max_dur=19554ms
#     timeline (column scale: wall):
#       [###########################################################_] s1   24→19578 dur=19554 rc=0
#       [######################################################______] s2   25→17731 dur=17706 rc=0
#       [############################################________________] s3   27→14675 dur=14648 rc=0
#   --- [1] <SESSION_DIR> ---
#   <oc-delegate.sh 7-line report>
#   --- [2] <SESSION_DIR> ---
#   ...
#
# exit code:
#   0      모든 delegate 가 0 으로 종료
#   >0     하나라도 실패 시 가장 높은 delegate exit code 를 그대로 전달
set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DELEG="$PLUGIN_DIR/bin/oc-delegate.sh"

OC_DIR=""
TIMEOUT=""
SPECS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dir)     OC_DIR="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
oc-fanout.sh — N개 spec 을 동시 발사하여 oc-delegate.sh 를 병렬 실행

usage:
  oc-fanout.sh --dir D [--timeout SEC] spec1.md spec2.md ...

flags:
  --dir D          OC working directory (보통 $PWD)
  --timeout SEC    각 delegate 의 timeout (기본 oc-delegate.sh 기본값)

stdout:
  요약 1줄 + ascii timeline + 각 세션의 7-line report 합본

exit code:
  0    모든 delegate 가 0 종료
  >0   하나라도 실패 시 가장 높은 exit code
EOF
      exit 0 ;;
    -*) echo "ERROR: unknown flag $1" >&2; exit 1 ;;
    *)  SPECS+=("$1"); shift ;;
  esac
done
[ -n "$OC_DIR" ] || { echo "ERROR: --dir required" >&2; exit 1; }
[ "${#SPECS[@]}" -ge 1 ] || { echo "ERROR: at least 1 spec required" >&2; exit 1; }

FANOUT_ID="$(date +%s)-$$"
FANOUT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/oc-sessions/fanout-$FANOUT_ID"
if ! mkdir -p "$FANOUT_DIR" 2>/dev/null; then
  FANOUT_DIR="/tmp/oc-fanout-$FANOUT_ID"
  mkdir -p "$FANOUT_DIR"
fi

T0=$(python3 -c 'import time;print(int(time.time()*1000))')

# 동시 실행 상한. 0 = 무제한. 기본 4.
CONCURRENCY="${CC_OC_FANOUT_CONCURRENCY:-4}"

# 실행 중 background job 수가 상한 이상이면 하나 끝날 때까지 대기.
# `wait -n`(bash 4.3+)이 있으면 그걸로, 없으면(macOS bash 3.2) 폴링으로 fallback.
throttle() {
  [ "$CONCURRENCY" -gt 0 ] 2>/dev/null || return 0
  while [ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$CONCURRENCY" ]; do
    wait -n 2>/dev/null || sleep 0.2
  done
}

PIDS=()
SESS=()
for i in "${!SPECS[@]}"; do
  spec="${SPECS[$i]}"
  [ -f "$spec" ] || { echo "ERROR: spec not found: $spec" >&2; exit 1; }
  sd="$FANOUT_DIR/s$((i+1))"
  mkdir -p "$sd"
  SESS+=("$sd")
  throttle
  (
    args=(--dir "$OC_DIR" --prompt-file "$spec" --session-dir "$sd" --title "fanout-$FANOUT_ID-$((i+1))")
    [ -n "$TIMEOUT" ] && args+=(--timeout "$TIMEOUT")
    st=$(python3 -c 'import time;print(int(time.time()*1000))')
    "$DELEG" "${args[@]}" > "$sd/report.txt" 2> "$sd/err.txt"
    rc=$?
    en=$(python3 -c 'import time;print(int(time.time()*1000))')
    echo "$st $en $rc" > "$sd/timing.txt"
  ) &
  PIDS+=($!)
done

MAX_RC=0
for pid in "${PIDS[@]}"; do
  wait "$pid"; rc=$?
  [ "$rc" -gt "$MAX_RC" ] && MAX_RC="$rc"
done

T1=$(python3 -c 'import time;print(int(time.time()*1000))')

python3 - "$FANOUT_DIR" "$T0" "$T1" "${SESS[@]}" <<'PY'
import sys, os
fdir, t0, t1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
sess = sys.argv[4:]

wall = t1 - t0
total = 0; maxd = 0
per=[]
for sd in sess:
    tp=f"{sd}/timing.txt"
    if not os.path.exists(tp):
        per.append((sd,0,0,0,-1)); continue
    st,en,rc = open(tp).read().split()
    st,en,rc = int(st),int(en),int(rc)
    d = en-st
    total += d
    maxd = max(maxd, d)
    per.append((sd, st-t0, en-t0, d, rc))

ratio = total/wall if wall else 0
print(f"fanout: {len(sess)} specs  wall={wall}ms  sum={total}ms  ratio={ratio:.2f}  max_dur={maxd}ms")

W=60
print("  timeline (column scale: wall):")
for sd, s, e, d, rc in per:
    bar=[" "]*W
    if wall>0:
        sb=int(s/wall*W); eb=int(e/wall*W)
        for k in range(max(0,sb), min(W,max(eb,sb+1))): bar[k]="#"
    name=os.path.basename(sd)
    print(f"    [{''.join(bar)}] {name} {s:>5}→{e:<5} dur={d} rc={rc}")

for i,(sd,_,_,_,_rc) in enumerate(per,1):
    rp=f"{sd}/report.txt"
    print(f"--- [{i}] {sd} ---")
    if os.path.exists(rp):
        sys.stdout.write(open(rp).read())
    else:
        print("(no report)")
PY

exit $MAX_RC
