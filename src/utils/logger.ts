import pc from 'picocolors';
import ora, { type Ora } from 'ora';

export type { Ora } from 'ora';

export interface Logger {
  log(message?: string): void;
  line(): void;
  clear(): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  bold(message: string): void;
  dim(message: string): void;
  section(title: string): void;
  header(title: string): void;
  list(items: string[]): void;
  label(key: string, value: string): void;
  hint(message: string): void;
  command(cmd: string, description: string): void;
  gradient(line: string, color: string): void;
  spinner(text?: string): Ora;
  note(content: string, title?: string): void;
  intro(title: string): void;
  outro(message: string): void;
  cancel(message: string): void;
  step(message: string): void;
  message(message: string): void;
}

export const logger: Logger = {
  log(message = ''): void {
    console.log(message);
  },
  line(): void {
    console.log();
  },
  clear(): void {
    console.clear();
  },
  info(message: string): void {
    console.log(`${pc.blue('ℹ')} ${message}`);
  },
  success(message: string): void {
    console.log(`${pc.green('✓')} ${message}`);
  },
  warning(message: string): void {
    console.log(`${pc.yellow('⚠')} ${message}`);
  },
  error(message: string): void {
    console.log(`${pc.red('✖')} ${message}`);
  },
  debug(message: string): void {
    if (process.env['DEBUG']) {
      console.log(`${pc.dim('⋯')} ${pc.dim(message)}`);
    }
  },
  bold(message: string): void {
    console.log(pc.bold(message));
  },
  dim(message: string): void {
    console.log(pc.dim(message));
  },
  section(title: string): void {
    console.log();
    console.log(pc.bold(pc.cyan(title)));
  },
  header(title: string): void {
    console.log();
    console.log(pc.bold(pc.cyan(`  ${title}`)));
    console.log(pc.dim('  ' + '─'.repeat(title.length + 2)));
    console.log();
  },
  list(items: string[]): void {
    items.forEach((item) => console.log(`${pc.dim('  •')} ${item}`));
  },
  label(key: string, value: string): void {
    console.log(`${pc.dim(`${key}:`)}${' '.repeat(Math.max(1, 10 - key.length))}${value}`);
  },
  hint(message: string): void {
    console.log(pc.dim(message));
  },
  command(cmd: string, description: string): void {
    console.log(`  ${pc.dim('$')} ${pc.white(cmd)}  ${pc.dim(description)}`);
  },
  gradient(line: string, color: string): void {
    const RESET = '\x1b[0m';
    console.log(`${color}${line}${RESET}`);
  },
  spinner(text?: string): Ora {
    const s = ora({ stream: process.stdout });
    if (text) s.start(text);
    return s;
  },
  note(content: string, title?: string): void {
    console.log();
    if (title) {
      console.log(`  ${pc.bold(title)}`);
      console.log();
    }
    for (const line of content.split('\n')) {
      console.log(`  ${line}`);
    }
    console.log();
  },
  intro(title: string): void {
    console.log();
    console.log(pc.bgCyan(pc.black(` ${title} `)));
  },
  outro(message: string): void {
    console.log();
    console.log(message);
    console.log();
  },
  cancel(message: string): void {
    console.log(`${pc.yellow('◆')} ${message}`);
  },
  step(message: string): void {
    console.log(`${pc.cyan('◆')} ${message}`);
  },
  message(message: string): void {
    console.log(`  ${message}`);
  },
};

export default logger;
