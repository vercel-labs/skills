import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { AGENTS_DIR } from './constants.ts';

/**
 * Durable, machine-readable record of installed skills.
 *
 * Lives at ~/.agents/skills-inventory.json. Updated on add/remove/update.
 * Designed to be parsed by fleet-management agents (Intune detection
 * scripts, JAMF extension attributes, osquery, etc.) — not by humans.
 *
 * Distinct from `skills-lock.json` which is per-project and tracks the
 * resolution graph. The inventory is per-user-global and tracks the
 * effective installed state across scopes.
 */

export const INVENTORY_VERSION = 1;

export interface InventoryEntry {
  /** Sanitized skill directory name (matches on-disk location). */
  name: string;
  /** Original source identifier (e.g. "github.com/vercel-labs/agent-skills"). */
  source: string;
  /** Resolved ref (commit SHA, tag, branch) if known. */
  ref?: string;
  /** Content hash for integrity verification, if known. */
  content_hash?: string;
  /** "global" or "project". */
  scope: 'global' | 'project';
  /** Absolute project root for project-scoped entries; absent for global. */
  project_path?: string;
  /** ISO-8601 install timestamp. */
  installed_at: string;
  /** Which provider class installed this (github / gitlab / .well-known / etc.) */
  provider_id?: string;
}

export interface Inventory {
  version: typeof INVENTORY_VERSION;
  updated_at: string;
  skills: InventoryEntry[];
}

export function getInventoryPath(): string {
  return join(homedir(), AGENTS_DIR, 'skills-inventory.json');
}

async function readInventoryRaw(path: string): Promise<Inventory | null> {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8'));
    if (raw && typeof raw === 'object' && raw.version === INVENTORY_VERSION) {
      return raw as Inventory;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function readInventory(): Promise<Inventory> {
  const existing = await readInventoryRaw(getInventoryPath());
  if (existing) return existing;
  return { version: INVENTORY_VERSION, updated_at: new Date().toISOString(), skills: [] };
}

async function writeInventory(inv: Inventory): Promise<void> {
  const path = getInventoryPath();
  await mkdir(dirname(path), { recursive: true });
  inv.updated_at = new Date().toISOString();
  await writeFile(path, JSON.stringify(inv, null, 2) + '\n', 'utf-8');
}

function sameEntry(a: InventoryEntry, b: InventoryEntry): boolean {
  return (
    a.name === b.name && a.scope === b.scope && (a.project_path ?? '') === (b.project_path ?? '')
  );
}

/**
 * Add or update an entry in the inventory. Idempotent on (name, scope,
 * project_path); later writes overwrite earlier ones.
 */
export async function recordSkillInstall(entry: InventoryEntry): Promise<void> {
  const inv = await readInventory();
  inv.skills = inv.skills.filter((e) => !sameEntry(e, entry));
  inv.skills.push(entry);
  await writeInventory(inv);
}

/**
 * Remove an entry. Silent if not present.
 */
export async function recordSkillRemove(
  match: Pick<InventoryEntry, 'name' | 'scope' | 'project_path'>
): Promise<void> {
  const inv = await readInventory();
  const filtered = inv.skills.filter(
    (e) =>
      !(
        e.name === match.name &&
        e.scope === match.scope &&
        (e.project_path ?? '') === (match.project_path ?? '')
      )
  );
  if (filtered.length === inv.skills.length) return;
  inv.skills = filtered;
  await writeInventory(inv);
}
