#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pc from 'picocolors';
import { logger } from './utils/logger.ts';
import { runAdd, parseAddOptions, initTelemetry } from './commands/add.ts';
import { runFind } from './commands/find.ts';
import { runList } from './commands/list.ts';
import { removeCommand, parseRemoveOptions } from './commands/remove.ts';
import { runInit } from './commands/init.ts';
import { runCheck } from './commands/check.ts';
import { runUpdate } from './commands/update.ts';
import { showLogo, showBanner, showHelp, showRemoveHelp } from './ui/banner.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const VERSION = getVersion();
initTelemetry(VERSION);

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showBanner();
    return;
  }

  const command = args[0];
  const restArgs = args.slice(1);

  switch (command) {
    case 'find':
    case 'search':
    case 'f':
    case 's':
      showLogo();
      logger.line();
      await runFind(restArgs);
      break;
    case 'init':
      showLogo();
      logger.line();
      runInit(restArgs);
      break;
    case 'i':
    case 'install':
    case 'a':
    case 'add': {
      showLogo();
      const { source, options } = parseAddOptions(restArgs);
      await runAdd(source, options);
      break;
    }
    case 'remove':
    case 'rm':
    case 'r':
      // Check for --help or -h flag
      if (restArgs.includes('--help') || restArgs.includes('-h')) {
        showRemoveHelp();
        break;
      }
      const { skills, options: removeOptions } = parseRemoveOptions(restArgs);
      await removeCommand(skills, removeOptions);
      break;
    case 'list':
    case 'ls':
      await runList(restArgs);
      break;
    case 'check':
      runCheck(restArgs);
      break;
    case 'update':
    case 'upgrade':
      runUpdate();
      break;
    case '--help':
    case '-h':
      showHelp();
      break;
    case '--version':
    case '-v':
      logger.log(VERSION);
      break;

    default:
      logger.error(`Unknown command: ${command}`);
      logger.log(`Run ${pc.bold('cognit --help')} for usage.`);
  }
}

main();
