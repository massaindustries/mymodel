#!/usr/bin/env bash
#
# launch_phase2_parallel.sh — Launch BBH, DROP, Minerva Math in 3 parallel tmux sessions
#
# Usage: ./launch_phase2_parallel.sh
#
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE_DIR="${SCRIPT_DIR}/stage4"
LOGS_DIR="${STAGE_DIR}/logs"
API_KEY="sk-NklmaM1W15f-FWYh8Li-mA"

# Clean old results
rm -rf "${STAGE_DIR}/bbh/brick" "${STAGE_DIR}/drop/brick" "${STAGE_DIR}/minerva_math/brick"
mkdir -p "${LOGS_DIR}"

DATE=$(date +%Y-%m-%d)

echo "Launching 3 parallel eval sessions..."

tmux new-session -d -s eval-bbh \
  "REGOLO_API_KEY='${API_KEY}' bash /tmp/run_single_eval.sh bbh_cot_zeroshot bbh 2048 --limit 50 2>&1 | tee '${LOGS_DIR}/brick_bbh_rerun_${DATE}.log'; echo 'Press enter to close'; read"

tmux new-session -d -s eval-drop \
  "REGOLO_API_KEY='${API_KEY}' bash /tmp/run_single_eval.sh drop drop 2048 --num_fewshot 3 --limit 200 --fewshot_as_multiturn True --gen_kwargs '{\"until\":[\"\\n\\n\"]}' 2>&1 | tee '${LOGS_DIR}/brick_drop_rerun_${DATE}.log'; echo 'Press enter to close'; read"

tmux new-session -d -s eval-minerva \
  "REGOLO_API_KEY='${API_KEY}' bash /tmp/run_single_eval.sh minerva_math minerva_math 2048 --num_fewshot 4 --limit 100 --fewshot_as_multiturn True 2>&1 | tee '${LOGS_DIR}/brick_minerva_rerun_${DATE}.log'; echo 'Press enter to close'; read"

echo ""
echo "  eval-bbh      BBH CoT Zeroshot  (~1350 req)"
echo "  eval-drop     DROP              (~200 req)"
echo "  eval-minerva  Minerva Math      (~700 req)"
echo ""
echo "Monitor:  ./check_status.sh"
echo "Attach:   tmux attach -t eval-bbh"
echo "Kill all: tmux kill-session -t eval-bbh; tmux kill-session -t eval-drop; tmux kill-session -t eval-minerva"
