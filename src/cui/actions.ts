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

export class CuiInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CuiInputError';
  }
}

export function assertNonEmpty(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new CuiInputError(`${field} is required`);
  }
  return trimmed;
}

export function oppositeLayer(layer: SkillLayer): SkillLayer {
  return layer === 'project' ? 'global' : 'project';
}

export function filterInstalledSkills(
  skills: CuiInstalledSkill[],
  request: CuiListRequest = {}
): CuiInstalledSkill[] {
  const layer = request.layer ?? 'all';
  const agentSet = request.agents?.length ? new Set(request.agents) : null;

  return skills.filter((skill) => {
    if (layer !== 'all' && skill.layer !== layer) return false;
    if (agentSet && !skill.agents.some((agent) => agentSet.has(agent))) return false;
    return true;
  });
}

export class CuiActions {
  private readonly backend: CuiBackend;

  constructor(backend: CuiBackend) {
    this.backend = backend;
  }

  async list(request: CuiListRequest = {}): Promise<CuiInstalledSkill[]> {
    return filterInstalledSkills(await this.backend.list(request), request);
  }

  async search(request: CuiSearchRequest = {}): Promise<CuiSearchResult[]> {
    return this.backend.search({
      ...request,
      query: request.query?.trim(),
      owner: request.owner?.trim().toLowerCase(),
    });
  }

  async install(request: CuiInstallRequest): Promise<CuiActionResult> {
    const source = assertNonEmpty(request.source, 'source');
    if (request.agents.length === 0) {
      throw new CuiInputError('at least one agent is required');
    }
    return this.backend.install({ ...request, source });
  }

  async update(request: CuiUpdateRequest = {}): Promise<CuiActionResult> {
    return this.backend.update(request);
  }

  async remove(request: CuiRemoveRequest): Promise<CuiActionResult> {
    if (request.names.length === 0) {
      throw new CuiInputError('at least one skill name is required');
    }
    return this.backend.remove(request);
  }

  async move(request: CuiMoveRequest): Promise<CuiActionResult> {
    const name = assertNonEmpty(request.name, 'skill name');
    if (request.fromLayer === request.toLayer) {
      throw new CuiInputError('source and target layers must be different');
    }
    return this.backend.move({ ...request, name });
  }

  async detectAgents() {
    return this.backend.detectAgents?.() ?? [];
  }
}
