#!/usr/bin/env python3
"""
Brick Cost Calculator: Uses actual routing distribution from docker-logs
and cost_report.csv to calculate real-world Brick costs.
"""

import json
import csv
from pathlib import Path
from collections import defaultdict

def load_cost_report(csv_path: Path) -> dict:
    """Load cost_report.csv and aggregate by model"""
    model_stats = defaultdict(lambda: {
        "total_cost": 0,
        "count": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "benchmarks": []
    })

    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            model = row["model"]
            benchmark = row["benchmark"]

            total_cost = float(row["total_cost_eur"]) if row["total_cost_eur"] else 0
            input_toks = int(row["input_tokens"])
            output_toks = int(row["output_tokens"])
            num_samples = int(row["num_samples"])

            model_stats[model]["total_cost"] += total_cost
            model_stats[model]["count"] += num_samples
            model_stats[model]["input_tokens"] += input_toks
            model_stats[model]["output_tokens"] += output_toks
            model_stats[model]["benchmarks"].append({
                "name": benchmark,
                "samples": num_samples,
                "cost": total_cost
            })

    return dict(model_stats)

def normalize_model_name(model_name: str) -> str:
    """Normalize model name for matching between log and pricing"""
    # Convert from docker-logs format (e.g., "mistral_small3.2") to pricing format (e.g., "mistral32")
    replacements = {
        "mistral_small3.2": "mistral32",
        "mistral-small3.2": "mistral32",
        "gpt_oss_120b": "gptoss120b",
        "gpt-oss-120b": "gptoss120b",
        "gpt_oss_20b": "gptoss20b",
        "gpt-oss-20b": "gptoss20b",
        "qwen3_coder_next": "qwen3coder",
        "qwen3-coder-next": "qwen3coder",
        "qwen3_8b": "qwen3_8b",
        "llama_3.3_70b_instruct": "llama70b",
        "llama-3.3-70b-instruct": "llama70b",
    }

    normalized = model_name.lower().replace("-", "_")
    for key, value in replacements.items():
        if key in normalized or normalized in key:
            return value

    return normalized

def estimate_brick_cost_v2(
    docker_logs_path: Path,
    cost_report_path: Path,
    pricing_path: Path
) -> dict:
    """
    Calculate Brick cost:
    1. Extract routing distribution from docker-logs
    2. Get per-model costs from cost_report.csv
    3. Weight by routing distribution
    """

    print("\n" + "=" * 80)
    print("BRICK COST CALCULATION - REAL-WORLD ROUTING DISTRIBUTION")
    print("=" * 80)

    # Step 1: Extract routing distribution
    print("\n📊 Step 1: Extract routing distribution from docker-logs.txt")
    routing_dist = {}
    total_decisions = 0

    with open(docker_logs_path) as f:
        for line in f:
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                if entry.get("msg") == "routing_decision":
                    total_decisions += 1
                    model = entry.get("selected_model", "unknown")
                    routing_dist[model] = routing_dist.get(model, 0) + 1
            except json.JSONDecodeError:
                continue

    print(f"   Total routing decisions: {total_decisions}")
    print(f"   Models selected:")
    for model in sorted(routing_dist.keys(), key=lambda x: -routing_dist[x]):
        count = routing_dist[model]
        pct = 100 * count / total_decisions
        print(f"      {model:30s}: {count:4d} ({pct:5.1f}%)")

    # Step 2: Load cost data
    print(f"\n💰 Step 2: Load cost report and calculate per-request costs")
    model_costs = load_cost_report(cost_report_path)

    print(f"   Models in cost report: {list(model_costs.keys())}")

    # Calculate per-request cost for each model
    per_request_costs = {}
    for model, stats in model_costs.items():
        if stats["count"] > 0:
            cost_per_request = stats["total_cost"] / stats["count"]
            per_request_costs[model] = {
                "cost_per_request": cost_per_request,
                "total_cost": stats["total_cost"],
                "total_samples": stats["count"],
                "avg_input_tokens": stats["input_tokens"] / stats["count"],
                "avg_output_tokens": stats["output_tokens"] / stats["count"],
                "benchmarks_count": len(stats["benchmarks"])
            }

    print(f"\n   Per-request costs:")
    for model in sorted(per_request_costs.keys()):
        info = per_request_costs[model]
        print(f"      {model:20s}: €{info['cost_per_request']:.4f}/request "
              f"(avg: {info['avg_input_tokens']:.0f} in + {info['avg_output_tokens']:.0f} out tokens)")

    # Step 3: Calculate weighted Brick cost
    print(f"\n🧮 Step 3: Calculate Brick cost based on routing distribution")

    brick_cost_breakdown = {}
    total_brick_cost = 0.0

    for model_log_name, count in sorted(routing_dist.items(), key=lambda x: -x[1]):
        # Normalize model name
        model_key = normalize_model_name(model_log_name)

        # Find matching cost
        cost_info = per_request_costs.get(model_key)
        if not cost_info:
            # Try to find fuzzy match
            for m_key, m_info in per_request_costs.items():
                if m_key.replace("_", "") == model_key.replace("_", ""):
                    cost_info = m_info
                    break

        if not cost_info:
            print(f"   ⚠️  No cost data for {model_log_name} (key: {model_key})")
            continue

        cost_per_request = cost_info["cost_per_request"]
        total_model_cost = cost_per_request * count
        pct = 100 * count / total_decisions

        brick_cost_breakdown[model_log_name] = {
            "model_key": model_key,
            "routing_count": count,
            "routing_pct": pct,
            "cost_per_request": cost_per_request,
            "total_cost": total_model_cost,
            "benchmarks_evaluated": cost_info["benchmarks_count"]
        }

        total_brick_cost += total_model_cost

        print(f"   {model_log_name:30s}: {count:4d} requests ({pct:5.1f}%) × "
              f"€{cost_per_request:.4f} = €{total_model_cost:.2f}")

    # Summary
    print("\n" + "=" * 80)
    print("BRICK COST SUMMARY")
    print("=" * 80)

    print(f"\n✅ **ESTIMATED TOTAL BRICK COST: €{total_brick_cost:.2f}**\n")

    print(f"Cost contribution by model:")
    for model_log_name in sorted(brick_cost_breakdown.keys(),
                                  key=lambda x: -brick_cost_breakdown[x]["total_cost"]):
        info = brick_cost_breakdown[model_log_name]
        print(f"   {model_log_name:30s}: €{info['total_cost']:7.2f} ({info['routing_pct']:5.1f}%)")

    # Comparison with other models
    print(f"\n📈 Comparison with single-model costs:")
    print(f"   Brick (actual routing):       €{total_brick_cost:.2f}")
    for model in sorted(per_request_costs.keys()):
        single_cost = per_request_costs[model]["total_cost"]
        print(f"   {model:30s}: €{single_cost:.2f}")

    # Calculate savings if routing optimally
    min_cost = min(per_request_costs[m]["cost_per_request"] for m in per_request_costs.keys())
    optimal_cost = min_cost * total_decisions
    savings = optimal_cost - total_brick_cost
    savings_pct = (savings / optimal_cost * 100) if optimal_cost > 0 else 0

    print(f"\n💡 Routing analysis:")
    print(f"   If all requests routed to cheapest model: €{optimal_cost:.2f}")
    print(f"   Actual Brick cost:                       €{total_brick_cost:.2f}")
    print(f"   Additional cost vs optimal:              €{savings * -1:.2f} ({savings_pct * -1:.1f}%)")

    return {
        "total_cost_eur": total_brick_cost,
        "routing_distribution": brick_cost_breakdown,
        "per_request_costs": {
            k: v for k, v in per_request_costs.items()
        },
        "comparison": {
            "optimal_cost": optimal_cost,
            "additional_cost": abs(savings),
        }
    }

def main():
    script_dir = Path(__file__).parent
    docker_logs_path = script_dir.parent / "docker-logs.txt"
    cost_report_path = script_dir / "cost_report.csv"
    pricing_path = script_dir / "pricing.json"

    if not docker_logs_path.exists():
        print(f"Error: {docker_logs_path} not found")
        return
    if not cost_report_path.exists():
        print(f"Error: {cost_report_path} not found")
        return

    result = estimate_brick_cost_v2(docker_logs_path, cost_report_path, pricing_path)

    # Save result
    output_path = script_dir / "brick_cost_estimate_final.json"
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\n✅ Results saved to {output_path}")

if __name__ == "__main__":
    main()
