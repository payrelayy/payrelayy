/** Narrow verifier-facing entry point. Owner-only protection and child-key derivation stay internal. */
export {
  CBE_BIRR_RECEIVER_LOOKUP_OPENING_CONTRACT_VERSION,
  CBE_BIRR_RECEIVER_LOOKUP_OPENING_PURPOSE,
  withOpenedCbeBirrReceiverLookup,
  type CbeBirrApprovedReceiverLookupRootProfile,
  type CbeBirrReceiverLookupChildKey,
  type CbeBirrReceiverLookupOpeningProfile,
  type OpenCbeBirrReceiverLookupInput,
} from './cbe-birr-receiver-lookup.js';
