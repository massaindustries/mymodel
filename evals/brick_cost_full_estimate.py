#!/usr/bin/env python3
"""
Brick Full-Scale Cost Estimator

Correlates docker-logs.txt routing decisions with per-benchmark time windows,
then extrapolates from Stage6 (25% cut) to Stage4 (full) sample counts.
"""

import json
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime

# ─────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────

# Benchmark start timestamps from stage6 results filenames
BENCHMARK_WINDOWS = [
    ("mmlu_pro",       "2026-03-07T20:15:28"),
    ("arc_challenge",  "2026-03-07T20:25:26"),
    ("truthfulqa",     "2026-03-07T20:55:12"),
    ("ifeval",         "2026-03-07T21:18:06"),
    ("bbh",            "2026-03-07T21:43:08"),
    ("drop",           "2026-03-07T21:48:11"),
    ("minerva_math",   "2026-03-07T21:55:30"),
    ("humaneval",      "2026-03-07T21:56:40"),
    ("mbpp",           "2026-03-07T22:02:03"),
    ("brick_general",  "2026-03-07T22:16:06"),
]

# Stage6 (25% cut) → Stage4 (full) sample counts
STAGE6_SAMPLES = {
    "mmlu_pro":       406,
    "arc_challenge":  293,
    "truthfulqa":     204,
    "ifeval":         135,
    "bbh":            648,
    "drop":           50,
    "minerva_math":   175,
    "humaneval":      41,
    "mbpp":           125,
    "brick_general":  200,
}

STAGE4_SAMPLES = {
    "mmlu_pro":       6790,
    "arc_challenge":  1172,
    "truthfulqa":     817,
    "ifeval":         541,
    "bbh":            2700,
    "drop":           200,
    "minerva_math":   700,
    "humaneval":      164,
    "mbpp":           500,
    "brick_general":  200,  # Same (custom, not cut)
}

# EUR pricing per 1M tokens
PRICING = {
    "mistral-small3.2":       {"input": 0.50, "output": 2.20, "display": "Mistral-Small-3.2"},
    "gpt-oss-120b":           {"input": 1.00, "output": 4.20, "display": "GPT-OSS-120B"},
    "qwen3-8b":               {"input": 0.07, "output": 0.35, "display": "Qwen3-8B"},
    "qwen3-coder-next":       {"input": 0.50, "output": 2.00, "display": "Qwen3-Coder-Next"},
    "Llama-3.3-70B-Instruct": {"input": 0.60, "output": 2.70, "display": "Llama-3.3-70B"},
}

# Average input/output tokens per sample per benchmark (from cost_report.csv, Brick row)
BRICK_AVG_TOKENS = {
    "mmlu_pro":       {"input": 1384, "output": 121},
    "arc_challenge":  {"input": 165,  "output": 7},
    "truthfulqa":     {"input": 192,  "output": 39},
    "ifeval":         {"input": 80,   "output": 395},
    "bbh":            {"input": 160,  "output": 44},
    "drop":           {"input": 1270, "output": 14},
    "minerva_math":   {"input": 763,  "output": 49},
    "humaneval":      {"input": 329,  "output": 107},
    "mbpp":           {"input": 693,  "output": 72},
    "brick_general":  {"input": 200,  "output": 80},   # estimate
}


def parse_ts(ts_str: str) -> datetime:
    """Parse ISO timestamp."""
    return datetime.fromisoformat(ts_str)


def assign_benchmark(ts: datetime) -> str | None:
    """Assign a timestamp to a benchmark based on sequential time windows."""
    for i, (bench, start_str) in enumerate(BENCHMARK_WINDOWS):
        start = parse_ts(start_str)
        if i + 1 < len(BENCHMARK_WINDOWS):
            end = parse_ts(BENCHMARK_WINDOWS[i + 1][1])
        else:
            end = datetime(2099, 1, 1)

        if start <= ts < end:
            return bench
    return None


def main():
    script_dir = Path(__file__).parent
    docker_logs = script_dir.parent / "docker-logs.txt"

    # ── Step 1: Extract routing decisions with timestamps ──────────
    print("=" * 80)
    print("BRICK FULL-SCALE COST ESTIMATION")
    print("Stage6 (25% cut) → Stage4 (full) extrapolation")
    print("=" * 80)

    print("\n[1] Extracting routing decisions from docker-logs.txt...")

    # Per-benchmark routing: {benchmark: {model: count}}
    bench_routing = defaultdict(Counter)
    total = 0
    unassigned = 0

    with open(docker_logs) as f:
        for line in f:
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            if entry.get("msg") != "routing_decision":
                continue

            total += 1
            ts_str = entry.get("ts", "")
            model = entry.get("selected_model", "unknown")

            try:
                ts = parse_ts(ts_str)
                bench = assign_benchmark(ts)
                if bench:
                    bench_routing[bench][model] += 1
                else:
                    unassigned += 1
            except (ValueError, TypeError):
                unassigned += 1

    print(f"    Total routing decisions: {total}")
    print(f"    Assigned to benchmarks:  {total - unassigned}")
    print(f"    Unassigned (pre-eval):   {unassigned}")

    # ── Step 2: Per-benchmark breakdown ───────────────────────────
    print(f"\n[2] Per-benchmark routing distribution (Stage6 — 25% cut):\n")

    header = f"{'Benchmark':<18} {'Samples':>7} {'Decisions':>9}  {'Model Distribution'}"
    print(header)
    print("-" * 90)

    bench_costs_s6 = {}

    for bench, _ in BENCHMARK_WINDOWS:
        routing = bench_routing.get(bench, Counter())
        s6_samples = STAGE6_SAMPLES.get(bench, 0)
        s6_decisions = sum(routing.values())

        # Model distribution string
        dist_parts = []
        for model, count in routing.most_common():
            pct = 100 * count / s6_decisions if s6_decisions > 0 else 0
            dist_parts.append(f"{model}={count}({pct:.0f}%)")
        dist_str = "  ".join(dist_parts) if dist_parts else "(no data)"

        print(f"{bench:<18} {s6_samples:>7} {s6_decisions:>9}  {dist_str}")

        # Calculate cost for this benchmark at stage6 scale
        avg_tok = BRICK_AVG_TOKENS.get(bench, {"input": 500, "output": 50})
        cost = 0.0
        for model, count in routing.items():
            price = PRICING.get(model)
            if not price:
                continue
            cost += count * (
                avg_tok["input"] * price["input"] / 1_000_000 +
                avg_tok["output"] * price["output"] / 1_000_000
            )
        bench_costs_s6[bench] = cost

    # ── Step 3: Extrapolate to full (Stage4) ──────────────────────
    print(f"\n[3] Extrapolation: Stage6 (25%) → Stage4 (full):\n")

    header = (f"{'Benchmark':<18} {'S6 Samples':>10} {'S4 Samples':>10} "
              f"{'Scale':>6} {'S6 Cost':>10} {'S4 Cost (est)':>13}")
    print(header)
    print("-" * 80)

    total_s6_cost = 0.0
    total_s4_cost = 0.0
    bench_details = {}

    for bench, _ in BENCHMARK_WINDOWS:
        s6 = STAGE6_SAMPLES.get(bench, 0)
        s4 = STAGE4_SAMPLES.get(bench, 0)
        scale = s4 / s6 if s6 > 0 else 1.0

        s6_cost = bench_costs_s6.get(bench, 0.0)
        s4_cost = s6_cost * scale

        total_s6_cost += s6_cost
        total_s4_cost += s4_cost

        # Per-model scaled routing
        routing = bench_routing.get(bench, Counter())
        s6_decisions = sum(routing.values())
        model_breakdown = {}
        for model, count in routing.items():
            scaled_count = count * scale
            price = PRICING.get(model)
            if not price:
                continue
            avg_tok = BRICK_AVG_TOKENS.get(bench, {"input": 500, "output": 50})
            model_cost = scaled_count * (
                avg_tok["input"] * price["input"] / 1_000_000 +
                avg_tok["output"] * price["output"] / 1_000_000
            )
            model_breakdown[model] = {
                "s6_count": count,
                "s4_count_est": round(scaled_count),
                "pct": 100 * count / s6_decisions if s6_decisions > 0 else 0,
                "s4_cost": model_cost,
            }

        bench_details[bench] = {
            "s6_samples": s6,
            "s4_samples": s4,
            "scale_factor": round(scale, 2),
            "s6_cost": round(s6_cost, 4),
            "s4_cost": round(s4_cost, 4),
            "s6_decisions": s6_decisions,
            "routing": routing,
            "model_breakdown": model_breakdown,
        }

        print(f"{bench:<18} {s6:>10} {s4:>10} {scale:>5.1f}x "
              f"€{s6_cost:>9.4f} €{s4_cost:>12.4f}")

    print("-" * 80)
    print(f"{'TOTALE':<18} {sum(STAGE6_SAMPLES.values()):>10} "
          f"{sum(STAGE4_SAMPLES.values()):>10} "
          f"      €{total_s6_cost:>9.4f} €{total_s4_cost:>12.4f}")

    # ── Step 4: Full summary ──────────────────────────────────────
    print(f"\n{'=' * 80}")
    print(f"RISULTATI FINALI")
    print(f"{'=' * 80}")

    print(f"""
  Stage6 (25% cut):
    Routing decisions:  {total - unassigned}
    Costo totale:       €{total_s6_cost:.4f}
    Costo/request:      €{total_s6_cost / max(total - unassigned, 1):.6f}

  Stage4 (FULL — stima estrapolata):
    Campioni totali:    {sum(STAGE4_SAMPLES.values()):,}
    Costo stimato:      €{total_s4_cost:.2f}
    Costo/request:      €{total_s4_cost / max(sum(STAGE4_SAMPLES.values()), 1):.6f}
    """)

    # ── Step 5: Comparison table ──────────────────────────────────
    print(f"CONFRONTO: Brick vs Single-Model (scala Full/Stage4)")
    print(f"-" * 65)

    # Single model costs at stage4 scale (all requests to one model)
    total_s4_samples = sum(STAGE4_SAMPLES.values())

    for model_name, price in sorted(PRICING.items(), key=lambda x: x[1]["display"]):
        model_cost = 0.0
        for bench, _ in BENCHMARK_WINDOWS:
            s4_samples = STAGE4_SAMPLES.get(bench, 0)
            avg_tok = BRICK_AVG_TOKENS.get(bench, {"input": 500, "output": 50})
            model_cost += s4_samples * (
                avg_tok["input"] * price["input"] / 1_000_000 +
                avg_tok["output"] * price["output"] / 1_000_000
            )
        savings = (1 - total_s4_cost / model_cost) * 100 if model_cost > 0 else 0
        print(f"  {price['display']:<25} €{model_cost:>8.2f}   "
              f"{'Brick risparmia' if savings > 0 else 'Brick costa di più'} "
              f"{abs(savings):.0f}%")

    print(f"\n  {'Brick (routed)':<25} €{total_s4_cost:>8.2f}   ← STIMA FULL SCALE")

    # ── Step 6: Per-benchmark model routing at full scale ─────────
    print(f"\n\nDETTAGLIO: Routing stimato a Full Scale per benchmark")
    print(f"{'=' * 80}")

    for bench, _ in BENCHMARK_WINDOWS:
        d = bench_details.get(bench, {})
        if not d.get("model_breakdown"):
            continue
        print(f"\n  {bench} (S4: {d['s4_samples']} samples, scale {d['scale_factor']}x)")
        for model, info in sorted(d["model_breakdown"].items(), key=lambda x: -x[1]["pct"]):
            display = PRICING.get(model, {}).get("display", model)
            print(f"    {display:<25} {info['s4_count_est']:>5} req ({info['pct']:>5.1f}%) → €{info['s4_cost']:.4f}")

    # ── Save JSON ─────────────────────────────────────────────────
    output = {
        "stage6_cost_eur": round(total_s6_cost, 4),
        "stage4_full_cost_eur": round(total_s4_cost, 4),
        "stage6_samples": sum(STAGE6_SAMPLES.values()),
        "stage4_samples": sum(STAGE4_SAMPLES.values()),
        "overall_scale_factor": round(sum(STAGE4_SAMPLES.values()) / max(sum(STAGE6_SAMPLES.values()), 1), 2),
        "benchmarks": {},
    }

    for bench, _ in BENCHMARK_WINDOWS:
        d = bench_details.get(bench, {})
        output["benchmarks"][bench] = {
            "s6_samples": d.get("s6_samples"),
            "s4_samples": d.get("s4_samples"),
            "scale_factor": d.get("scale_factor"),
            "s6_cost_eur": d.get("s6_cost"),
            "s4_cost_eur": d.get("s4_cost"),
            "routing_distribution": {
                model: {
                    "s6_count": info["s6_count"],
                    "s4_count_est": info["s4_count_est"],
                    "pct": round(info["pct"], 1),
                    "s4_cost_eur": round(info["s4_cost"], 4),
                }
                for model, info in d.get("model_breakdown", {}).items()
            },
        }

    out_path = script_dir / "brick_cost_full_estimate.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\n\nSalvato: {out_path}")


if __name__ == "__main__":
    main()
