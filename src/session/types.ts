import type { Document } from '../domain';
export type SessionState =
  | 'prepared'
  | 'running'
  | 'paused'
  | 'interrupted'
  | 'finished'
  | 'stopped';
export interface Condition {
  id: string;
  environment: Document['environment'];
  previewed: boolean;
  inputMode: 'keyboard' | 'touch';
  speedMps: number;
  goalDirectionKnown: boolean;
  siteKnown: boolean;
  observationProfile: string;
}
export interface Sample {
  activeTimeMs: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  inputMode: 'keyboard' | 'touch';
}
export interface WalkEvent {
  activeTimeMs: number;
  kind: 'start' | 'pause' | 'resume' | 'finish' | 'stop' | 'contact-turn';
  sampleIndex: number;
}
export interface Session {
  sessionId: string;
  mapHash: string;
  condition: Condition;
  state: SessionState;
  elapsedMs: number;
  distanceM: number;
  lastCommittedSequence: number;
  lastSample: Sample | null;
  createdAt: number;
  updatedAt: number;
  originId?: string;
}
export interface WalkChunk {
  sessionId: string;
  sequence: number;
  samples: Sample[];
  events: WalkEvent[];
  elapsedMs: number;
  distanceM: number;
  contentHash: string;
}
export type ChunkInput = Omit<WalkChunk, 'contentHash'>;
