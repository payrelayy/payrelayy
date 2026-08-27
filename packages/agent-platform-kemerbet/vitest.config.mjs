import { fileURLToPath } from 'node:url';

export default {
  resolve: {
    alias: {
      '@fetanagent/agent-platform-contracts': fileURLToPath(
        new URL('../agent-platform-contracts/src/index.ts', import.meta.url),
      ),
    },
  },
};
