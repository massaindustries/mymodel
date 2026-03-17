#!/usr/bin/env bash
#
# run_evals3.sh — Evals v3: 3 parallel tmux sessions for stage5
#
# Launches up to 3 tmux sessions (evals3-p1, evals3-p2, evals3-p3),
# each running one phase of benchmarks sequentially.
# Output goes to stage5/.
#
# Usage:
#   ./run_evals3.sh                  # Launch all 3 phases in parallel
#   ./run_evals3.sh --phase 1        # Launch only phase 1
#   ./run_evals3.sh --phase 2        # Launch only phase 2
#   ./run_evals3.sh --phase 3        # Launch only phase 3
#   ./run_evals3.sh --dry-run        # Dry run with --limit 5
#
# Monitor:
#   ./check_status3.sh               # Check progress of all sessions
#   tmux attach -t evals3-p1         # Attach to phase 1
#
# Prerequisites:
#   - lm-eval installed at .venv path below
#   - Brick Docker container running on the eval server
#   - REGOLO_API_KEY env var set
#
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"

##############################################################################
# Configuration
##############################################################################

EVALS_DIR="${SCRIPT_DIR}"
STAGE_DIR="${EVALS_DIR}/stage5"
LOGS_DIR="${STAGE_DIR}/logs"
DATE=$(date +%Y-%m-%d)

VENV="/home/rdseeweb/regolo-semantic-routing/.venv"
BRICK_URL="http://213.171.186.210:8000/v1/chat/completions"
MODEL="brick"
TOKENIZER="meta-llama/Llama-3.3-70B-Instruct"

SESSION_PREFIX="evals3"

##############################################################################
# CLI arguments
##############################################################################

PHASE="all"
DRY_RUN=false
INSIDE_TMUX=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --phase)      PHASE="$2"; shift 2 ;;
        --dry-run)    DRY_RUN=true; shift ;;
        --_internal)  INSIDE_TMUX=true; shift ;;
        -h|--help)
            head -25 "${BASH_SOURCE[0]}" | tail -23
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

##############################################################################
# Pre-flight
##############################################################################

if [[ -z "${REGOLO_API_KEY:-}" ]]; then
    echo "ERROR: REGOLO_API_KEY is not set."
    echo "Export it before running: export REGOLO_API_KEY=sk-..."
    exit 1
fi

export OPENAI_API_KEY="${REGOLO_API_KEY}"
mkdir -p "${LOGS_DIR}"

##############################################################################
# System instruction selection
##############################################################################

get_system_instruction() {
    local task=$1
    case "${task}" in
        arc_challenge*|mmlu_pro*|brick_general*)
            echo "For multiple choice questions, end your response with \"the answer is (X)\" where X is the letter."
            ;;
        bbh_cot_zeroshot*)
            echo "End your response with the final answer on its own line."
            ;;
        minerva_math*)
            echo "Put your final numerical answer in \\boxed{}."
            ;;
        drop*)
            echo "Answer the question with a short, direct response."
            ;;
        humaneval*|mbpp*)
            echo "Provide only the implementation code, no explanations or markdown."
            ;;
        ifeval*)
            echo "Follow the formatting instructions precisely."
            ;;
        truthfulqa*)
            echo "Answer concisely."
            ;;
        *)
            echo ""
            ;;
    esac
}

##############################################################################
# Core function — runs a single benchmark
##############################################################################

run_eval() {
    local task=$1
    local output_dir=$2
    local max_tokens=$3
    shift 3
    local extra_flags=("$@")

    local out_dir="${STAGE_DIR}/${output_dir}/brick"
    local log_file="${LOGS_DIR}/brick_${task//,/_}_${DATE}.log"

    # Idempotency: skip if results already exist
    if find "${out_dir}" -name "results*.json" -print -quit 2>/dev/null | grep -q .; then
        echo "[SKIP] ${task} — results exist in ${out_dir}"
        return 0
    fi

    mkdir -p "${out_dir}"

    local model_args="model=${MODEL},base_url=${BRICK_URL},tokenizer_backend=huggingface,tokenizer=${TOKENIZER},stream=false,max_tokens=${max_tokens},temperature=0,top_p=1"

    if [[ "${DRY_RUN}" == "true" ]]; then
        extra_flags+=(--limit 5)
    fi

    local system_instruction
    system_instruction="$(get_system_instruction "${task}")"

    echo "============================================================"
    echo "[RUN] ${task}"
    echo "  Max tokens: ${max_tokens}"
    echo "  System instruction: ${system_instruction:0:80}..."
    echo "  Output: ${out_dir}"
    echo "  Log: ${log_file}"
    echo "  Started: $(date)"
    echo "============================================================"

    (cd /tmp && PYTHONPATH="${EVALS_DIR}:${PYTHONPATH:-}" \
        "${VENV}/bin/python3" -c "import patch_parse_generations; from lm_eval.__main__ import cli_evaluate; cli_evaluate()" \
        run \
        --model "openai-chat-completions" \
        --model_args "${model_args}" \
        --tasks "${task}" \
        --include_path "${EVALS_DIR}/custom_tasks" \
        --output_path "${out_dir}" \
        --log_samples \
        --batch_size 1 \
        --apply_chat_template \
        --trust_remote_code \
        --system_instruction "${system_instruction}" \
        ${extra_flags[@]+"${extra_flags[@]}"} \
    ) 2>&1 | tee "${log_file}" || true

    local status=${PIPESTATUS[0]}
    if [[ ${status} -eq 0 ]]; then
        echo "[DONE] ${task} — SUCCESS ($(date))"
    else
        echo "[FAIL] ${task} — exit code ${status} ($(date))"
    fi
    return ${status}
}

##############################################################################
# Phase definitions
##############################################################################

phase1() {
    echo ""
    echo "################################################################"
    echo "# PHASE 1 — Core benchmarks"
    echo "################################################################"

    run_eval "mmlu_pro" "mmlu_pro" 2048 \
        --num_fewshot 5 --limit 500 --fewshot_as_multiturn True

    run_eval "arc_challenge_chat_nopfx" "arc_challenge" 256

    run_eval "truthfulqa_gen" "truthfulqa" 256
}

phase2() {
    echo ""
    echo "################################################################"
    echo "# PHASE 2 — Extended benchmarks"
    echo "################################################################"

    run_eval "ifeval" "ifeval" 1280

    run_eval "bbh_cot_zeroshot" "bbh" 2048 --limit 50

    run_eval "drop" "drop" 2048 \
        --num_fewshot 3 --limit 200 \
        --fewshot_as_multiturn True \
        --gen_kwargs '{"until":["\n\n"]}'

    run_eval "minerva_math" "minerva_math" 2048 \
        --num_fewshot 4 --limit 100 --fewshot_as_multiturn True
}

phase3() {
    echo ""
    echo "################################################################"
    echo "# PHASE 3 — Code eval"
    echo "################################################################"

    export HF_ALLOW_CODE_EVAL=1

    run_eval "humaneval" "humaneval" 1024 --confirm_run_unsafe_code

    run_eval "mbpp" "mbpp" 512 \
        --num_fewshot 3 --fewshot_as_multiturn True --confirm_run_unsafe_code
}

phase_quick() {
    echo ""
    echo "################################################################"
    echo "# QUICK — brick_general (~200 questions, mixed categories)"
    echo "################################################################"

    run_eval "brick_general" "brick_general" 256
}

##############################################################################
# tmux launcher — spawns parallel sessions
##############################################################################

launch_phase_tmux() {
    local phase_num=$1
    local session="${SESSION_PREFIX}-p${phase_num}"
    local dry_flag=""
    [[ "${DRY_RUN}" == "true" ]] && dry_flag="--dry-run"

    # Kill existing session for this phase
    tmux kill-session -t "${session}" 2>/dev/null || true

    echo "  Launching tmux session '${session}' (phase ${phase_num})"

    tmux new-session -d -s "${session}" \
        "REGOLO_API_KEY='${REGOLO_API_KEY}' bash '${SCRIPT_PATH}' --_internal --phase ${phase_num} ${dry_flag}; echo ''; echo 'Phase ${phase_num} finished. Press Enter to close.'; read"
}

##############################################################################
# Main
##############################################################################

if [[ "${INSIDE_TMUX}" == "true" ]]; then
    # We're inside a tmux session — just run the phase
    echo "========================================"
    echo " Evals v3 — Phase ${PHASE}"
    echo " Date:       ${DATE}"
    echo " Dry run:    ${DRY_RUN}"
    echo " Brick URL:  ${BRICK_URL}"
    echo " Stage dir:  ${STAGE_DIR}"
    echo "========================================"

    case "${PHASE}" in
        1)     phase1 ;;
        2)     phase2 ;;
        3)     phase3 ;;
        quick) phase_quick ;;
        *) echo "ERROR: Invalid phase '${PHASE}'"; exit 1 ;;
    esac

    echo ""
    echo "========================================"
    echo " Phase ${PHASE} complete! ($(date))"
    echo " Results: ${STAGE_DIR}/"
    echo "========================================"
else
    # We're the top-level launcher — spawn tmux sessions
    echo "========================================"
    echo " Evals v3 — Parallel launcher"
    echo " Date:       ${DATE}"
    echo " Phase:      ${PHASE}"
    echo " Dry run:    ${DRY_RUN}"
    echo " Brick URL:  ${BRICK_URL}"
    echo " Stage dir:  ${STAGE_DIR}"
    echo "========================================"
    echo ""

    case "${PHASE}" in
        1)     launch_phase_tmux 1 ;;
        2)     launch_phase_tmux 2 ;;
        3)     launch_phase_tmux 3 ;;
        quick) launch_phase_tmux quick ;;
        all)
            launch_phase_tmux 1
            launch_phase_tmux 2
            launch_phase_tmux 3
            ;;
        *)
            echo "ERROR: Invalid phase '${PHASE}'. Use 1, 2, 3, quick, or all."
            exit 1
            ;;
    esac

    echo ""
    echo "Sessions launched. Monitor with:"
    echo "  ./check_status3.sh"
    echo "  tmux attach -t evals3-p1   # (or p2, p3)"
fi
