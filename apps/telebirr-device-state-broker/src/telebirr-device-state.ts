import { isProxy } from 'node:util/types';

import {
  decodeSignedTelebirrDeviceBridgeAcknowledgement,
  decodeSignedTelebirrDeviceBridgeEnrollmentCertificate,
  decodeTelebirrLivePilotSignedAssignment,
  type SignedTelebirrDeviceBridgeAcknowledgement,
  type SignedTelebirrDeviceBridgeEnrollmentCertificate,
  type SignedTelebirrDeviceBridgePairingRequest,
  type SignedTelebirrDeviceBridgeRequest,
  type TelebirrDeviceBridgeEnrollmentCertificateBody,
  type TelebirrDeviceBridgeHeartbeatPayload,
  type TelebirrDeviceBridgeObservationUploadPayload,
  type TelebirrLivePilotSignedAssignment,
} from '@fetanagent/telebirr-verification-foundation';

export interface TelebirrDeviceStateCommandResponse {
  readonly acknowledgement: SignedTelebirrDeviceBridgeAcknowledgement;
  readonly assignment: TelebirrLivePilotSignedAssignment | null;
}

export type TelebirrDeviceStatePairingClaim =
  | {
      readonly kind: 'claimed';
      readonly certificateBody: TelebirrDeviceBridgeEnrollmentCertificateBody;
    }
  | { readonly kind: 'in_progress' }
  | {
      readonly kind: 'completed';
      readonly certificate: SignedTelebirrDeviceBridgeEnrollmentCertificate;
    };

export type TelebirrDeviceStateReplayClaim =
  | { readonly kind: 'claimed' }
  | { readonly kind: 'in_progress' }
  | {
      readonly kind: 'completed';
      readonly response: TelebirrDeviceStateCommandResponse;
    };

export type TelebirrDeviceStateHeartbeatResult =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'retry' }
  | {
      readonly kind: 'rejected';
      readonly reason: 'device_revoked' | 'pilot_stopped';
    };

export type TelebirrDeviceStateEvidenceResult =
  | { readonly kind: 'accepted'; readonly replayed: boolean }
  | { readonly kind: 'retry' }
  | {
      readonly kind: 'rejected';
      readonly reason:
        'binding_mismatch' | 'device_revoked' | 'observation_rejected' | 'pilot_stopped';
    };

export interface TelebirrDeviceStateDatabase {
  claimPairingChallenge(
    request: SignedTelebirrDeviceBridgePairingRequest,
    assessedAt: string,
  ): Promise<TelebirrDeviceStatePairingClaim | undefined>;
  completePairingChallenge(
    pairingRequestBodyDigest: string,
    certificate: SignedTelebirrDeviceBridgeEnrollmentCertificate,
  ): Promise<boolean>;
  releasePairingChallenge(pairingRequestBodyDigest: string): Promise<void>;
  loadEnrollment(
    enrollmentId: string,
  ): Promise<SignedTelebirrDeviceBridgeEnrollmentCertificate | undefined>;
  claimReplay(
    replayIdentity: string,
    requestExpiresAt: string,
  ): Promise<TelebirrDeviceStateReplayClaim>;
  completeReplay(
    replayIdentity: string,
    response: TelebirrDeviceStateCommandResponse,
    requestExpiresAt: string,
  ): Promise<boolean>;
  releaseReplay(replayIdentity: string): Promise<void>;
  recordHeartbeat(
    certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
    request: SignedTelebirrDeviceBridgeRequest,
    payload: TelebirrDeviceBridgeHeartbeatPayload,
  ): Promise<TelebirrDeviceStateHeartbeatResult>;
  stageEvidenceOnly(
    certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
    request: SignedTelebirrDeviceBridgeRequest,
    payload: TelebirrDeviceBridgeObservationUploadPayload,
  ): Promise<TelebirrDeviceStateEvidenceResult>;
}

export function decodeTelebirrDeviceStateCommandResponse(
  candidate: unknown,
): TelebirrDeviceStateCommandResponse | undefined {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    Array.isArray(candidate) ||
    isProxy(candidate) ||
    (Object.getPrototypeOf(candidate) !== Object.prototype &&
      Object.getPrototypeOf(candidate) !== null)
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== 2 ||
    !keys.includes('acknowledgement') ||
    !keys.includes('assignment') ||
    !['acknowledgement', 'assignment'].every((key) => {
      const descriptor = descriptors[key];
      return (
        descriptor !== undefined &&
        descriptor.enumerable === true &&
        Object.hasOwn(descriptor, 'value')
      );
    })
  ) {
    return undefined;
  }
  const acknowledgementCandidate = descriptors.acknowledgement?.value as unknown;
  const assignmentCandidate = descriptors.assignment?.value as unknown;
  const acknowledgement = decodeSignedTelebirrDeviceBridgeAcknowledgement(acknowledgementCandidate);
  const assignment =
    assignmentCandidate === null
      ? null
      : decodeTelebirrLivePilotSignedAssignment(assignmentCandidate);
  return acknowledgement && assignment !== undefined
    ? Object.freeze({ acknowledgement, assignment })
    : undefined;
}

export function decodeTelebirrDeviceStateEnrollment(
  candidate: unknown,
): SignedTelebirrDeviceBridgeEnrollmentCertificate | undefined {
  return decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(candidate);
}
