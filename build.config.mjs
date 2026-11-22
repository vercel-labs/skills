import { defineBuildConfig } from 'obuild/config';
import ApiSnapshot from 'tsnapi/rolldown';

// https://github.com/unjs/obuild
export default defineBuildConfig({
  entries: [
    {
      // One bundle for both entries so they share chunks; separate bundles
      // would overwrite each other's tree-shaken copies in dist/_chunks.
      type: 'bundle',
      input: ['./src/cli.ts', './src/index.ts'],
      rolldown: {
        plugins: [
          // Guards the public API: the build fails when it changes. Run
          // `pnpm api:update` after an intended change (see docs/api.md).
          ApiSnapshot({ entryFilter: ({ entryName }) => entryName === '.' }),
        ],
      },
    },
  ],
});
