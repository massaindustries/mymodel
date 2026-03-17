#!/usr/bin/env bash
#
# check_status.sh — Check progress of running eval tmux sessions
#
# Usage: ./check_status.sh

LOGS_DIR="/home/rdseeweb/regolo-semantic-routing/forkGO/evals/stage4/logs"

printf "\n%-14s  %5s / %-5s  %5s  %8s  %s\n" "SESSION" "DONE" "TOTAL" "%" "SPEED" "STATUS"
printf "%-14s  %5s   %-5s  %5s  %8s  %s\n"   "──────────" "─────" "─────" "─────" "────────" "──────"

for session in eval-bbh eval-drop eval-minerva; do
    task="${session#eval-}"

    # Find the most recent rerun log
    log=$(ls -t "${LOGS_DIR}"/brick_${task}*rerun*.log 2>/dev/null | head -1)

    if [[ -z "$log" ]]; then
        printf "%-14s  %5s   %-5s  %5s  %8s  %s\n" "$session" "-" "-" "-" "-" "no log"
        continue
    fi

    # Is tmux session alive?
    tmux has-session -t "$session" 2>/dev/null
    alive=$?

    # Extract last progress line
    progress_line=$(grep -oP 'Requesting API:\s+\d+%\|[^|]*\|\s*\d+/\d+\s+\[[^\]]+\]' "$log" | tail -1)

    if [[ -z "$progress_line" ]]; then
        if grep -q "Saving results" "$log"; then
            printf "%-14s  %5s   %-5s  %4s%%  %8s  %s\n" "$session" "-" "-" "100" "-" "COMPLETED"
        elif [[ $alive -ne 0 ]]; then
            # Check for errors
            err=$(grep -oP '"error".*"message":"[^"]*"' "$log" | tail -1 | head -c 60)
            printf "%-14s  %5s   %-5s  %5s  %8s  %s\n" "$session" "-" "-" "-" "-" "CRASHED ${err}"
        else
            printf "%-14s  %5s   %-5s  %5s  %8s  %s\n" "$session" "-" "-" "-" "-" "starting..."
        fi
        continue
    fi

    current=$(echo "$progress_line" | grep -oP '\|\s*\K\d+(?=/)')
    total=$(echo "$progress_line" | grep -oP '/\K\d+(?=\s)')
    pct=$(echo "$progress_line" | grep -oP '\d+(?=%)')
    eta=$(echo "$progress_line" | grep -oP '<\K[^,\]]+')
    speed=$(echo "$progress_line" | grep -oP ',\s*\K[\d.]+s/it')

    if grep -q "Saving results" "$log"; then
        status="COMPLETED"
    elif [[ $alive -ne 0 ]]; then
        status="FINISHED"
    else
        status="ETA ${eta:-?}"
    fi

    printf "%-14s  %5s / %-5s  %4s%%  %8s  %s\n" \
        "$session" "${current:-?}" "${total:-?}" "${pct:-?}" "${speed:-?}" "$status"
done

echo ""
