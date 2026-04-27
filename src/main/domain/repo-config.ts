import type { TabConfig } from './tab-config';

export type RepoConfig = {
  tabs?: TabConfig[];
  env?: Record<string, string>;
  postCreateCommand?: string;
  baseBranch?: string;
};
