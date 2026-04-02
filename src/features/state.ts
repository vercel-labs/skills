import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

interface FeatureState {
  activated: string[];
  resolved: string[];
}

const STATE_FILE = '.features.json';

/**
 * Read feature state from the .features.json file alongside an installed skill.
 */
export async function readFeatureState(skillDir: string): Promise<FeatureState | null> {
  try {
    const content = await readFile(join(skillDir, STATE_FILE), 'utf-8');
    const parsed = JSON.parse(content) as FeatureState;
    if (Array.isArray(parsed.activated) && Array.isArray(parsed.resolved)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write feature state to the .features.json file alongside an installed skill.
 */
export async function writeFeatureState(skillDir: string, state: FeatureState): Promise<void> {
  const content = JSON.stringify(state, null, 2) + '\n';
  await writeFile(join(skillDir, STATE_FILE), content, 'utf-8');
}
