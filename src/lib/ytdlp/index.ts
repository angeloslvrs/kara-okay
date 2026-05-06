import type { YtDlp } from './types';
import { ytSearch } from './search';
import { ytResolve } from './resolve';
import { ytDownload } from './download';

export * from './types';
export { isBotChallenge } from './detect';

export const realYtDlp: YtDlp = {
  search: (q, limit) => ytSearch(q, limit),
  resolve: (id) => ytResolve(id),
  download: (id, p) => ytDownload(id, p),
};

let _impl: YtDlp = realYtDlp;

export function getYtDlp(): YtDlp { return _impl; }
export function setYtDlp(impl: YtDlp): void { _impl = impl; }
