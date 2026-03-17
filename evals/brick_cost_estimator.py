#!/usr/bin/env python3
"""
Brick Cost Estimator: Analyzes actual routing from docker-logs.txt
and calculates real-world Brick costs based on routing distribution.
"""

import json
import re
from pathlib import Path
from collections import Counter
from dataclasses import dataclass

@dataclass
class RoutingStats:
    """Routing statistics from docker-logs.txt"""
    total_decisions: int
    model_distribution: dict[str, int]  # model_name -> count

def extract_routing_decisions(docker_log_path: Path) -> RoutingStats:
    """Extract routing decisions from docker-logs.txt"""
    model_distribution = Counter()
    total_decisions = 0

    with open(docker_log_path) as f:
        for line in f:
            # Skip empty lines
            if not line.strip():
                continue

            # Try to parse as JSON
            try:
                log_entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Look for routing_decision events
            if log_entry.get("msg") == "routing_decision":
                total_decisions += 1
                selected_model = log_entry.get("selected_model", "unknown")
                # Normalize model name (convert dashes to underscores for consistency)
                normalized = selected_model.replace("-", "_")
                model_distribution[normalized] += 1

    return RoutingStats(
        total_decisions=total_decisions,
        model_distribution=dict(model_distribution)
    )

def load_pricing(pricing_path: Path) -> dict:
    """Load pricing from pricing.json"""
    with open(pricing_path) as f:
        return json.load(f)

def estimate_brick_cost(
    docker_log_path: Path,
    pricing_path: Path,
    stage5_brick_samples_dir: Path
) -> dict:
    """
    Estimate Brick cost by:
    1. Extracting routing distribution from docker-logs
    2. Reading Brick samples to get token counts
    3. Calculating weighted cost based on routing distribution
    """

    print("=" * 70)
    print("BRICK COST ESTIMATION FROM DOCKER-LOGS")
    print("=" * 70)

    # Step 1: Extract routing distribution
    print("\n1️⃣ Extracting routing decisions from docker-logs.txt...")
    routing_stats = extract_routing_decisions(docker_log_path)

    print(f"   Total routing decisions: {routing_stats.total_decisions}")
    print(f"   Models selected:")
    for model, count in sorted(
        routing_stats.model_distribution.items(),
        key=lambda x: -x[1]
    ):
        pct = (count / routing_stats.total_decisions * 100) if routing_stats.total_decisions > 0 else 0
        print(f"      - {model}: {count} ({pct:.1f}%)")

    # Step 2: Load pricing
    print("\n2️⃣ Loading pricing data...")
    pricing_data = load_pricing(pricing_path)
    models_pricing = pricing_data["models"]

    # Model normalization map for pricing lookup
    model_mapping = {
        "mistral_small3": "mistral32",
        "mistral_small3_2": "mistral32",
        "qwen3_8b": "qwen3_8b",
        "gpt_oss_120b": "gptoss120b",
        "gpt_oss_20b": "gptoss20b",
        "llama_3": "llama70b",
        "llama_3_3_70b": "llama70b",
    }

    print(f"   Loaded pricing for {len(models_pricing)} models")
    for model_key, model_info in models_pricing.items():
        if model_info.get("input_per_1M"):
            print(f"      - {model_info.get('display_name', model_key)}: "
                  f"€{model_info['input_per_1M']}/M input, "
                  f"€{model_info['output_per_1M']}/M output")

    # Step 3: Count tokens from Brick samples
    print(f"\n3️⃣ Counting tokens from Brick samples...")
    if not stage5_brick_samples_dir.exists():
        print(f"   ⚠️ Stage5 Brick samples directory not found: {stage5_brick_samples_dir}")
        return {}

    total_brick_tokens = {"input": 0, "output": 0, "samples": 0}
    benchmark_samples = {}

    for benchmark_dir in sorted(stage5_brick_samples_dir.parent.parent.iterdir()):
        brick_dir = benchmark_dir / "brick" / "brick"
        if not brick_dir.exists():
            continue

        benchmark_name = benchmark_dir.name
        samples_files = list(brick_dir.glob("samples_*.jsonl"))

        if not samples_files:
            continue

        bench_tokens = {"input": 0, "output": 0, "samples": 0}

        for samples_file in samples_files:
            try:
                with open(samples_file) as f:
                    for line in f:
                        if not line.strip():
                            continue
                        try:
                            sample = json.loads(line)
                            bench_tokens["samples"] += 1

                            # Count input tokens (rough estimate: 4 chars per token)
                            # This is approximate - ideally would use actual tokenizer
                            try:
                                messages_str = sample["arguments"]["gen_args_0"]["arg_0"]
                                if isinstance(messages_str, list):
                                    messages_str = messages_str[0]
                                messages = json.loads(messages_str)
                                text = json.dumps(messages)
                                bench_tokens["input"] += len(text) // 4
                            except:
                                pass

                            # Count output tokens
                            try:
                                resp_text = sample.get("resps", [[None]])[0][0] or ""
                                bench_tokens["output"] += len(resp_text) // 4
                            except:
                                pass
                        except json.JSONDecodeError:
                            pass
            except Exception as e:
                pass

        if bench_tokens["samples"] > 0:
            benchmark_samples[benchmark_name] = bench_tokens
            total_brick_tokens["input"] += bench_tokens["input"]
            total_brick_tokens["output"] += bench_tokens["output"]
            total_brick_tokens["samples"] += bench_tokens["samples"]

            print(f"   {benchmark_name:20s}: {bench_tokens['samples']:5d} samples, "
                  f"input={bench_tokens['input']:10,d} output={bench_tokens['output']:10,d} tokens")

    # Step 4: Calculate cost based on routing distribution
    print(f"\n4️⃣ Calculating Brick cost based on routing distribution...")

    estimated_costs = {}
    total_weighted_cost = 0.0

    for model, count in routing_stats.model_distribution.items():
        # Try to map model name to pricing key
        pricing_key = model

        # Try fuzzy matching
        for pm_key in models_pricing.keys():
            if pm_key.replace("_", "") == model.replace("_", ""):
                pricing_key = pm_key
                break
            if model in pm_key or pm_key in model:
                pricing_key = pm_key
                break

        pricing_info = models_pricing.get(pricing_key)

        if not pricing_info or not pricing_info.get("input_per_1M"):
            print(f"   ⚠️ No pricing found for {model} (tried key: {pricing_key})")
            continue

        # Calculate cost for this model selection
        input_price = pricing_info["input_per_1M"]
        output_price = pricing_info["output_per_1M"]

        # Calculate cost per request (average across benchmarks)
        avg_input_tokens = total_brick_tokens["input"] / max(total_brick_tokens["samples"], 1)
        avg_output_tokens = total_brick_tokens["output"] / max(total_brick_tokens["samples"], 1)

        cost_per_request = (
            (avg_input_tokens * input_price / 1_000_000) +
            (avg_output_tokens * output_price / 1_000_000)
        )

        total_cost_for_model = cost_per_request * count
        total_weighted_cost += total_cost_for_model

        estimated_costs[model] = {
            "display_name": pricing_info.get("display_name", model),
            "count": count,
            "pct": (count / routing_stats.total_decisions * 100) if routing_stats.total_decisions > 0 else 0,
            "cost_per_request": cost_per_request,
            "total_cost": total_cost_for_model,
        }

        print(f"   {pricing_info.get('display_name', model):20s}: {count:5d} requests × "
              f"€{cost_per_request:.4f} = €{total_cost_for_model:.2f}")

    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"\nBrick Routing Analysis:")
    print(f"  Total routing decisions: {routing_stats.total_decisions}")
    print(f"  Total Brick tokens (samples): input={total_brick_tokens['input']:,}, output={total_brick_tokens['output']:,}")
    print(f"  Avg tokens per request: input={total_brick_tokens['input']/max(total_brick_tokens['samples'],1):.0f}, output={total_brick_tokens['output']/max(total_brick_tokens['samples'],1):.0f}")

    print(f"\n💰 **ESTIMATED BRICK TOTAL COST: €{total_weighted_cost:.2f}**")
    print(f"\nCost breakdown by model:")
    for model in sorted(estimated_costs.keys()):
        info = estimated_costs[model]
        print(f"  {info['display_name']:20s}: {info['pct']:5.1f}% (€{info['total_cost']:.2f})")

    # Min/Max range
    costs_list = [info["total_cost"] for info in estimated_costs.values()]
    if costs_list:
        print(f"\nEstimated cost range:")
        print(f"  Min (if all requests to cheapest): €{min(costs_list):.2f}")
        print(f"  Max (if all requests to most expensive): €{max(costs_list):.2f}")
        print(f"  Actual (weighted by routing): €{total_weighted_cost:.2f}")

    return {
        "total_cost_eur": total_weighted_cost,
        "routing_distribution": routing_stats.model_distribution,
        "cost_breakdown": estimated_costs,
        "brick_tokens": total_brick_tokens,
    }

def main():
    script_dir = Path(__file__).parent
    docker_logs_path = script_dir.parent / "docker-logs.txt"
    pricing_path = script_dir / "pricing.json"
    stage5_brick_samples_dir = script_dir / "stage5" / "arc_challenge" / "brick" / "brick"

    if not docker_logs_path.exists():
        print(f"Error: docker-logs.txt not found at {docker_logs_path}")
        return

    if not pricing_path.exists():
        print(f"Error: pricing.json not found at {pricing_path}")
        return

    result = estimate_brick_cost(docker_logs_path, pricing_path, stage5_brick_samples_dir)

    # Save result
    output_path = script_dir / "brick_cost_estimate.json"
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2, default=str)
    print(f"\n✅ Results saved to {output_path}")

if __name__ == "__main__":
    main()
