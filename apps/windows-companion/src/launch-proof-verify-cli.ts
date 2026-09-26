import { pathToFileURL } from 'node:url';

import { verifyCompanionLaunchProof } from '@fetanagent/agent-platform-companion-execution-contracts';

import { loadCompanionDeviceSigningRuntime } from './device-enrollment.js';

const MAX_INPUT_BYTES = 2_048;

async function readProof(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_INPUT_BYTES) throw new Error('Invalid local launch proof.');
    chunks.push(bytes);
  }
  if (length < 2) throw new Error('Invalid local launch proof.');
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function verifyLocalCompanionLaunchProof(): Promise<void> {
  const dataRoot = process.env.FETANAGENT_COMPANION_DATA_ROOT;
  const challenge = process.env.FETANAGENT_COMPANION_LAUNCH_CHALLENGE;
  const releaseSha = process.env.FETANAGENT_COMPANION_RELEASE_SHA;
  const installationTreeSha256 = process.env.FETANAGENT_COMPANION_INSTALLATION_TREE_SHA256;
  const processIdText = process.env.FETANAGENT_COMPANION_LAUNCH_PROCESS_ID;
  const startedAt = process.env.FETANAGENT_COMPANION_LAUNCH_STARTED_AT;
  const observedAt = process.env.FETANAGENT_COMPANION_LAUNCH_OBSERVED_AT;
  for (const key of [
    'FETANAGENT_COMPANION_LAUNCH_CHALLENGE',
    'FETANAGENT_COMPANION_LAUNCH_PROCESS_ID',
    'FETANAGENT_COMPANION_LAUNCH_STARTED_AT',
    'FETANAGENT_COMPANION_LAUNCH_OBSERVED_AT',
  ]) {
    delete process.env[key];
  }
  if (
    !dataRoot ||
    !challenge ||
    !releaseSha ||
    !installationTreeSha256 ||
    !processIdText ||
    !/^[1-9][0-9]{0,9}$/u.test(processIdText) ||
    !startedAt ||
    !observedAt
  ) {
    throw new Error('Invalid local launch proof.');
  }
  const proof = await readProof();
  const device = await loadCompanionDeviceSigningRuntime({ dataRoot });
  const certificate = device.certificate;
  if (
    !verifyCompanionLaunchProof(proof, {
      challenge,
      certificateBodyDigest: certificate.bodyDigest,
      deviceKeyId: certificate.body.deviceKeyId,
      devicePublicKeySpki: certificate.body.devicePublicKeySpki,
      releaseSha,
      installationTreeSha256,
      processId: Number(processIdText),
      startedAt,
      observedAt,
    })
  ) {
    throw new Error('Invalid local launch proof.');
  }
  console.info('COMPANION_LOCAL_LAUNCH_PROOF_VERIFIED');
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    await verifyLocalCompanionLaunchProof();
  } catch {
    console.error('The local companion launch proof could not be verified.');
    process.exitCode = 1;
  }
}
