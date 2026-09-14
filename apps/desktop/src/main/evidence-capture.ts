import { randomUUID } from 'node:crypto';
import { createEvidenceSnapshot, EvidenceAssetStore, EvidenceCaptureQueue, renderEvidenceChartPng, type EvidenceRecordPlan } from '@arise/evidence';
import type { EvidenceRepository } from '@arise/database';

export class EvidenceCaptureCoordinator {
  readonly queue = new EvidenceCaptureQueue(2);
  constructor(private readonly repository: EvidenceRepository, readonly assets: EvidenceAssetStore) {}

  enqueue(plans: readonly EvidenceRecordPlan[], origin: 'AUTOMATIC' | 'MANUAL' | 'REGENERATED_VIEW' = 'AUTOMATIC', capture: (plan: EvidenceRecordPlan) => Promise<Uint8Array> = async (plan) => renderEvidenceChartPng(plan.workspaceState)): void {
    for (const plan of plans) {
      this.queue.enqueue({
        key: plan.event.id,
        run: async () => {
          const bytes = await capture(plan);
          const snapshotId = `es-${randomUUID()}`;
          const asset = await this.assets.writePng({ eventId: plan.event.id, snapshotId, bytes });
          const snapshot = createEvidenceSnapshot({ id: snapshotId, evidenceEventId: plan.event.id, chartWorkspaceState: plan.workspaceState, framingProfile: plan.framingProfile, imagePath: asset.relativePath, imageHash: asset.hash, capturedAt: new Date().toISOString(), captureOrigin: origin });
          this.repository.recordCaptureSuccess(snapshot, `eca-${randomUUID()}`);
        },
        onFailure: (error) => this.repository.recordCaptureFailure({ id: `eca-${randomUUID()}`, evidenceEventId: plan.event.id, error: error.message, attemptedAt: new Date().toISOString() }),
      });
    }
  }
}
