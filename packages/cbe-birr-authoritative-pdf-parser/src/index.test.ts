import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { createDeflate } from 'node:zlib';

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CBE_BIRR_AUTHORITATIVE_PDF_CHILD_MAX_OLD_GENERATION_MB,
  CBE_BIRR_AUTHORITATIVE_PDF_CHILD_MAX_SEMI_SPACE_MB,
  CBE_BIRR_AUTHORITATIVE_PDF_CHILD_STACK_KB,
  CBE_BIRR_AUTHORITATIVE_PDF_MAX_BYTES,
  CBE_BIRR_AUTHORITATIVE_PDF_MAX_CONCURRENT_CHILDREN,
  CBE_BIRR_AUTHORITATIVE_PDF_MAX_IPC_RESULT_BYTES,
  CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_KILL_GRACE_MS,
  CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_SCHEDULER_ALLOWANCE_MS,
  CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_TIMEOUT_MS,
  CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION,
  CBE_BIRR_AUTHORITATIVE_PDF_PARSER_VERSION,
  CBE_BIRR_AUTHORITATIVE_PDFJS_VERSION,
  CBE_BIRR_AUTHORITATIVE_PDF_SOURCE_PROFILE,
  CBE_BIRR_AUTHORITATIVE_PDF_TOTAL_RETURN_BOUND_MS,
  parseCbeBirrAuthoritativePdf,
  redactedCbeBirrAuthoritativePdfParserResultForLog,
  type CbeBirrAuthoritativePdfParserResult,
} from './index.js';
import {
  CBE_BIRR_PDF_PARSER_CHILD_KILL_GRACE_MS,
  createCbeBirrPdfParserAdmissionGate,
  spawnCbeBirrPdfParserChild,
  superviseCbeBirrPdfParserChild,
  type CbeBirrPdfParserChildBoundary,
} from './isolation.js';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { readonly eager: true; readonly import: 'default'; readonly query: '?raw' },
    ): Record<string, unknown>;
  }
}

interface SyntheticReceiptOptions {
  readonly reference?: string;
  readonly status?: string;
  readonly summaryAmount?: string;
  readonly paidAmount?: string;
  readonly serviceCharge?: string;
  readonly vat?: string;
  readonly totalPaid?: string;
  readonly timestamp?: string;
  readonly paymentReason?: string;
  readonly paymentChannel?: string;
  readonly omitLabel?: string;
  readonly duplicateLabel?: string;
  readonly extraText?: string;
  readonly pageCount?: number;
  readonly catalogExtra?: string;
  readonly trailerExtra?: string;
  readonly annotation?: boolean;
  readonly fullPageImage?: boolean;
  readonly textless?: boolean;
  readonly operatorPairs?: number;
  readonly additionalTextItems?: number;
}

interface SyntheticTextRow {
  readonly y: number;
  readonly fragments: readonly { readonly x: number; readonly text: string }[];
}

const SYNTHETIC_REFERENCE = 'SYNTHREF1234';
const SYNTHETIC_RECEIVER_IDENTIFIER = '251900000001';
const SYNTHETIC_RECEIVER_NAME = 'SYNTHETIC RECEIVER';

const expectations = () => ({
  contractVersion: CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  sourceProfile: CBE_BIRR_AUTHORITATIVE_PDF_SOURCE_PROFILE,
  canonicalReference: SYNTHETIC_REFERENCE,
  configuredReceiverAccountIdentifier: SYNTHETIC_RECEIVER_IDENTIFIER,
});

function pdfString(value: string): string {
  if (!/^[\x20-\x7e]*$/u.test(value)) throw new Error('Synthetic PDF text must be ASCII.');
  return value.replace(/([\\()])/gu, '\\$1');
}

function receiptRows(options: SyntheticReceiptOptions): readonly SyntheticTextRow[] {
  const summaryAmount = options.summaryAmount ?? options.paidAmount ?? '100.00 ETB';
  const rows: SyntheticTextRow[] = [
    { y: 760, fragments: [{ x: 180, text: 'Commercial Bank of Ethiopia' }] },
    { y: 740, fragments: [{ x: 195, text: 'VAT Invoice / Customer Receipt' }] },
    { y: 710, fragments: [{ x: 50, text: 'Transaction Details' }] },
    {
      y: 680,
      fragments: [
        { x: 50, text: 'Receiver Name' },
        { x: 300, text: SYNTHETIC_RECEIVER_NAME },
      ],
    },
    {
      y: 655,
      fragments: [
        { x: 50, text: 'Transaction Status' },
        { x: 300, text: options.status ?? 'Completed' },
      ],
    },
    {
      y: 630,
      fragments: [
        { x: 50, text: 'Reference' },
        { x: 300, text: options.reference ?? SYNTHETIC_REFERENCE },
      ],
    },
    {
      y: 595,
      fragments: [
        { x: 50, text: 'Receipt Number' },
        { x: 230, text: 'Transaction Date' },
        { x: 440, text: 'Amount' },
      ],
    },
    {
      y: 575,
      fragments: [
        { x: 50, text: 'SYNTHETIC-0001' },
        { x: 230, text: options.timestamp ?? '29/02/2024 14:05:09' },
        { x: 440, text: summaryAmount },
      ],
    },
    {
      y: 535,
      fragments: [
        { x: 50, text: 'Paid amount' },
        { x: 300, text: options.paidAmount ?? '100.00 ETB' },
      ],
    },
    {
      y: 510,
      fragments: [
        { x: 50, text: 'Service Charge' },
        { x: 300, text: options.serviceCharge ?? '2.00 ETB' },
      ],
    },
    {
      y: 485,
      fragments: [
        { x: 50, text: 'VAT' },
        { x: 300, text: options.vat ?? '0.30 ETB' },
      ],
    },
    {
      y: 460,
      fragments: [
        { x: 50, text: 'Total Paid Amount' },
        { x: 300, text: options.totalPaid ?? '102.30 ETB' },
      ],
    },
    {
      y: 420,
      fragments: [
        { x: 50, text: 'Payment Reason' },
        { x: 300, text: options.paymentReason ?? 'Send Money' },
      ],
    },
    {
      y: 395,
      fragments: [
        { x: 50, text: 'Payment Channel' },
        { x: 300, text: options.paymentChannel ?? 'CBE Birr' },
      ],
    },
  ];

  const filtered = options.omitLabel
    ? rows.filter(({ fragments }) => fragments[0]?.text !== options.omitLabel)
    : rows;
  if (options.duplicateLabel) {
    const existing = rows.find(({ fragments }) => fragments[0]?.text === options.duplicateLabel);
    if (!existing) throw new Error('Unknown synthetic duplicate label.');
    filtered.push({ y: 370, fragments: existing.fragments });
  }
  if (options.extraText) {
    filtered.push({ y: 350, fragments: [{ x: 50, text: options.extraText }] });
  }
  for (let index = 0; index < (options.additionalTextItems ?? 0); index += 1) {
    filtered.push({
      y: 780 - index,
      fragments: [{ x: 550, text: `X${String(index).padStart(3, '0')}` }],
    });
  }
  return filtered;
}

function textContentStream(rows: readonly SyntheticTextRow[]): string {
  return rows
    .flatMap(({ y, fragments }) =>
      fragments.map(({ x, text }) => `BT\n/F1 10 Tf\n${x} ${y} Td\n(${pdfString(text)}) Tj\nET\n`),
    )
    .join('');
}

function syntheticReceiptPdf(options: SyntheticReceiptOptions = {}): Uint8Array {
  const pageCount = options.pageCount ?? 1;
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 3) throw new Error();

  const pageStart = 3;
  const contentStart = pageStart + pageCount;
  const fontNumber = contentStart + pageCount;
  let nextObjectNumber = fontNumber + 1;
  const imageNumber = options.fullPageImage ? nextObjectNumber++ : undefined;
  const annotationNumber = options.annotation ? nextObjectNumber++ : undefined;
  const objects: string[] = Array.from({ length: nextObjectNumber });

  objects[1] = `<< /Type /Catalog /Pages 2 0 R ${options.catalogExtra ?? ''} >>`;
  const kids = Array.from({ length: pageCount }, (_, index) => `${pageStart + index} 0 R`).join(
    ' ',
  );
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;

  const baseRows = options.textless ? [] : receiptRows(options);
  const textOperators = textContentStream(baseRows);
  const operatorFlood = 'q\nQ\n'.repeat(options.operatorPairs ?? 0);
  const imageOperators = options.fullPageImage ? 'q\n612 0 0 792 0 0 cm\n/Im0 Do\nQ\n' : '';
  const stream = `${operatorFlood}${imageOperators}${textOperators}`;

  for (let index = 0; index < pageCount; index += 1) {
    const pageNumber = pageStart + index;
    const contentNumber = contentStart + index;
    const xObjectResources = imageNumber ? `/XObject << /Im0 ${imageNumber} 0 R >>` : '';
    const annotations = annotationNumber ? `/Annots [${annotationNumber} 0 R]` : '';
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontNumber} 0 R >> ${xObjectResources} >> ` +
      `/Contents ${contentNumber} 0 R ${annotations} >>`;
    objects[contentNumber] =
      `<< /Length ${new TextEncoder().encode(stream).byteLength} >>\nstream\n${stream}endstream`;
  }
  objects[fontNumber] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  if (imageNumber) {
    objects[imageNumber] =
      '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray ' +
      '/BitsPerComponent 8 /Length 1 >>\nstream\n\u0000\nendstream';
  }
  if (annotationNumber) {
    objects[annotationNumber] =
      '<< /Type /Annot /Subtype /Text /Rect [0 0 10 10] /Contents (synthetic note) >>';
  }

  let pdf = '%PDF-1.7\n';
  const offsets: number[] = [0];
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    offsets[objectNumber] = new TextEncoder().encode(pdf).byteLength;
    pdf += `${objectNumber} 0 obj\n${objects[objectNumber]!}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    pdf += `${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length} /Root 1 0 R ${options.trailerExtra ?? ''} >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function binaryPdfWithFlateContent(compressedContent: Uint8Array): Uint8Array {
  const objectBodies = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'ascii'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      'ascii',
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Length ${compressedContent.byteLength} /Filter /FlateDecode >>\nstream\n`,
        'ascii',
      ),
      Buffer.from(compressedContent),
      Buffer.from('\nendstream', 'ascii'),
    ]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'ascii'),
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n', 'ascii')];
  const offsets: number[] = [0];
  let length = parts[0]!.byteLength;
  for (let index = 0; index < objectBodies.length; index += 1) {
    const objectNumber = index + 1;
    offsets[objectNumber] = length;
    const object = Buffer.concat([
      Buffer.from(`${objectNumber} 0 obj\n`, 'ascii'),
      objectBodies[index]!,
      Buffer.from('\nendobj\n', 'ascii'),
    ]);
    parts.push(object);
    length += object.byteLength;
  }
  const xrefOffset = length;
  let xref = `xref\n0 ${objectBodies.length + 1}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber <= objectBodies.length; objectNumber += 1) {
    xref += `${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`;
  }
  xref +=
    `trailer\n<< /Size ${objectBodies.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'ascii'));
  return new Uint8Array(Buffer.concat(parts));
}

async function syntheticFlateOperatorBombPdf(): Promise<Uint8Array> {
  const deflater = createDeflate({ level: 9 });
  const compressedChunks: Buffer[] = [];
  deflater.on('data', (chunk: Buffer) => compressedChunks.push(Buffer.from(chunk)));
  const ended = once(deflater, 'end');
  const operatorChunk = Buffer.from('q\nQ\n'.repeat(16_384), 'ascii');
  for (let index = 0; index < 2_048; index += 1) {
    if (!deflater.write(operatorChunk)) await once(deflater, 'drain');
  }
  deflater.end();
  await ended;
  return binaryPdfWithFlateContent(Buffer.concat(compressedChunks));
}

class SyntheticChildBoundary implements CbeBirrPdfParserChildBoundary {
  readonly pid = 424_242;
  readonly mode: 'silent' | 'message' | 'error' | 'exit' | 'throw';
  forceKillCount = 0;
  disconnectCount = 0;
  unrefCount = 0;
  private readonly killCausesExit: boolean;
  private readonly forceKillThrows: boolean;
  private exitScheduled = false;
  private messageListener: ((candidate: unknown) => void) | undefined;
  private errorListener: (() => void) | undefined;
  private exitListener: (() => void) | undefined;

  constructor(
    mode: SyntheticChildBoundary['mode'],
    killCausesExit = true,
    forceKillThrows = false,
  ) {
    this.mode = mode;
    this.killCausesExit = killCausesExit;
    this.forceKillThrows = forceKillThrows;
  }

  onceMessage(listener: (candidate: unknown) => void): void {
    this.messageListener = listener;
  }

  onceError(listener: () => void): void {
    this.errorListener = listener;
  }

  onceExit(listener: () => void): void {
    this.exitListener = listener;
  }

  removeMessageListener(listener: (candidate: unknown) => void): void {
    if (this.messageListener === listener) this.messageListener = undefined;
  }

  removeErrorListener(listener: () => void): void {
    if (this.errorListener === listener) this.errorListener = undefined;
  }

  removeExitListener(listener: () => void): void {
    if (this.exitListener === listener) this.exitListener = undefined;
  }

  sendBoundedRequest(_payload: object, _failureListener: () => void): void {
    if (this.mode === 'throw') throw new Error('SYNTHETIC PRIVATE CHILD ERROR');
    if (this.mode === 'message') {
      queueMicrotask(() => this.messageListener?.(Object.freeze({ synthetic: 'message' })));
    }
    if (this.mode === 'error') queueMicrotask(() => this.errorListener?.());
    if (this.mode === 'exit') queueMicrotask(() => this.exitListener?.());
  }

  forceKill(): boolean {
    this.forceKillCount += 1;
    if (this.forceKillThrows) throw new Error('SYNTHETIC PRIVATE KILL ERROR');
    if (this.killCausesExit && !this.exitScheduled) {
      this.exitScheduled = true;
      queueMicrotask(() => this.emitExit());
    }
    return true;
  }

  disconnect(): void {
    this.disconnectCount += 1;
  }

  unref(): void {
    this.unrefCount += 1;
  }

  emitExit(): void {
    this.exitListener?.();
  }
}

function compiledChildEntryUrl(): URL {
  const currentModule = new URL(import.meta.url);
  return currentModule.pathname.endsWith('/src/index.test.ts')
    ? new URL('../dist/index.js', currentModule)
    : new URL('./index.js', currentModule);
}

function expectChildPidGone(pid: number): void {
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  expect(alive).toBe(false);
}

async function runRealIsolatedChild(pdfBytes: Uint8Array) {
  const child = spawnCbeBirrPdfParserChild(
    compiledChildEntryUrl(),
    CBE_BIRR_AUTHORITATIVE_PDF_CHILD_MAX_OLD_GENERATION_MB,
    CBE_BIRR_AUTHORITATIVE_PDF_CHILD_MAX_SEMI_SPACE_MB,
    CBE_BIRR_AUTHORITATIVE_PDF_CHILD_STACK_KB,
  );
  const pid = child.pid;
  expect(pid).toEqual(expect.any(Number));
  const outcome = await superviseCbeBirrPdfParserChild(
    child,
    Object.freeze({
      protocolVersion: 1,
      pdfBytes,
      expectations: expectations(),
    }),
    CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_TIMEOUT_MS,
  );
  expect(outcome.cleanupConfirmed).toBe(true);
  expectChildPidGone(pid!);
  return outcome;
}

function expectDeeplyFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested);
}

describe('CBE Birr authoritative PDF parser foundation', () => {
  it('reduces the exact synthetic topology to safe facts but reviews unavailable receiver identity', async () => {
    const result = await parseCbeBirrAuthoritativePdf(syntheticReceiptPdf(), expectations());

    expect(result).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
      parserVersion: 1,
      advisoryOnly: true,
      safeFactsOnly: true,
      sqlAuthorizationAllowed: false,
      transportAllowed: false,
      networkAllowed: false,
      providerRequestAllowed: false,
      decryptionAllowed: false,
      databaseReadAllowed: false,
      databaseWriteAllowed: false,
      persistenceAllowed: false,
      runtimeWiringAllowed: false,
      claimAllowed: false,
      settlementAllowed: false,
      enqueueAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      kemerBetActionAllowed: false,
      blindRetryAllowed: false,
      disposition: 'would_review',
      reasonCode: 'receiver_identity_unavailable',
      facts: {
        documentTopology: 'cbe_birr_vat_customer_receipt_v1',
        pageCount: 1,
        activeContentAbsent: true,
        attachmentsAbsent: true,
        formsAbsent: true,
        referenceMatched: true,
        receiverDisplayNamePresent: true,
        receiverIdentifierEvidence: 'unavailable',
        receiverIdentityMatch: 'unavailable',
        receiverMatchBasis: 'exact_account_identifier_required',
        receiptStatus: 'completed',
        transactionType: 'send_money',
        currencyCode: 'ETB',
        principalAmountMinor: '10000',
        serviceChargeMinor: '200',
        vatMinor: '30',
        totalPaidAmountMinor: '10230',
        feeArithmetic: 'consistent',
        occurredAt: '2024-02-29T14:05:09+03:00',
        occurredAtTimeZone: 'Africa/Addis_Ababa',
      },
    });
    expectDeeplyFrozen(result);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SYNTHETIC_REFERENCE);
    expect(serialized).not.toContain(SYNTHETIC_RECEIVER_IDENTIFIER);
    expect(serialized).not.toContain(SYNTHETIC_RECEIVER_NAME);
  });

  it('has no accepting disposition and makes every authority capability literal false', () => {
    expectTypeOf<CbeBirrAuthoritativePdfParserResult['disposition']>().toEqualTypeOf<
      'would_review' | 'would_reject'
    >();
    expectTypeOf<
      CbeBirrAuthoritativePdfParserResult['sqlAuthorizationAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<CbeBirrAuthoritativePdfParserResult['transportAllowed']>().toEqualTypeOf<false>();
    expectTypeOf<CbeBirrAuthoritativePdfParserResult['networkAllowed']>().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativePdfParserResult['databaseReadAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativePdfParserResult['databaseWriteAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativePdfParserResult['persistenceAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<CbeBirrAuthoritativePdfParserResult['claimAllowed']>().toEqualTypeOf<false>();
    expectTypeOf<CbeBirrAuthoritativePdfParserResult['settlementAllowed']>().toEqualTypeOf<false>();
    expectTypeOf<CbeBirrAuthoritativePdfParserResult['enqueueAllowed']>().toEqualTypeOf<false>();
    expectTypeOf<CbeBirrAuthoritativePdfParserResult['executionAllowed']>().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativePdfParserResult['financialActionAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativePdfParserResult['kemerBetActionAllowed']
    >().toEqualTypeOf<false>();
  });

  it('uses Paid amount as principal and treats a conflicting summary Amount as parser uncertainty', async () => {
    const result = await parseCbeBirrAuthoritativePdf(
      syntheticReceiptPdf({ summaryAmount: '999.00 ETB', paidAmount: '100.00 ETB' }),
      expectations(),
    );
    expect(result).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'pdf_field_conflict',
    });
    expect(Reflect.ownKeys(result)).not.toContain('facts');
  });

  it.each([
    [{ reference: 'OTHERREF1234' }, 'would_reject', 'reference_mismatch'],
    [{ status: 'Pending' }, 'would_review', 'receipt_status_unsupported'],
    [{ paymentReason: 'Merchant Payment' }, 'would_review', 'transaction_type_unsupported'],
    [
      {
        summaryAmount: '100.00 USD',
        paidAmount: '100.00 USD',
        serviceCharge: '2.00 USD',
        vat: '0.30 USD',
        totalPaid: '102.30 USD',
      },
      'would_reject',
      'currency_not_etb',
    ],
    [{ totalPaid: '102.31 ETB' }, 'would_review', 'fee_arithmetic_mismatch'],
  ] as const)('fails semantic case %# closed', async (overrides, disposition, reasonCode) => {
    const result = await parseCbeBirrAuthoritativePdf(
      syntheticReceiptPdf(overrides),
      expectations(),
    );
    expect(result).toMatchObject({ disposition, reasonCode });
  });

  it.each([
    [{ omitLabel: 'Reference' }, 'pdf_field_missing'],
    [{ duplicateLabel: 'Reference' }, 'pdf_field_duplicate'],
    [{ extraText: 'Unexpected Field Synthetic Value' }, 'pdf_layout_drift'],
    [{ timestamp: '31/02/2024 14:05:09' }, 'pdf_value_invalid'],
    [
      {
        serviceCharge: '2.00 USD',
      },
      'pdf_field_conflict',
    ],
  ] as const)('reviews topology/value case %#', async (overrides, reasonCode) => {
    const result = await parseCbeBirrAuthoritativePdf(
      syntheticReceiptPdf(overrides),
      expectations(),
    );
    expect(result).toMatchObject({ disposition: 'would_review', reasonCode });
    expect(Reflect.ownKeys(result)).not.toContain('facts');
  });

  it('enforces framing, the exact one-page limit, and the 1 MiB ceiling before reduction', async () => {
    const valid = syntheticReceiptPdf();
    const invalidHeader = valid.slice();
    invalidHeader[0] = 0;
    const invalidEof = valid.slice(0, -6);
    const oversized = new Uint8Array(CBE_BIRR_AUTHORITATIVE_PDF_MAX_BYTES + 1);

    await expect(
      parseCbeBirrAuthoritativePdf(invalidHeader, expectations()),
    ).resolves.toMatchObject({
      reasonCode: 'pdf_framing_invalid',
    });
    await expect(parseCbeBirrAuthoritativePdf(invalidEof, expectations())).resolves.toMatchObject({
      reasonCode: 'pdf_framing_invalid',
    });
    await expect(parseCbeBirrAuthoritativePdf(oversized, expectations())).resolves.toMatchObject({
      reasonCode: 'pdf_size_invalid',
    });
    await expect(
      parseCbeBirrAuthoritativePdf(syntheticReceiptPdf({ pageCount: 2 }), expectations()),
    ).resolves.toMatchObject({ reasonCode: 'pdf_page_count_unsupported' });
  });

  it('rejects oversized and detached genuine typed arrays before any parent-side copy', async () => {
    const oversized = new Uint8Array(CBE_BIRR_AUTHORITATIVE_PDF_MAX_BYTES + 1);
    let hostileAccessorReads = 0;
    for (const key of ['byteLength', 'length', Symbol.iterator] as const) {
      Object.defineProperty(oversized, key, {
        configurable: true,
        get() {
          hostileAccessorReads += 1;
          throw new Error('SYNTHETIC PRIVATE TYPED ARRAY ACCESSOR');
        },
      });
    }

    const intrinsicUint8Array = globalThis.Uint8Array;
    const intrinsicDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Uint8Array')!;
    let parentCopyConstructorCalls = 0;
    const trackingUint8Array = function (...constructorArguments: unknown[]): Uint8Array {
      parentCopyConstructorCalls += 1;
      return Reflect.construct(intrinsicUint8Array, constructorArguments) as Uint8Array;
    } as unknown as Uint8ArrayConstructor;
    Object.defineProperty(trackingUint8Array, 'prototype', {
      value: intrinsicUint8Array.prototype,
    });

    let pendingOversizedResult: Promise<CbeBirrAuthoritativePdfParserResult>;
    Object.defineProperty(globalThis, 'Uint8Array', {
      ...intrinsicDescriptor,
      value: trackingUint8Array,
    });
    try {
      pendingOversizedResult = parseCbeBirrAuthoritativePdf(oversized, expectations());
    } finally {
      Object.defineProperty(globalThis, 'Uint8Array', intrinsicDescriptor);
    }

    await expect(pendingOversizedResult).resolves.toMatchObject({
      disposition: 'would_review',
      reasonCode: 'pdf_size_invalid',
    });
    expect(parentCopyConstructorCalls).toBe(0);
    expect(hostileAccessorReads).toBe(0);

    const detached = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(detached.byteLength).toBe(0);
    await expect(parseCbeBirrAuthoritativePdf(detached, expectations())).resolves.toMatchObject({
      disposition: 'would_review',
      reasonCode: 'pdf_size_invalid',
    });
  });

  it.each([
    [{ trailerExtra: '/Encrypt 99 0 R' }, 'pdf_encrypted'],
    [{ catalogExtra: '/Names << /EmbeddedFiles << /Names [] >> >>' }, 'pdf_attachment_present'],
    [
      { catalogExtra: '/OpenAction << /S /J#61vaScript /JS (synthetic) >>' },
      'pdf_active_content_present',
    ],
    [{ catalogExtra: '/AcroForm << /Fields [] >>' }, 'pdf_form_present'],
    [{ annotation: true }, 'pdf_annotation_present'],
  ] as const)('rejects forbidden PDF feature case %#', async (overrides, reasonCode) => {
    await expect(
      parseCbeBirrAuthoritativePdf(syntheticReceiptPdf(overrides), expectations()),
    ).resolves.toMatchObject({ disposition: 'would_review', reasonCode });
  });

  it('reviews image-only and full-page-image text-overlay PDFs as OCR/image evidence', async () => {
    await expect(
      parseCbeBirrAuthoritativePdf(
        syntheticReceiptPdf({ fullPageImage: true, textless: true }),
        expectations(),
      ),
    ).resolves.toMatchObject({ reasonCode: 'pdf_ocr_or_image_only' });
    await expect(
      parseCbeBirrAuthoritativePdf(syntheticReceiptPdf({ fullPageImage: true }), expectations()),
    ).resolves.toMatchObject({ reasonCode: 'pdf_ocr_or_image_only' });
  });

  it('enforces bounded operator and extracted text-item counts', async () => {
    await expect(
      parseCbeBirrAuthoritativePdf(syntheticReceiptPdf({ operatorPairs: 4_200 }), expectations()),
    ).resolves.toMatchObject({ reasonCode: 'pdf_complexity_exceeded' });
    await expect(
      parseCbeBirrAuthoritativePdf(
        syntheticReceiptPdf({ additionalTextItems: 520 }),
        expectations(),
      ),
    ).resolves.toMatchObject({ reasonCode: 'pdf_complexity_exceeded' });
  });

  it('kills repeated Flate bombs, rejects overlap, and releases admission only after exit', async () => {
    const bomb = await syntheticFlateOperatorBombPdf();
    expect(bomb.byteLength).toBeLessThan(CBE_BIRR_AUTHORITATIVE_PDF_MAX_BYTES);
    const oversizedDuringContention = new Uint8Array(CBE_BIRR_AUTHORITATIVE_PDF_MAX_BYTES + 1);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const startedAt = performance.now();
      const pendingBombResult = parseCbeBirrAuthoritativePdf(bomb, expectations());
      if (attempt === 0) {
        await expect(
          parseCbeBirrAuthoritativePdf(oversizedDuringContention, expectations()),
        ).resolves.toMatchObject({ reasonCode: 'pdf_size_invalid' });
      }
      const excessResult = await parseCbeBirrAuthoritativePdf(bomb, expectations());
      const result = await pendingBombResult;
      const elapsedMilliseconds = performance.now() - startedAt;

      expect(excessResult).toMatchObject({
        disposition: 'would_review',
        reasonCode: 'pdf_isolation_capacity_exceeded',
      });
      expect(Reflect.ownKeys(excessResult)).not.toContain('facts');
      expect(['pdf_isolation_timeout', 'pdf_isolation_failed']).toContain(result.reasonCode);
      expect(result).toMatchObject({ disposition: 'would_review' });
      expect(Reflect.ownKeys(result)).not.toContain('facts');
      expect(elapsedMilliseconds).toBeLessThan(CBE_BIRR_AUTHORITATIVE_PDF_TOTAL_RETURN_BOUND_MS);

      await expect(
        parseCbeBirrAuthoritativePdf(syntheticReceiptPdf(), expectations()),
      ).resolves.toMatchObject({ reasonCode: 'receiver_identity_unavailable' });
    }
  }, 30_000);

  it('observes each real child PID gone after both success and hostile timeout', async () => {
    const successOutcome = await runRealIsolatedChild(syntheticReceiptPdf());
    expect(successOutcome).toMatchObject({ state: 'message', cleanupConfirmed: true });

    const bombStartedAt = performance.now();
    const bombOutcome = await runRealIsolatedChild(await syntheticFlateOperatorBombPdf());
    expect(bombOutcome).toMatchObject({ cleanupConfirmed: true });
    expect(['timeout', 'failure']).toContain(bombOutcome.state);
    expect(performance.now() - bombStartedAt).toBeLessThan(
      CBE_BIRR_AUTHORITATIVE_PDF_TOTAL_RETURN_BOUND_MS,
    );
  }, 20_000);

  it('accepts only an exact Uint8Array plus an exact hostile-safe expectations object', async () => {
    let accessorReads = 0;
    let proxyTraps = 0;
    const accessor = { ...expectations() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'canonicalReference', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return SYNTHETIC_REFERENCE;
      },
    });
    const proxied = new Proxy(expectations(), {
      ownKeys() {
        proxyTraps += 1;
        return [];
      },
      getPrototypeOf() {
        proxyTraps += 1;
        return Object.prototype;
      },
    });
    const byteCandidates: unknown[] = [
      syntheticReceiptPdf().buffer,
      Buffer.from(syntheticReceiptPdf()),
      new Proxy(syntheticReceiptPdf(), {}),
      null,
    ];
    const expectationCandidates: unknown[] = [
      accessor,
      proxied,
      { ...expectations(), extra: 'DO-NOT-ECHO' },
      { ...expectations(), canonicalReference: SYNTHETIC_REFERENCE.toLowerCase() },
      { ...expectations(), configuredReceiverAccountIdentifier: '1234' },
      { ...expectations(), url: 'DO-NOT-ECHO' },
      { ...expectations(), load: () => syntheticReceiptPdf() },
      null,
    ];
    for (const candidate of byteCandidates) {
      await expect(parseCbeBirrAuthoritativePdf(candidate, expectations())).resolves.toMatchObject({
        reasonCode: 'invalid_parser_input',
      });
    }
    for (const candidate of expectationCandidates) {
      const result = await parseCbeBirrAuthoritativePdf(syntheticReceiptPdf(), candidate);
      expect(result).toMatchObject({ reasonCode: 'invalid_parser_input' });
      expect(JSON.stringify(result)).not.toContain('DO-NOT-ECHO');
    }
    expect(accessorReads).toBe(0);
    expect(proxyTraps).toBe(0);
  });

  it('copies bytes synchronously before PDF.js can take ownership', async () => {
    const bytes = syntheticReceiptPdf();
    const pending = parseCbeBirrAuthoritativePdf(bytes, expectations());
    bytes.fill(0);
    await expect(pending).resolves.toMatchObject({ reasonCode: 'receiver_identity_unavailable' });
  });

  it('projects only revalidated constant-key metadata and never receipt facts', async () => {
    const result = await parseCbeBirrAuthoritativePdf(syntheticReceiptPdf(), expectations());
    const projection = redactedCbeBirrAuthoritativePdfParserResultForLog(result);
    expect(projection).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      parserVersion: 1,
      disposition: 'would_review',
      reasonCode: 'receiver_identity_unavailable',
      advisoryOnly: true,
      safeFactsOnly: true,
      sqlAuthorizationAllowed: false,
      transportAllowed: false,
      networkAllowed: false,
      providerRequestAllowed: false,
      decryptionAllowed: false,
      databaseReadAllowed: false,
      databaseWriteAllowed: false,
      persistenceAllowed: false,
      runtimeWiringAllowed: false,
      claimAllowed: false,
      settlementAllowed: false,
      enqueueAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      kemerBetActionAllowed: false,
      blindRetryAllowed: false,
    });
    expectDeeplyFrozen(projection);
    const serialized = JSON.stringify(projection);
    for (const sensitive of [
      SYNTHETIC_REFERENCE,
      SYNTHETIC_RECEIVER_IDENTIFIER,
      SYNTHETIC_RECEIVER_NAME,
      '10000',
      '2024-02-29',
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it('fails forged, accessor-bearing, and proxy results to a fixed redacted projection', async () => {
    let accessorReads = 0;
    let proxyTraps = 0;
    const result = await parseCbeBirrAuthoritativePdf(syntheticReceiptPdf(), expectations());
    const accessor = { ...result } as Record<string, unknown>;
    Object.defineProperty(accessor, 'reasonCode', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'receiver_identity_unavailable';
      },
    });
    const proxy = new Proxy(result, {
      ownKeys() {
        proxyTraps += 1;
        return [];
      },
    });
    for (const candidate of [
      { ...result, settlementAllowed: true, secret: 'DO-NOT-ECHO' },
      accessor,
      proxy,
    ]) {
      const projection = redactedCbeBirrAuthoritativePdfParserResultForLog(candidate);
      expect(projection).toMatchObject({
        disposition: 'invalid_result',
        reasonCode: 'invalid_result',
        settlementAllowed: false,
        financialActionAllowed: false,
      });
      expect(JSON.stringify(projection)).not.toContain('DO-NOT-ECHO');
    }
    expect(accessorReads).toBe(0);
    expect(proxyTraps).toBe(0);
  });
});

describe('isolated child-process supervisor', () => {
  it('enforces an immediate process-local admission ceiling with idempotent leases', () => {
    expect(() => createCbeBirrPdfParserAdmissionGate(0)).toThrow(RangeError);
    const gate = createCbeBirrPdfParserAdmissionGate(1);
    const firstLease = gate.tryAcquire();

    expect(firstLease).toBeDefined();
    expect(gate.tryAcquire()).toBeUndefined();
    firstLease!.release();
    firstLease!.release();

    const replacementLease = gate.tryAcquire();
    expect(replacementLease).toBeDefined();
    expect(gate.tryAcquire()).toBeUndefined();
    replacementLease!.release();
  });

  it('force-kills a silent child at the independent parent deadline', async () => {
    const child = new SyntheticChildBoundary('silent');
    const startedAt = performance.now();
    const outcome = await superviseCbeBirrPdfParserChild(
      child,
      Object.freeze({ synthetic: true }),
      20,
      20,
    );

    expect(outcome).toEqual({ state: 'timeout', cleanupConfirmed: true });
    expect(child.forceKillCount).toBe(1);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  it('does not resolve a terminal outcome until child exit is observed', async () => {
    const child = new SyntheticChildBoundary('error', false);
    let resolved = false;
    const pendingOutcome = superviseCbeBirrPdfParserChild(
      child,
      Object.freeze({ synthetic: true }),
      500,
      500,
    );
    void pendingOutcome.then(() => {
      resolved = true;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(child.forceKillCount).toBe(1);
    expect(resolved).toBe(false);

    child.emitExit();
    await expect(pendingOutcome).resolves.toEqual({ state: 'failure', cleanupConfirmed: true });
    expect(resolved).toBe(true);
  });

  it('preserves the original terminal result when the first forced kill throws', async () => {
    const child = new SyntheticChildBoundary('message', false, true);
    const pendingOutcome = superviseCbeBirrPdfParserChild(
      child,
      Object.freeze({ synthetic: true }),
      500,
      500,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(child.forceKillCount).toBe(1);
    child.emitExit();
    const outcome = await pendingOutcome;
    expect(outcome).toEqual({
      state: 'message',
      candidate: { synthetic: 'message' },
      cleanupConfirmed: true,
    });
    expect(JSON.stringify(outcome)).not.toContain('SYNTHETIC PRIVATE KILL ERROR');
  });

  it('bounds the forced-kill fallback and marks cleanup unconfirmed', async () => {
    const child = new SyntheticChildBoundary('silent', false);
    const startedAt = performance.now();
    const outcome = await superviseCbeBirrPdfParserChild(
      child,
      Object.freeze({ synthetic: true }),
      10,
      10,
    );

    expect(outcome).toEqual({ state: 'timeout', cleanupConfirmed: false });
    expect(child.forceKillCount).toBe(2);
    expect(child.disconnectCount).toBe(1);
    expect(child.unrefCount).toBe(1);
    expect(performance.now() - startedAt).toBeLessThan(250);
    child.emitExit();
  });

  it.each(['error', 'exit', 'throw'] as const)(
    'cleans up %s child failure without exposing the error',
    async (mode) => {
      const child = new SyntheticChildBoundary(mode);
      const outcome = await superviseCbeBirrPdfParserChild(
        child,
        Object.freeze({ synthetic: true }),
        500,
        20,
      );

      expect(outcome).toEqual({ state: 'failure', cleanupConfirmed: true });
      expect(child.forceKillCount).toBe(mode === 'exit' ? 0 : 1);
      expect(JSON.stringify(outcome)).not.toContain('SYNTHETIC PRIVATE CHILD ERROR');
    },
  );
});

describe('dependency, fixture, and runtime boundary', () => {
  it('pins only pdfjs-dist 6.2.108 as the parser dependency', () => {
    const manifests = import.meta.glob('../package.json', {
      eager: true,
      import: 'default',
      query: '?raw',
    }) as Record<string, string>;
    const manifest = JSON.parse(Object.values(manifests)[0]!) as Record<string, unknown>;
    expect(manifest.dependencies).toEqual({ 'pdfjs-dist': '6.2.108' });
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
    expect(CBE_BIRR_AUTHORITATIVE_PDF_PARSER_VERSION).toBe(1);
    expect(CBE_BIRR_AUTHORITATIVE_PDFJS_VERSION).toBe('6.2.108');
  });

  it('pins the OS-child deadline, kill, IPC, and V8 isolation contract', () => {
    expect(CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_TIMEOUT_MS).toBe(2_000);
    expect(CBE_BIRR_PDF_PARSER_CHILD_KILL_GRACE_MS).toBe(200);
    expect(CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_KILL_GRACE_MS).toBe(200);
    expect(CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_SCHEDULER_ALLOWANCE_MS).toBe(500);
    expect(CBE_BIRR_AUTHORITATIVE_PDF_TOTAL_RETURN_BOUND_MS).toBe(
      CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_TIMEOUT_MS +
        CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_KILL_GRACE_MS * 2 +
        CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_SCHEDULER_ALLOWANCE_MS,
    );
    expect(CBE_BIRR_AUTHORITATIVE_PDF_TOTAL_RETURN_BOUND_MS).toBeLessThan(3_000);
    expect(CBE_BIRR_AUTHORITATIVE_PDF_MAX_CONCURRENT_CHILDREN).toBe(1);
    expect(CBE_BIRR_AUTHORITATIVE_PDF_CHILD_MAX_OLD_GENERATION_MB).toBe(96);
    expect(CBE_BIRR_AUTHORITATIVE_PDF_CHILD_MAX_SEMI_SPACE_MB).toBe(16);
    expect(CBE_BIRR_AUTHORITATIVE_PDF_CHILD_STACK_KB).toBe(4_096);
    expect(CBE_BIRR_AUTHORITATIVE_PDF_MAX_IPC_RESULT_BYTES).toBe(8_192);

    const indexModules = import.meta.glob('./index.ts', {
      eager: true,
      import: 'default',
      query: '?raw',
    }) as Record<string, string>;
    const isolationModules = import.meta.glob('./isolation.ts', {
      eager: true,
      import: 'default',
      query: '?raw',
    }) as Record<string, string>;
    const indexSource = Object.values(indexModules)[0]!;
    const isolationSource = Object.values(isolationModules)[0]!;
    const byteLengthPreflightOffset = indexSource.lastIndexOf(
      'const pdfByteLength = exactUint8ArrayByteLength(pdfBytesCandidate)',
    );
    const defensiveCopyOffset = indexSource.lastIndexOf(
      'const pdfBytes = copyExactUint8Array(pdfBytesCandidate, pdfByteLength)',
    );
    expect(byteLengthPreflightOffset).toBeGreaterThanOrEqual(0);
    expect(defensiveCopyOffset).toBeGreaterThan(byteLengthPreflightOffset);
    expect(indexSource).toContain(
      'Reflect.apply(intrinsicTypedArrayByteLengthGetter, candidate, [])',
    );
    expect(indexSource).toContain('spawnCbeBirrPdfParserChild(');
    expect(indexSource).toContain('process.send!(frame');
    expect(indexSource).not.toMatch(
      /export\s+async\s+function\s+parseCbeBirrAuthoritativePdfInIsolatedChild/u,
    );
    expect(isolationSource).toContain('const child = spawn(');
    expect(isolationSource).toContain('fileURLToPath(entryModuleUrl)');
    expect(isolationSource).toContain("stdio: ['ignore', 'ignore', 'ignore', 'ipc']");
    expect(isolationSource).toContain('env: Object.freeze({})');
    expect(isolationSource).toContain("child.kill('SIGKILL')");
    expect(isolationSource).not.toContain('node:worker_threads');
  });

  it('commits no PDF fixture and exposes no network, URL, callback, filesystem, database, or loader API', () => {
    const pdfFiles = import.meta.glob('../**/*.pdf', {
      eager: true,
      import: 'default',
      query: '?raw',
    });
    expect(pdfFiles).toEqual({});

    const modules = import.meta.glob('./*.ts', {
      eager: true,
      import: 'default',
      query: '?raw',
    }) as Record<string, string>;
    const sources = Object.entries(modules).filter(([path]) => !path.endsWith('.test.ts'));
    expect(sources).toHaveLength(2);
    for (const [, source] of sources) {
      expect(source).not.toMatch(/\bimport\s*\(/u);
      expect(source).not.toMatch(/\brequire\s*\(/u);
      expect(source).not.toMatch(/\bfetch\s*\(/u);
      expect(source).not.toMatch(/\bprocess\s*\.\s*env\b/u);
      expect(source).not.toMatch(/from ['"](?:node:)?(?:http|https|fs|net|tls|pg|postgres)/u);
      expect(source).not.toMatch(/readonly\s+(?:url|load|fetch|request|callback)\s*:/u);
      expect(source).not.toMatch(/\b(?:readFile|writeFile|connect|query)\s*\(/u);
    }
  });
});
