import packageJson from '../../package.json' with { type: 'json' };

/** Version of the installed `skills` package. */
export const version: string = packageJson.version;
