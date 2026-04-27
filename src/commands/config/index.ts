import { Command, Flags } from '@oclif/core';
import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { paths } from '../../lib/config/paths.js';
import { ConfigSchema } from '../../lib/config/schema.js';
import { err, info } from '../../lib/ui/banners.js';
import { makeTable } from '../../lib/ui/tables.js';

export default class ConfigShow extends Command {
  static description = 'Show the current configuration (~/.mymodel/config.yaml)';
  static flags = {
    raw: Flags.boolean({ default: false, description: 'print the YAML verbatim (no summary)' }),
    json: Flags.boolean({ default: false, description: 'print as JSON' }),
    path: Flags.boolean({ default: false, description: 'print only the config path' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigShow);

    if (flags.path) { console.log(paths.config); return; }

    let raw: string;
    try { raw = await readFile(paths.config, 'utf8'); }
    catch { err(`no config at ${paths.config}. Run \`mymodel init\` first.`); this.exit(1); }

    if (flags.raw) { process.stdout.write(raw); return; }

    let parsed: any;
    try { parsed = yaml.load(raw); } catch (e: any) { err(`failed to parse YAML: ${e?.message ?? e}`); this.exit(1); }

    if (flags.json) { console.log(JSON.stringify(parsed, null, 2)); return; }

    const cfg = ConfigSchema.parse(parsed);

    info(`config path: ${chalk.cyan(paths.config)}`);
    info(`server port: ${chalk.cyan(String(cfg.server_port))}  ·  default model: ${chalk.cyan(cfg.default_model)}  ·  reasoning effort: ${chalk.cyan(cfg.default_reasoning_effort)}`);

    // providers table
    const provTable = makeTable(['provider', 'type', 'base_url']);
    for (const [id, p] of Object.entries(cfg.providers ?? {})) provTable.push([id, p.type, p.base_url]);
    console.log('\n' + chalk.bold('providers') + '\n' + provTable.toString());

    // models table
    const mTable = makeTable(['model', 'endpoints', 'param_size', 'reasoning_family']);
    for (const [id, m] of Object.entries(cfg.model_config ?? {})) {
      mTable.push([id + (id === cfg.default_model ? chalk.green(' (default)') : ''), (m.preferred_endpoints ?? []).join(','), m.param_size ?? '-', m.reasoning_family ?? '-']);
    }
    console.log('\n' + chalk.bold('models') + '\n' + mTable.toString());

    // decisions table
    const dTable = makeTable(['decision', 'description', 'model(s)', 'reasoning']);
    for (const d of cfg.decisions ?? []) {
      const refs = d.modelRefs.map((r: any) => r.model + (r.use_reasoning ? `*` : '')).join(', ');
      const reasoning = d.modelRefs.some((r: any) => r.use_reasoning) ? `effort=${d.modelRefs[0].reasoning_effort ?? 'medium'}` : '-';
      dTable.push([d.name, d.description ?? '', refs, reasoning]);
    }
    console.log('\n' + chalk.bold('decisions') + '\n' + dTable.toString());

    // features summary
    const features: string[] = [];
    features.push(`classifier: ${cfg.classifier ? chalk.green('on') : chalk.dim('off')}` + (cfg.classifier ? ` (threshold ${cfg.classifier.category_model.threshold})` : ''));
    features.push(`complexity_service: ${cfg.complexity_service?.enabled ? chalk.green('on') : chalk.dim('off')}` + (cfg.complexity_service?.enabled ? ` (${cfg.complexity_service.address}:${cfg.complexity_service.port})` : ''));
    features.push(`brick multimodal: ${cfg.brick?.enabled ? chalk.green('on') : chalk.dim('off')}` + (cfg.brick?.enabled ? ` (STT=${cfg.brick.stt_model} OCR=${cfg.brick.ocr_model} Vision=${cfg.brick.vision_model})` : ''));
    if (cfg.plugins) {
      const enabled = Object.entries(cfg.plugins).filter(([, v]: any) => v?.enabled).map(([k]) => k);
      features.push(`plugins: ${enabled.length ? chalk.green(enabled.join(', ')) : chalk.dim('none')}`);
    }
    features.push(`keyword_rules: ${cfg.keyword_rules.length}  ·  decisions: ${cfg.decisions.length}  ·  models: ${Object.keys(cfg.model_config).length}`);
    console.log('\n' + chalk.bold('features'));
    for (const f of features) console.log('  ' + f);

    info(`\nrun \`mymodel config edit\` to change values interactively, or edit ${paths.config} manually.`);
  }
}
