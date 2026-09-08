import { restoreCompanionDeviceEnrollment } from '../apps/windows-companion/dist/device-enrollment.js';

// Only an already-issued public certificate belongs on stdin. Never accept a
// private key, password, browser profile, or one-use pairing package here.
const [dataRoot, expectedServerSignerKeyId, expectedServerSigningPublicKeySpkiSha256, ...extra] =
  process.argv.slice(2);
try {
  if (process.platform !== 'win32' || !dataRoot || extra.length !== 0) throw new Error();
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) throw new Error();
    chunks.push(chunk);
  }
  const enrollment = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const result = await restoreCompanionDeviceEnrollment({
    dataRoot,
    enrollment,
    expectedServerSignerKeyId,
    expectedServerSigningPublicKeySpkiSha256,
  });
  process.stdout.write(
    `${JSON.stringify({ ...result, certificateRestored: true, moneyMoved: false })}\n`,
  );
} catch {
  process.stderr.write(
    'The signed companion certificate could not be restored. No enrollment was overwritten.\n',
  );
  process.exitCode = 1;
}
