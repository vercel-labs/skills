// Public library entry for the `skills` package.
//
// This lets third-party providers (e.g. private registries) register
// themselves against upstream's `ProviderRegistry` without forking. Users
// load the provider module via `--provider <module>` on the CLI, the
// `SKILLS_PROVIDERS=mod-a,mod-b` env var, or by importing `skills` directly
// from their own Node program.
//
// Example third-party usage:
//   // my-provider/index.ts
//   import { registerProvider } from 'skills';
//   registerProvider({
//     id: 'my-registry',
//     displayName: 'My Registry',
//     match(url) { … },
//     async fetchSkill(url) { … },
//     toRawUrl(url) { return url },
//     getSourceIdentifier(url) { … },
//   });
//
// Then:
//   $ skills --provider my-provider add @my-org/my-skill
export * from './providers/index.ts';
