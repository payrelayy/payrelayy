import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assertKemerBetAgentPageSelectorContractV2 } from './playwright-kemerbet-agent-page.js';

describe('reviewed KemerBet selector contract', () => {
  it('is valid v2 JSON and uses only exact reviewed workflow controls', async () => {
    const path = fileURLToPath(
      new URL('../../../infra/config/kemerbet-selector-contract.v2.json', import.meta.url),
    );
    const contract = JSON.parse(await readFile(path, 'utf8')) as unknown;

    expect(() => assertKemerBetAgentPageSelectorContractV2(contract)).not.toThrow();
    expect(contract).toMatchObject({
      sessionFailure: {
        signInForm: 'form.ant-form:has(input#userName):has(input#password[type="password"])',
      },
    });
    expect(JSON.stringify(contract)).not.toContain('"signInForm":"form.ant-form"');
  });
});
