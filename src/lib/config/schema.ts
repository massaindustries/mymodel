import { z } from 'zod';

export const ConditionSchema = z.object({
  type: z.enum(['keyword', 'domain', 'complexity']),
  name: z.string(),
});

export type Condition = z.infer<typeof ConditionSchema>;
export type Rule = { operator: 'AND' | 'OR' | 'NOT'; conditions: (Rule | Condition)[] } | Condition;

export const RuleSchema: z.ZodType<Rule> = z.lazy(() =>
  z.union([
    z.object({
      operator: z.enum(['AND', 'OR', 'NOT']),
      conditions: z.array(z.union([RuleSchema, ConditionSchema])),
    }),
    ConditionSchema,
  ])
);

export const ModelRefSchema = z.object({
  model: z.string(),
  use_reasoning: z.boolean().optional(),
  reasoning_effort: z.enum(['low', 'medium', 'high']).optional(),
});

export const DecisionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  rules: RuleSchema,
  modelRefs: z.array(ModelRefSchema).min(1),
});

export const KeywordRuleSchema = z.object({
  name: z.string(),
  operator: z.enum(['AND', 'OR']).default('OR'),
  keywords: z.array(z.string()),
  case_sensitive: z.boolean().default(false),
});

export const ProviderSchema = z.object({
  type: z.string(),
  base_url: z.string().url(),
  api_key: z.string().optional(),
});

export const ProviderProfileSchema = z.object({
  type: z.string(),
  base_url: z.string().url(),
});

export const VllmEndpointSchema = z.object({
  name: z.string(),
  provider_profile: z.string(),
  weight: z.number().default(1),
});

export const ModelConfigSchema = z.object({
  preferred_endpoints: z.array(z.string()),
  param_size: z.string().optional(),
  reasoning_family: z.string().optional(),
});

export const ReasoningFamilySchema = z.object({
  type: z.string(),
  parameter: z.string(),
});

export const ClassifierSchema = z.object({
  category_model: z.object({
    model_id: z.string(),
    use_modernbert: z.boolean().default(true),
    threshold: z.number().default(0.45),
    use_cpu: z.boolean().default(true),
    category_mapping_path: z.string().optional(),
  }),
});

export const ComplexityServiceSchema = z.object({
  enabled: z.boolean(),
  address: z.string(),
  port: z.number(),
  timeout_seconds: z.number().default(5),
});

export const BrickSchema = z.object({
  enabled: z.boolean(),
  stt_model: z.string().optional(),
  stt_endpoint: z.string().url().optional(),
  ocr_model: z.string().optional(),
  ocr_endpoint: z.string().url().optional(),
  vision_model: z.string().optional(),
  vision_endpoint: z.string().url().optional(),
  ocr_min_text_length: z.number().default(10),
});

export const PluginSchema = z.object({
  enabled: z.boolean().default(false),
  action: z.string().optional(),
});

export const ConfigSchema = z.object({
  model: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),
  providers: z.record(ProviderSchema).default({}),
  brick: BrickSchema.optional(),
  server_port: z.number().default(8000),
  auto_model_name: z.string().default('brick'),
  provider_profiles: z.record(ProviderProfileSchema).default({}),
  vllm_endpoints: z.array(VllmEndpointSchema).default([]),
  default_model: z.string(),
  model_config: z.record(ModelConfigSchema).default({}),
  reasoning_families: z.record(ReasoningFamilySchema).default({}),
  default_reasoning_effort: z.enum(['low', 'medium', 'high']).default('medium'),
  classifier: ClassifierSchema.optional(),
  complexity_service: ComplexityServiceSchema.optional(),
  keyword_rules: z.array(KeywordRuleSchema).default([]),
  decisions: z.array(DecisionSchema).default([]),
  plugins: z.record(PluginSchema).optional(),
});

export type BrickConfig = z.infer<typeof ConfigSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
export type KeywordRuleType = z.infer<typeof KeywordRuleSchema>;
