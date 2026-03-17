#!/usr/bin/env bash
#
# check_status3.sh — Check progress of evals3 tmux sessions + cleanup old ones
#
# Usage: ./check_status3.sh
#

STAGE_DIR="/home/rdseeweb/regolo-semantic-routing/forkGO/evals/stage5"
LOGS_DIR="${STAGE_DIR}/logs"

SESSION_PREFIX="evals3"
# Old session patterns to clean up
OLD_SESSIONS=("evals-v2" "eval-bbh" "eval-drop" "eval-minerva")

##############################################################################
# Cleanup old tmux sessions
##############################################################################

cleaned=0
for old in "${OLD_SESSIONS[@]}"; do
    if tmux has-session -t "$old" 2>/dev/null; then
        tmux kill-session -t "$old"
        echo "[CLEANUP] Killed old tmux session: $old"
        (( cleaned++ ))
    fi
done
[[ $cleaned -gt 0 ]] && echo ""

##############################################################################
# Benchmark definitions — maps task key to log grep pattern and results dir
##############################################################################

# Phase : task_key : log_pattern : results_dir
BENCHMARKS=(
    "P1:mmlu_pro:mmlu_pro:mmlu_pro"
    "P1:arc:arc_challenge:arc_challenge"
    "P1:truthfulqa:truthfulqa:truthfulqa"
    "P2:ifeval:ifeval:ifeval"
    "P2:bbh:bbh_cot_zeroshot:bbh"
    "P2:drop:drop:drop"
    "P2:minerva:minerva_math:minerva_math"
    "P3:humaneval:humaneval:humaneval"
    "P3:mbpp:mbpp:mbpp"
)

##############################################################################
# Session status
##############################################################################

echo "═══════════════════════════════════════════════════════════════"
echo " Evals v3 — Stage 5 Status ($(date '+%H:%M:%S'))"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Show tmux session status
printf "  %-14s  %s\n" "SESSION" "STATUS"
printf "  %-14s  %s\n" "──────────────" "──────────────────"
for p in 1 2 3; do
    session="${SESSION_PREFIX}-p${p}"
    if tmux has-session -t "$session" 2>/dev/null; then
        printf "  %-14s  %s\n" "$session" "RUNNING"
    else
        # Check if any results exist for this phase
        phase_tag="P${p}"
        has_results=false
        for entry in "${BENCHMARKS[@]}"; do
            IFS=: read -r ph _ _ rdir <<< "$entry"
            if [[ "$ph" == "$phase_tag" ]]; then
                if find "${STAGE_DIR}/${rdir}/brick" -name "results*.json" -print -quit 2>/dev/null | grep -q .; then
                    has_results=true
                fi
            fi
        done
        if [[ "$has_results" == "true" ]]; then
            printf "  %-14s  %s\n" "$session" "FINISHED"
        else
            printf "  %-14s  %s\n" "$session" "NOT STARTED"
        fi
    fi
done

##############################################################################
# Per-benchmark progress
##############################################################################

echo ""
printf "  %-5s  %-14s  %6s / %-6s  %5s  %8s  %s\n" \
    "PHASE" "BENCHMARK" "DONE" "TOTAL" "%" "SPEED" "STATUS"
printf "  %-5s  %-14s  %6s   %-6s  %5s  %8s  %s\n" \
    "─────" "──────────────" "──────" "──────" "─────" "────────" "──────────────"

for entry in "${BENCHMARKS[@]}"; do
    IFS=: read -r phase task_key log_pat results_dir <<< "$entry"

    # Check if results already exist
    result_dir="${STAGE_DIR}/${results_dir}/brick"
    if find "${result_dir}" -name "results*.json" -print -quit 2>/dev/null | grep -q .; then
        printf "  %-5s  %-14s  %6s   %-6s  %4s%%  %8s  %s\n" \
            "$phase" "$task_key" "-" "-" "100" "-" "COMPLETED"
        continue
    fi

    # Find the latest log
    log=$(ls -t "${LOGS_DIR}"/brick_${log_pat}*.log 2>/dev/null | head -1)

    if [[ -z "$log" ]]; then
        printf "  %-5s  %-14s  %6s   %-6s  %5s  %8s  %s\n" \
            "$phase" "$task_key" "-" "-" "-" "-" "pending"
        continue
    fi

    # Extract last progress line (lm-eval tqdm output)
    progress_line=$(grep -oP 'Requesting API:\s+\d+%\|[^|]*\|\s*\d+/\d+\s+\[[^\]]+\]' "$log" 2>/dev/null | tail -1)

    if [[ -z "$progress_line" ]]; then
        if grep -q "Saving results" "$log" 2>/dev/null; then
            printf "  %-5s  %-14s  %6s   %-6s  %4s%%  %8s  %s\n" \
                "$phase" "$task_key" "-" "-" "100" "-" "COMPLETED"
        elif grep -q "\[FAIL\]" "$log" 2>/dev/null; then
            err=$(grep -oP '"message":"[^"]*"' "$log" 2>/dev/null | tail -1 | head -c 50)
            printf "  %-5s  %-14s  %6s   %-6s  %5s  %8s  %s\n" \
                "$phase" "$task_key" "-" "-" "-" "-" "FAILED ${err}"
        else
            printf "  %-5s  %-14s  %6s   %-6s  %5s  %8s  %s\n" \
                "$phase" "$task_key" "-" "-" "-" "-" "starting..."
        fi
        continue
    fi

    current=$(echo "$progress_line" | grep -oP '\|\s*\K\d+(?=/)')
    total=$(echo "$progress_line" | grep -oP '/\K\d+(?=\s)')
    pct=$(echo "$progress_line" | grep -oP '\d+(?=%)')
    eta=$(echo "$progress_line" | grep -oP '<\K[^,\]]+')
    speed=$(echo "$progress_line" | grep -oP ',\s*\K[\d.]+s/it')

    printf "  %-5s  %-14s  %6s / %-6s  %4s%%  %8s  %s\n" \
        "$phase" "$task_key" "${current:-?}" "${total:-?}" "${pct:-?}" "${speed:-?}" "ETA ${eta:-?}"
done

echo ""
echo "═══════════════════════════════════════════════════════════════"

# Summary counts
completed=0
total_benchmarks=${#BENCHMARKS[@]}
for entry in "${BENCHMARKS[@]}"; do
    IFS=: read -r _ _ _ rdir <<< "$entry"
    if find "${STAGE_DIR}/${rdir}/brick" -name "results*.json" -print -quit 2>/dev/null | grep -q .; then
        (( completed++ ))
    fi
done
echo " Completed: ${completed}/${total_benchmarks} benchmarks"
echo "═══════════════════════════════════════════════════════════════"
echo ""
