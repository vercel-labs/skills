const RESET = '\x1b[0m';

export const SKILLS_LOGO_LINES = [
  '███████╗██╗  ██╗██╗██╗     ██╗     ███████╗',
  '██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝',
  '███████╗█████╔╝ ██║██║     ██║     ███████╗',
  '╚════██║██╔═██╗ ██║██║     ██║     ╚════██║',
  '███████║██║  ██╗██║███████╗███████╗███████║',
  '╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝',
] as const;

// Middle grays keep the logo readable on both light and dark terminals.
const SKILLS_LOGO_COLORS = [
  '\x1b[38;5;250m',
  '\x1b[38;5;248m',
  '\x1b[38;5;245m',
  '\x1b[38;5;243m',
  '\x1b[38;5;240m',
  '\x1b[38;5;238m',
] as const;

export function renderSkillsLogo(): string[] {
  return SKILLS_LOGO_LINES.map((line, index) => `${SKILLS_LOGO_COLORS[index]}${line}${RESET}`);
}
