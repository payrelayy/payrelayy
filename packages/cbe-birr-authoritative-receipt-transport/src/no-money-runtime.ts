import { parseCbeBirrAuthoritativePdf } from '@fetanagent/cbe-birr-authoritative-pdf-parser';
import type {
  CbeBirrApprovedReceiverLookupRootProfile,
  CbeBirrReceiverLookupChildKey,
  CbeBirrReceiverLookupOpeningProfile,
  OpenCbeBirrReceiverLookupInput,
} from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-opening';

import { retrieveAndParseCbeBirrReceiptForProtectedReceiverAdvisoryOnly } from './advisory-composition.js';
import { assessCbeBirrProtectedReceiptNoMoney } from './no-money-assessment.js';
import type {
  CbeBirrNoMoneyAssessment,
  CbeBirrNoMoneyInstructionSnapshot,
} from './no-money-assessment.js';
import { cbeBirrNodeHttpsTransport } from './node-https-transport.js';
import type { CbeBirrAuthoritativeReceiptTransportControl } from './shared.js';

/** One bounded official-receipt observation. No claim, persistence or payment action. */
export async function retrieveAndAssessCbeBirrProtectedReceiptNoMoney(
  reference: string,
  protectedReceiver: OpenCbeBirrReceiverLookupInput,
  childKey: CbeBirrReceiverLookupChildKey,
  openingProfile: CbeBirrReceiverLookupOpeningProfile,
  approvedRootProfile: CbeBirrApprovedReceiverLookupRootProfile,
  instruction: CbeBirrNoMoneyInstructionSnapshot,
  control: CbeBirrAuthoritativeReceiptTransportControl,
): Promise<CbeBirrNoMoneyAssessment> {
  const receipt = await retrieveAndParseCbeBirrReceiptForProtectedReceiverAdvisoryOnly(
    reference,
    protectedReceiver,
    childKey,
    openingProfile,
    approvedRootProfile,
    control,
    cbeBirrNodeHttpsTransport,
    parseCbeBirrAuthoritativePdf,
  );
  return assessCbeBirrProtectedReceiptNoMoney(receipt, instruction);
}

export type {
  CbeBirrNoMoneyAssessment,
  CbeBirrNoMoneyInstructionSnapshot,
} from './no-money-assessment.js';
