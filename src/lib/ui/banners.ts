import chalk from 'chalk';

// Brand colors (ported from mymodel-cli-ts MVP src/lib/ui/theme.ts)
export const ACCENT = chalk.hex('#00d4aa');
export const ACCENT_DIM = chalk.hex('#009977');
export const ACCENT_BOLD = chalk.hex('#00d4aa').bold;
export const SUCCESS = chalk.hex('#00d4aa');
export const ERROR = chalk.hex('#ff5555');
export const WARN = chalk.hex('#ffaa00');
export const FEATURE_CYAN = chalk.hex('#00bcd4');
export const FEATURE_PURPLE = chalk.hex('#b388ff');

const LOGO_RAW = `
     ___           ___           ___           ___           ___           ___           ___
    /\\__\\         |\\__\\         /\\__\\         /\\  \\         /\\  \\         /\\  \\         /\\__\\
   /::|  |        |:|  |       /::|  |       /::\\  \\       /::\\  \\       /::\\  \\       /:/  /
  /:|:|  |        |:|  |      /:|:|  |      /:/\\:\\  \\     /:/\\:\\  \\     /:/\\:\\  \\     /:/  /
 /:/|:|__|__      |:|__|__   /:/|:|__|__   /:/  \\:\\  \\   /:/  \\:\\__\\   /::\\~\\:\\  \\   /:/  /
/:/ |::::\\__\\     /::::\\__\\ /:/ |::::\\__\\ /:/__/ \\:\\__\\ /:/__/ \\:|__| /:/\\:\\ \\:\\__\\ /:/__/
\\/__/~~/:/  /    /:/~~/~    \\/__/~~/:/  / \\:\\  \\ /:/  / \\:\\  \\ /:/  / \\:\\~\\:\\ \\/__/ \\:\\  \\
      /:/  /    /:/  /            /:/  /   \\:\\  /:/  /   \\:\\  /:/  /   \\:\\ \\:\\__\\    \\:\\  \\
     /:/  /     \\/__/            /:/  /     \\:\\/:/  /     \\:\\/:/  /     \\:\\ \\/__/     \\:\\  \\
    /:/  /                      /:/  /       \\::/  /       \\::/__/       \\:\\__\\        \\:\\__\\
    \\/__/                       \\/__/         \\/__/         ~~            \\/__/         \\/__/`;

export function printLogo(): void {
  console.log(ACCENT(LOGO_RAW));
  console.log();
}

export function header(text: string): void {
  console.log('\n' + ACCENT_BOLD('━━━ ' + text + ' ' + '━'.repeat(Math.max(0, 60 - text.length))));
}

export function ok(text: string): void {
  console.log(SUCCESS('  ✓ ') + text);
}

export function warn(text: string): void {
  console.log(WARN('  ! ') + text);
}

export function err(text: string): void {
  console.log(ERROR('  ✗ ') + text);
}

export function info(text: string): void {
  console.log(chalk.dim('  · ') + text);
}

export function banner(): void {
  printLogo();
  console.log(ACCENT_DIM('   self-hosted semantic router gateway'));
  console.log();
}
