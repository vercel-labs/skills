import { getToken } from './auth-store.ts';
import { DEFAULT_BASE_URL } from './login.ts';

interface OrgPack {
  id: string;
  name: string;
  description: string;
}

interface AccessibleOrg {
  slug: string;
  packs: OrgPack[];
}

export async function runOrgs(baseUrl: string = DEFAULT_BASE_URL): Promise<void> {
  const tok = getToken();
  if (!tok) {
    console.log('Not logged in. Run `skills login`.');
    process.exitCode = 1;
    return;
  }

  let orgs: AccessibleOrg[];
  try {
    const res = await fetch(new URL('/api/cli/orgs', baseUrl).toString(), {
      headers: { authorization: `Bearer ${tok.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) {
      console.log('Session expired. Run `skills login`.');
      process.exitCode = 1;
      return;
    }
    if (!res.ok) {
      console.log(`Could not load your organizations (${res.status}).`);
      process.exitCode = 1;
      return;
    }
    if (!res.headers.get('content-type')?.includes('application/json')) {
      console.log('This server does not support `skills orgs` yet.');
      process.exitCode = 1;
      return;
    }
    orgs = ((await res.json()) as { orgs: AccessibleOrg[] }).orgs;
  } catch (error) {
    console.log(`Could not load your organizations: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (!orgs || orgs.length === 0) {
    console.log('No enterprise organizations found for your account.');
    return;
  }

  const installBase = new URL(baseUrl).origin;
  for (const org of orgs) {
    console.log(org.slug);
    if (org.packs.length === 0) {
      console.log('  (no packs yet)');
    } else {
      for (const pack of org.packs) {
        const desc = pack.description ? ` — ${pack.description}` : '';
        console.log(`  ${pack.name}${desc}`);
        console.log(`    npx skills add ${installBase}/p/${pack.id}`);
      }
    }
    console.log();
  }
}
