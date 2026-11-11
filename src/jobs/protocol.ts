export const PROTOCOL_VERSION = 1;
export const COMPUTE_OPERATIONS = [
  'compile',
  'validate',
  'navigation',
  'generate',
  'metrics',
  'identity',
] as const;
export const STORAGE_OPERATIONS = [
  'list',
  'get',
  'save',
  'append',
  'finalize',
  'validate-import',
  'import',
  'export',
  'draft',
  'rename',
  'delete',
  'recover',
] as const;
export type Operation = (typeof COMPUTE_OPERATIONS)[number] | (typeof STORAGE_OPERATIONS)[number];
export interface JobRequest {
  protocolVersion: 1;
  jobId: string;
  ownerId: string;
  sourceRevision: number | null;
  operation: Operation;
  input: unknown;
  deterministicBudget: Record<string, number>;
}
export interface JobResponse {
  protocolVersion: 1;
  jobId: string;
  ownerId: string;
  sourceRevision: number | null;
  operation: Operation;
  kind: 'progress' | 'result' | 'error' | 'cancelled';
  payload: unknown;
}
export interface CancelRequest {
  protocolVersion: 1;
  kind: 'cancel';
  jobId: string;
}
const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const revision = (value: unknown) =>
  value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
const operation = (value: unknown) =>
  [...COMPUTE_OPERATIONS, ...STORAGE_OPERATIONS].includes(value as Operation);
function header(value: unknown): value is JobRequest {
  if (!value || typeof value !== 'object') return false;
  const o = value as JobRequest;
  return (
    o.protocolVersion === 1 &&
    id(o.jobId) &&
    id(o.ownerId) &&
    revision(o.sourceRevision) &&
    operation(o.operation)
  );
}
export function isJobRequest(value: unknown): value is JobRequest {
  if (!header(value)) return false;
  const budget = value.deterministicBudget;
  return (
    !!budget &&
    typeof budget === 'object' &&
    !Array.isArray(budget) &&
    Object.keys(budget).length <= 16 &&
    Object.values(budget).every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000)
  );
}
export function isJobResponse(value: unknown): value is JobResponse {
  if (!header(value)) return false;
  return ['progress', 'result', 'error', 'cancelled'].includes(
    (value as unknown as JobResponse).kind,
  );
}
export function response(
  request: JobRequest,
  kind: JobResponse['kind'],
  payload: unknown,
): JobResponse {
  return {
    protocolVersion: 1,
    jobId: request.jobId,
    ownerId: request.ownerId,
    sourceRevision: request.sourceRevision,
    operation: request.operation,
    kind,
    payload,
  };
}
