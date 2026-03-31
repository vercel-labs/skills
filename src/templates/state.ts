import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { ParamValue } from './parser.ts';

const PARAMS_FILE = '.params.json';

/**
 * Read saved parameter values from .params.json alongside an installed skill.
 */
export async function readParamState(skillDir: string): Promise<Record<string, ParamValue> | null> {
  try {
    const content = await readFile(join(skillDir, PARAMS_FILE), 'utf-8');
    const parsed = JSON.parse(content) as { params: Record<string, ParamValue> };
    if (parsed.params && typeof parsed.params === 'object') {
      return parsed.params;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write parameter values to .params.json alongside an installed skill.
 */
export async function writeParamState(
  skillDir: string,
  params: Record<string, ParamValue>
): Promise<void> {
  const content = JSON.stringify({ params }, null, 2) + '\n';
  await writeFile(join(skillDir, PARAMS_FILE), content, 'utf-8');
}
