#!/usr/bin/env python3
"""
Generate a comprehensive CSV report combining:
- Performance scores from cost_report.csv (stage2/stage4 full scale)
- Brick costs from brick_cost_full_estimate.json (extrapolated to full scale)
- Comparisons: score delta, cost savings vs each model
"""

import csv
import json
from pathlib import Path

# ─── Brick estimated costs per benchmark (Stage4 full scale) ──────────────────
# From brick_cost_full_estimate.json
BRICK_FULL_COSTS = {
    "arc_challenge":  {"total_cost_eur": 0.0116, "routing_dominant": "Qwen3-8B",           "routing_pct": 100.0},
    "bbh":            {"total_cost_eur": 0.0353, "routing_dominant": "Llama-3.3-70B",       "routing_pct": 68.0},
    "drop":           {"total_cost_eur": 0.8418, "routing_dominant": "GPT-OSS-120B",        "routing_pct": 83.4},
    "humaneval":      {"total_cost_eur": 0.1880, "routing_dominant": "Qwen3-Coder-Next",    "routing_pct": 99.2},
    "ifeval":         {"total_cost_eur": 1.2142, "routing_dominant": "Mistral-Small-3.2",   "routing_pct": 67.0},
    "mbpp":           {"total_cost_eur": 0.5119, "routing_dominant": "Mistral-Small-3.2",   "routing_pct": 43.0},
    "minerva_math":   {"total_cost_eur": 0.0996, "routing_dominant": "Mistral-Small-3.2",   "routing_pct": 65.9},
    "mmlu_pro":       {"total_cost_eur": 6.6174, "routing_dominant": "Mistral-Small-3.2",   "routing_pct": 52.9},
    "truthfulqa":     {"total_cost_eur": 0.0822, "routing_dominant": "Mistral-Small-3.2",   "routing_pct": 37.0},
    "brick_general":  {"total_cost_eur": 0.0031, "routing_dominant": "GPT-OSS-120B",        "routing_pct": 40.0},
}
BRICK_TOTAL_FULL = sum(v["total_cost_eur"] for v in BRICK_FULL_COSTS.values())

METRIC_LABELS = {
    "exact_match,remove_whitespace": "Accuracy",
    "exact_match,flexible-extract": "Accuracy",
    "exact_match,custom-extract":   "Accuracy",
    "f1,none":                      "F1",
    "pass@1,create_test":           "pass@1",
    "prompt_level_strict_acc,none": "Accuracy (strict)",
    "pass_at_1,none":               "pass@1",
    "math_verify,none":             "Math Accuracy",
    "rouge1_acc,none":              "ROUGE-1 Acc",
}

def pct(v):
    """Format score as percentage string."""
    if v is None:
        return ""
    return f"{float(v)*100:.2f}%"

def eur(v):
    """Format EUR value."""
    if v is None or v == "":
        return ""
    return f"€{float(v):.4f}"

def delta_pp(a, b):
    """Score delta in percentage points (a - b)."""
    if a is None or b is None or a == "" or b == "":
        return ""
    return f"{(float(a) - float(b))*100:+.2f}pp"

def cost_delta(a, b):
    """Cost delta and % savings (a relative to b).
    Positive = a is cheaper than b.
    """
    if a is None or b is None or a == "" or b == "":
        return "", ""
    a, b = float(a), float(b)
    diff = b - a          # positive = a is cheaper
    if b > 0:
        pct_saving = diff / b * 100
    else:
        pct_saving = 0.0
    return f"€{diff:+.4f}", f"{pct_saving:+.1f}%"


def main():
    script_dir = Path(__file__).parent
    csv_in  = script_dir / "cost_report.csv"
    json_in = script_dir / "brick_cost_full_estimate.json"

    # ── Load raw data ──────────────────────────────────────────────
    rows = []
    with open(csv_in) as f:
        for r in csv.DictReader(f):
            rows.append(r)

    with open(json_in) as f:
        brick_full = json.load(f)

    # ── Index: benchmark → { model → row } ──────────────────────
    benchmarks = sorted({r["benchmark"] for r in rows})
    by_bench_model = {}
    for r in rows:
        by_bench_model.setdefault(r["benchmark"], {})[r["model"]] = r

    # ── Build Brick row enriched with full-scale cost ─────────────
    def get_brick(bench):
        r = by_bench_model.get(bench, {}).get("brick")
        if not r:
            return None
        cost_info = BRICK_FULL_COSTS.get(bench, {})
        r = dict(r)
        r["total_cost_eur_fullscale"] = cost_info.get("total_cost_eur", "")
        r["routing_dominant"] = cost_info.get("routing_dominant", "")
        r["routing_pct"]      = cost_info.get("routing_pct", "")
        return r

    # ─────────────────────────────────────────────────────────────
    # OUTPUT 1: Full detail (one row per benchmark × model)
    # ─────────────────────────────────────────────────────────────
    detail_path = script_dir / "eval_full_report.csv"

    detail_cols = [
        "benchmark",
        "metric_label",
        "metric_name",
        "model_key",
        "display_name",
        "is_brick",
        "num_samples",
        # Performance
        "score_raw",
        "score_pct",
        # Tokens
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "avg_input_per_sample",
        "avg_output_per_sample",
        # Costs (full scale)
        "cost_eur_fullscale",
        "cost_per_sample_eur",
        # Brick routing info (only for brick rows)
        "brick_dominant_model",
        "brick_dominant_routing_pct",
        # vs Brick
        "score_delta_vs_brick",
        "cost_vs_brick_eur_delta",
        "cost_vs_brick_savings_pct",
        # Rank within benchmark (by score)
        "score_rank",
    ]

    detail_rows = []

    for bench in benchmarks:
        bench_data = by_bench_model.get(bench, {})
        brick = get_brick(bench)
        metric_name = next(iter(bench_data.values()))["metric_name"] if bench_data else ""
        metric_label = METRIC_LABELS.get(metric_name, metric_name)

        # Collect all scores for ranking
        all_scores = []
        for model_key, r in bench_data.items():
            try:
                all_scores.append((model_key, float(r["score"])))
            except (ValueError, TypeError):
                pass
        all_scores.sort(key=lambda x: -x[1])
        rank_map = {mk: i+1 for i, (mk, _) in enumerate(all_scores)}

        for model_key, r in bench_data.items():
            is_brick = model_key == "brick"

            # Cost at full scale
            if is_brick:
                cost_full = BRICK_FULL_COSTS.get(bench, {}).get("total_cost_eur", "")
                dom_model = BRICK_FULL_COSTS.get(bench, {}).get("routing_dominant", "")
                dom_pct   = BRICK_FULL_COSTS.get(bench, {}).get("routing_pct", "")
            else:
                cost_full = r.get("total_cost_eur", "")
                dom_model = ""
                dom_pct   = ""

            try:
                n = int(r["num_samples"])
                avg_in  = int(r["input_tokens"]) // n  if r["input_tokens"]  else ""
                avg_out = int(r["output_tokens"]) // n if r["output_tokens"] else ""
            except (ValueError, ZeroDivisionError):
                avg_in = avg_out = ""

            try:
                cost_per_sample = float(cost_full) / int(r["num_samples"]) if cost_full and cost_full != "" else ""
            except (ValueError, TypeError):
                cost_per_sample = ""

            # vs Brick
            brick_score = brick["score"] if brick else None
            brick_cost  = BRICK_FULL_COSTS.get(bench, {}).get("total_cost_eur", "")

            score_d = delta_pp(r["score"], brick_score)
            cost_d_eur, cost_d_pct = cost_delta(brick_cost, cost_full)

            detail_rows.append({
                "benchmark":                bench,
                "metric_label":             metric_label,
                "metric_name":              metric_name,
                "model_key":                model_key,
                "display_name":             r["display_name"],
                "is_brick":                 "YES" if is_brick else "no",
                "num_samples":              r["num_samples"],
                "score_raw":                r["score"],
                "score_pct":                pct(r["score"]),
                "input_tokens":             r["input_tokens"],
                "output_tokens":            r["output_tokens"],
                "total_tokens":             r["total_tokens"],
                "avg_input_per_sample":     avg_in,
                "avg_output_per_sample":    avg_out,
                "cost_eur_fullscale":       eur(cost_full),
                "cost_per_sample_eur":      f"€{cost_per_sample:.6f}" if cost_per_sample != "" else "",
                "brick_dominant_model":     dom_model,
                "brick_dominant_routing_pct": f"{dom_pct}%" if dom_pct != "" else "",
                "score_delta_vs_brick":     "+0.00pp (IS BRICK)" if is_brick else score_d,
                "cost_vs_brick_eur_delta":  "(IS BRICK)" if is_brick else cost_d_eur,
                "cost_vs_brick_savings_pct":"(IS BRICK)" if is_brick else cost_d_pct,
                "score_rank":               rank_map.get(model_key, ""),
            })

    with open(detail_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=detail_cols)
        w.writeheader()
        w.writerows(detail_rows)

    print(f"✅ Detail report: {detail_path.name}")

    # ─────────────────────────────────────────────────────────────
    # OUTPUT 2: Summary (one row per benchmark — best model + Brick)
    # ─────────────────────────────────────────────────────────────
    summary_path = script_dir / "eval_summary_report.csv"

    summary_cols = [
        "benchmark",
        "metric_label",
        "num_samples",
        # Brick
        "brick_score_pct",
        "brick_cost_eur",
        "brick_cost_per_sample",
        "brick_dominant_model",
        "brick_dominant_routing_pct",
        # Best model (by score, excluding brick)
        "best_model",
        "best_score_pct",
        "best_cost_eur",
        "best_cost_per_sample",
        # Brick vs best
        "brick_vs_best_score_delta",
        "brick_vs_best_cost_eur_delta",
        "brick_vs_best_cost_savings_pct",
        # Cheapest model
        "cheapest_model",
        "cheapest_score_pct",
        "cheapest_cost_eur",
        # Brick vs cheapest
        "brick_vs_cheapest_score_delta",
        "brick_vs_cheapest_cost_eur_delta",
        # All models scores (for overview)
        "all_models_scores",
    ]

    summary_rows = []

    for bench in benchmarks:
        bench_data = by_bench_model.get(bench, {})
        brick = get_brick(bench)
        metric_name = next(iter(bench_data.values()))["metric_name"] if bench_data else ""
        metric_label = METRIC_LABELS.get(metric_name, metric_name)

        brick_score = float(brick["score"]) if brick else None
        brick_cost  = BRICK_FULL_COSTS.get(bench, {}).get("total_cost_eur")
        n_samples   = int(brick["num_samples"]) if brick else 0

        # Find best non-brick model by score
        non_brick = {
            mk: r for mk, r in bench_data.items()
            if mk != "brick" and r["score"] not in ("", None)
        }
        best_model_key = max(non_brick, key=lambda k: float(non_brick[k]["score"])) if non_brick else None
        best_r = non_brick[best_model_key] if best_model_key else None

        # Find cheapest non-brick model
        priced = {
            mk: r for mk, r in non_brick.items()
            if r.get("total_cost_eur") not in ("", None)
        }
        cheapest_key = min(priced, key=lambda k: float(priced[k]["total_cost_eur"])) if priced else None
        cheapest_r = priced[cheapest_key] if cheapest_key else None

        # All models scores string
        all_scores_parts = []
        for mk, r in sorted(bench_data.items(), key=lambda x: -float(x[1]["score"] or 0)):
            all_scores_parts.append(f"{r['display_name']}={pct(r['score'])}")
        all_scores_str = " | ".join(all_scores_parts)

        # Brick cost per sample
        brick_cps = f"€{brick_cost/n_samples:.6f}" if brick_cost and n_samples else ""

        # Best model cost per sample
        if best_r and best_r.get("total_cost_eur"):
            best_cost = float(best_r["total_cost_eur"])
            best_cps  = f"€{best_cost/int(best_r['num_samples']):.6f}"
        else:
            best_cost = None
            best_cps  = ""

        # Cheapest cost per sample
        if cheapest_r and cheapest_r.get("total_cost_eur"):
            cheapest_cost = float(cheapest_r["total_cost_eur"])
            cheapest_cps  = f"€{cheapest_cost:.4f}"
        else:
            cheapest_cost = None

        # Brick vs best: score delta (positive = brick better)
        b_vs_best_score = delta_pp(brick_score, float(best_r["score"])) if best_r else ""
        # Brick vs best: cost savings (positive = brick cheaper)
        b_vs_best_cost_eur, b_vs_best_cost_pct = cost_delta(brick_cost, best_cost) if best_cost else ("", "")
        # Brick vs cheapest
        b_vs_cheap_score = delta_pp(brick_score, float(cheapest_r["score"])) if cheapest_r else ""
        b_vs_cheap_cost, _ = cost_delta(brick_cost, cheapest_cost) if cheapest_cost else ("", "")

        summary_rows.append({
            "benchmark":                     bench,
            "metric_label":                  metric_label,
            "num_samples":                   n_samples,
            "brick_score_pct":               pct(brick_score),
            "brick_cost_eur":                eur(brick_cost),
            "brick_cost_per_sample":         brick_cps,
            "brick_dominant_model":          BRICK_FULL_COSTS.get(bench, {}).get("routing_dominant", ""),
            "brick_dominant_routing_pct":    f"{BRICK_FULL_COSTS.get(bench, {}).get('routing_pct', '')}%",
            "best_model":                    best_r["display_name"] if best_r else "",
            "best_score_pct":                pct(best_r["score"]) if best_r else "",
            "best_cost_eur":                 eur(best_cost) if best_cost else "",
            "best_cost_per_sample":          best_cps,
            "brick_vs_best_score_delta":     b_vs_best_score,
            "brick_vs_best_cost_eur_delta":  b_vs_best_cost_eur,
            "brick_vs_best_cost_savings_pct":b_vs_best_cost_pct,
            "cheapest_model":                cheapest_r["display_name"] if cheapest_r else "",
            "cheapest_score_pct":            pct(cheapest_r["score"]) if cheapest_r else "",
            "cheapest_cost_eur":             eur(cheapest_cost) if cheapest_cost else "",
            "brick_vs_cheapest_score_delta": b_vs_cheap_score,
            "brick_vs_cheapest_cost_eur_delta": b_vs_cheap_cost,
            "all_models_scores":             all_scores_str,
        })

    with open(summary_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=summary_cols)
        w.writeheader()
        w.writerows(summary_rows)

    print(f"✅ Summary report: {summary_path.name}")

    # ─────────────────────────────────────────────────────────────
    # OUTPUT 3: Totals across all benchmarks
    # ─────────────────────────────────────────────────────────────
    totals_path = script_dir / "eval_totals_report.csv"

    # Aggregate per model
    model_totals = {}
    for r in rows:
        mk = r["model"]
        if mk not in model_totals:
            model_totals[mk] = {
                "display_name": r["display_name"],
                "benchmarks_tested": 0,
                "total_samples": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "total_cost_eur": 0.0,
                "scores": [],
            }
        model_totals[mk]["benchmarks_tested"] += 1
        model_totals[mk]["total_samples"] += int(r["num_samples"])
        model_totals[mk]["total_input_tokens"]  += int(r.get("input_tokens") or 0)
        model_totals[mk]["total_output_tokens"] += int(r.get("output_tokens") or 0)
        try:
            model_totals[mk]["total_cost_eur"] += float(r["total_cost_eur"])
        except (ValueError, TypeError):
            pass
        try:
            model_totals[mk]["scores"].append(float(r["score"]))
        except (ValueError, TypeError):
            pass

    # Override Brick with full-scale estimated cost
    if "brick" in model_totals:
        model_totals["brick"]["total_cost_eur"] = BRICK_TOTAL_FULL

    totals_cols = [
        "model_key",
        "display_name",
        "benchmarks_tested",
        "total_samples",
        "total_input_tokens",
        "total_output_tokens",
        "total_tokens",
        "total_cost_eur",
        "cost_per_sample_avg",
        "avg_score_pct",
        "median_score_pct",
        # vs Brick totals
        "cost_vs_brick_eur",
        "cost_vs_brick_pct",
        "note",
    ]

    # Brick reference
    brick_totals = model_totals.get("brick", {})
    brick_total_cost = brick_totals.get("total_cost_eur", 0)
    brick_total_samples = brick_totals.get("total_samples", 1)

    totals_rows = []
    for mk, t in sorted(model_totals.items(), key=lambda x: -x[1]["total_cost_eur"]):
        scores = t["scores"]
        avg_score = sum(scores) / len(scores) if scores else None
        median_score = sorted(scores)[len(scores)//2] if scores else None

        total_tokens = t["total_input_tokens"] + t["total_output_tokens"]
        cost = t["total_cost_eur"]
        cps = cost / t["total_samples"] if t["total_samples"] else 0

        if mk == "brick":
            cost_diff_eur = ""
            cost_diff_pct = ""
            note = "Full-scale cost extrapolated from Stage6 docker-logs routing distribution"
        else:
            diff = cost - brick_total_cost
            cost_diff_eur = f"€{diff:+.2f}"
            pct_diff = diff / brick_total_cost * 100 if brick_total_cost else 0
            cost_diff_pct = f"{pct_diff:+.1f}%"
            note = "Cost from stage2 full evaluation run"

        totals_rows.append({
            "model_key":            mk,
            "display_name":         t["display_name"],
            "benchmarks_tested":    t["benchmarks_tested"],
            "total_samples":        t["total_samples"],
            "total_input_tokens":   t["total_input_tokens"],
            "total_output_tokens":  t["total_output_tokens"],
            "total_tokens":         total_tokens,
            "total_cost_eur":       eur(cost),
            "cost_per_sample_avg":  f"€{cps:.6f}",
            "avg_score_pct":        pct(avg_score),
            "median_score_pct":     pct(median_score),
            "cost_vs_brick_eur":    cost_diff_eur,
            "cost_vs_brick_pct":    cost_diff_pct,
            "note":                 note,
        })

    with open(totals_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=totals_cols)
        w.writeheader()
        w.writerows(totals_rows)

    print(f"✅ Totals report: {totals_path.name}")

    # ── Print terminal summary ────────────────────────────────────
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║              REPORT SUMMARY                                  ║
╠══════════════════════════════════════════════════════════════╣
║ Brick full-scale estimated cost:  €{BRICK_TOTAL_FULL:>7.2f}              ║
║ Benchmarks:     {len(benchmarks):<5}  Total samples (Brick): {brick_total_samples:>6}    ║
╠══════════════════════════════════════════════════════════════╣
║ TOTALS per model:                                            ║""")
    for r in sorted(totals_rows, key=lambda x: -float(x["total_cost_eur"].replace("€",""))):
        name = r["display_name"][:24]
        cost = r["total_cost_eur"]
        avg  = r["avg_score_pct"]
        diff = r["cost_vs_brick_pct"] or " (baseline)"
        print(f"║   {name:<24} {cost:>10}  avg={avg:>7}  vs Brick={diff:<10}║")
    print(f"╚══════════════════════════════════════════════════════════════╝")
    print(f"""
Files generated:
  📄 eval_full_report.csv     — {len(detail_rows)} rows (benchmark × model detail)
  📄 eval_summary_report.csv  — {len(summary_rows)} rows (per-benchmark summary)
  📄 eval_totals_report.csv   — {len(totals_rows)} rows (per-model totals)
""")


if __name__ == "__main__":
    main()
