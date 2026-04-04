import { join } from 'node:path';
import type { FileSystemPort } from '../ports/filesystem.port';
import type { WtConfig } from '../domain/types';

function emptyConfig(): WtConfig {
  return {
    env: {},
    copy: [],
    install: '',
    base: '',
    hooks: {},
    tmux: [],
    cleanMergedInto: 'origin/staging',
  };
}

export class ConfigService {
  constructor(private fs: FileSystemPort) {}

  async parse(repoRoot: string): Promise<WtConfig> {
    const configPath = join(repoRoot, '.wt');
    const config = emptyConfig();

    let content: string;
    try {
      content = await this.fs.readFile(configPath);
    } catch {
      return config;
    }

    let section = '';

    for (const raw of content.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;

      const sectionMatch = line.match(/^\[([a-z_]+)\]$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        continue;
      }

      switch (section) {
        case 'env': {
          const eqIdx = line.indexOf('=');
          if (eqIdx > 0) {
            config.env[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
          }
          break;
        }
        case 'copy':
          config.copy.push(line);
          break;
        case 'install':
          if (line.startsWith('cmd=')) {
            config.install = line.slice(4);
          }
          break;
        case 'new':
          if (line.startsWith('base=')) {
            config.base = line.slice(5);
          }
          break;
        case 'hooks': {
          const eqIdx = line.indexOf('=');
          if (eqIdx > 0) {
            config.hooks[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
          }
          break;
        }
        case 'tmux':
          if (line.startsWith('window=')) {
            config.tmux.push(line.slice(7));
          }
          break;
        case 'clean':
          if (line.startsWith('merged_into=')) {
            config.cleanMergedInto = line.slice(12);
          }
          break;
      }
    }

    return config;
  }
}
