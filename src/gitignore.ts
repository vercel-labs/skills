import { access, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const GITIGNORE_PATTERN = '**/skills/npm-*';
const LEGACY_GITIGNORE_PATTERN = 'skills/npm-*';
const GITIGNORE_COMMENT = '# Agent skills from npm packages (managed by skills)';

export async function hasGitignorePattern(cwd: string): Promise<boolean> {
  try {
    const content = await readFile(join(cwd, '.gitignore'), 'utf-8');
    return content.includes(GITIGNORE_PATTERN);
  } catch {
    return false;
  }
}

export async function updateGitignore(
  cwd: string,
  dryRun: boolean = false
): Promise<{ updated: boolean; created: boolean }> {
  const gitignorePath = join(cwd, '.gitignore');

  if (await hasGitignorePattern(cwd)) {
    return { updated: false, created: false };
  }

  let exists = true;
  try {
    await access(gitignorePath);
  } catch {
    exists = false;
  }

  if (dryRun) {
    return { updated: true, created: !exists };
  }

  if (!exists) {
    await writeFile(gitignorePath, `${GITIGNORE_COMMENT}\n${GITIGNORE_PATTERN}\n`, 'utf-8');
    return { updated: true, created: true };
  }

  const content = await readFile(gitignorePath, 'utf-8');

  if (content.includes(LEGACY_GITIGNORE_PATTERN)) {
    const newContent = content.replace(LEGACY_GITIGNORE_PATTERN, GITIGNORE_PATTERN);
    await writeFile(gitignorePath, newContent, 'utf-8');
    return { updated: true, created: false };
  }

  const separator = content.endsWith('\n') ? '\n' : '\n\n';
  await writeFile(
    gitignorePath,
    `${content}${separator}${GITIGNORE_COMMENT}\n${GITIGNORE_PATTERN}\n`,
    'utf-8'
  );
  return { updated: true, created: false };
}
