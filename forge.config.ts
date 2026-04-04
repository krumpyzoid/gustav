import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: 'gustav',
    name: 'Gustav',
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['linux'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'gustav',
          productName: 'Gustav',
          description: 'Git worktree manager with tmux integration',
        },
      },
    },
  ],
};

export default config;
