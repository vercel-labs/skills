import os from 'node:os';
import { join } from 'path';
import { existsSync } from 'fs';
import { agents, detectInstalledAgents } from './agents.ts';
import type { AgentType } from './types.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

export async function runDoctor(version: string): Promise<void> {
  console.log(`\n${BOLD}Skills CLI Doctor${RESET}\n`);

  // System environment
  console.log(`${BOLD}System:${RESET}`);
  console.log(`  OS:      ${TEXT}${os.type()} ${os.release()} (${os.arch()})${RESET}`);
  console.log(`  Node:    ${TEXT}${process.version}${RESET}`);
  console.log(`  Version: ${TEXT}${version}${RESET}`);
  console.log();

  // Agent detection
  console.log(`${BOLD}Detected Agents:${RESET}`);
  const detected = await detectInstalledAgents();

  if (detected.length === 0) {
    console.log(`  ${YELLOW}No supported agents detected on this system.${RESET}`);
  } else {
    for (const agentType of detected) {
      const config = agents[agentType];
      const projectPath = join(process.cwd(), config.skillsDir);
      const globalPath = config.globalSkillsDir;
      const hasProject = existsSync(projectPath);
      const hasGlobal = globalPath ? existsSync(globalPath) : false;

      console.log(`  ${GREEN}*${RESET} ${BOLD}${config.displayName}${RESET}`);
      console.log(
        `      Project: ${hasProject ? TEXT : DIM}${projectPath}${hasProject ? '' : ' (not found)'}${RESET}`
      );
      if (globalPath) {
        console.log(
          `      Global:  ${hasGlobal ? TEXT : DIM}${globalPath}${hasGlobal ? '' : ' (not found)'}${RESET}`
        );
      }
    }
  }

  const totalAgents = Object.keys(agents).length;
  console.log(
    `\n${DIM}${detected.length}/${totalAgents} agents detected. Run 'skills list' to see installed skills.${RESET}\n`
  );
}
