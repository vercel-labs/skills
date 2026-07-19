import { join } from 'path';
import { parseAddOptions, runAdd } from '../add.ts';
import { agents } from '../agents.ts';
import { searchSkillsAPI } from '../find.ts';
import { listInstalledSkills } from '../installer.ts';
import { readLocalLock } from '../local-lock.ts';
import { removeCommand } from '../remove.ts';
import { sanitizeMetadata } from '../sanitize.ts';
import { parseSkillMd } from '../skills.ts';
import { getAllLockedSkills } from '../skill-lock.ts';
import type { AgentType } from '../types.ts';
import { runUpdate } from '../update.ts';
import type {
  CuiActionResult,
  CuiBackend,
  CuiInstallRequest,
  CuiInstalledSkill,
  CuiListRequest,
  CuiMoveRequest,
  CuiRemoveRequest,
  CuiSearchRequest,
  CuiSearchResult,
  CuiUpdateRequest,
  SkillLayer,
} from './types.ts';

function layerToGlobalFlag(layer: SkillLayer): boolean {
  return layer === 'global';
}

function layerFilterToListLayers(layer: CuiListRequest['layer']): SkillLayer[] {
  if (!layer || layer === 'all') return ['project', 'global'];
  return [layer];
}

function layerFilterToUpdateArgs(layer: CuiUpdateRequest['layer']): string[] {
  if (layer === 'project') return ['--project'];
  if (layer === 'global') return ['--global'];
  return [];
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string') return [sanitizeMetadata(value)];
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => sanitizeMetadata(item))
      .filter(Boolean);
  }
  return [];
}

function activationHints(metadata: Record<string, unknown> | undefined): string[] {
  if (!metadata) return [];
  return [
    ...stringArray(metadata.triggers),
    ...stringArray(metadata.trigger),
    ...stringArray(metadata.activation),
    ...stringArray(metadata.activationHints),
    ...stringArray(metadata.whenToUse),
  ];
}

export class CoreCuiBackend implements CuiBackend {
  async list(request: CuiListRequest): Promise<CuiInstalledSkill[]> {
    const layers = layerFilterToListLayers(request.layer);
    const results = await Promise.all(
      layers.map((layer) =>
        listInstalledSkills({
          global: layerToGlobalFlag(layer),
          agentFilter: request.agents,
        })
      )
    );

    const [localLock, globalLock] = await Promise.all([readLocalLock(), getAllLockedSkills()]);
    const metadataByPath = await Promise.all(
      results.flat().map(async (skill) => ({
        skill,
        parsed: await parseSkillMd(join(skill.canonicalPath, 'SKILL.md'), {
          includeInternal: true,
        }),
      }))
    );

    return metadataByPath.map(({ skill, parsed }) => {
      const localEntry = skill.scope === 'project' ? localLock.skills[skill.name] : undefined;
      const globalEntry = skill.scope === 'global' ? globalLock[skill.name] : undefined;
      const metadata = parsed?.metadata;
      const lockEntry = localEntry ?? globalEntry;

      return {
        name: skill.name,
        layer: skill.scope,
        agents: skill.agents,
        path: skill.canonicalPath,
        description: skill.description,
        metadata,
        triggers: activationHints(metadata),
        source: lockEntry?.source,
        sourceUrl: lockEntry?.sourceUrl,
        sourceType: lockEntry?.sourceType,
        ref: lockEntry?.ref,
        skillPath: lockEntry?.skillPath,
        hash: localEntry?.computedHash ?? globalEntry?.skillFolderHash,
        hashKind: localEntry
          ? ('computedHash' as const)
          : globalEntry
            ? ('skillFolderHash' as const)
            : undefined,
        pluginName: globalEntry?.pluginName,
        installedAt: globalEntry?.installedAt,
        updatedAt: globalEntry?.updatedAt,
      };
    });
  }

  async search(request: CuiSearchRequest): Promise<CuiSearchResult[]> {
    return searchSkillsAPI(request.query ?? '', request.owner);
  }

  async install(request: CuiInstallRequest): Promise<CuiActionResult> {
    const args = [request.source];
    if (request.layer === 'global') args.push('--global');
    if (request.copy) args.push('--copy');
    if (request.fullDepth) args.push('--full-depth');
    for (const agent of request.agents) args.push('--agent', agent);
    for (const skill of request.skills ?? []) args.push('--skill', skill);
    args.push('--yes');

    const { source, options, errors } = parseAddOptions(args);
    if (errors.length > 0) {
      return { ok: false, message: errors.join('\n') };
    }

    await runAdd(source, options);
    return { ok: true };
  }

  async update(request: CuiUpdateRequest): Promise<CuiActionResult> {
    await runUpdate([...(request.names ?? []), ...layerFilterToUpdateArgs(request.layer), '--yes']);
    return { ok: true };
  }

  async remove(request: CuiRemoveRequest): Promise<CuiActionResult> {
    await removeCommand(request.names, {
      global: request.layer === 'global',
      agent: request.agents,
      yes: request.skipConfirmation,
    });
    return { ok: true };
  }

  async move(request: CuiMoveRequest): Promise<CuiActionResult> {
    const matchingSkill = (
      await this.list({ layer: request.fromLayer, agents: request.agents })
    ).find((skill) => skill.name === request.name);

    if (!matchingSkill?.path) {
      return {
        ok: false,
        message: `Could not find ${request.name} in ${request.fromLayer} skills.`,
      };
    }

    await this.install({
      source: matchingSkill.path,
      layer: request.toLayer,
      agents: request.agents ?? matchingSkill.agents,
    });
    await this.remove({
      names: [request.name],
      layer: request.fromLayer,
      agents: request.agents,
      skipConfirmation: request.skipConfirmation,
    });

    return { ok: true, message: `Moved ${request.name} to ${request.toLayer}.` };
  }

  async detectAgents() {
    const entries = await Promise.all(
      (Object.keys(agents) as AgentType[]).map(async (id) => ({
        id,
        label: agents[id].displayName,
        detected: await agents[id].detectInstalled(),
      }))
    );
    return entries;
  }
}
