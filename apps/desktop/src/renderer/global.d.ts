import type { AriseApi } from '@arise/shared';

declare global {
  interface Window {
    arise: AriseApi;
  }
}

export {};
