// HU-ASMS: Strict UUID Validation Helpers for Representative Workflows
import { isValidUuid } from '@hu-asms/validation';

export function validateUuidIdentifier(id: unknown, label: string): string | null {
  if (!isValidUuid(id)) {
    return `Invalid ${label} identifier.`;
  }
  return null;
}

export function validateDeliveryBatchUuids(input: {
  sectionId: string;
  projectId: string;
  teacherId?: string;
  submissionIds: string[];
}): string | null {
  if (!isValidUuid(input.sectionId)) {
    return 'Invalid section identifier.';
  }
  if (!isValidUuid(input.projectId)) {
    return 'Invalid project identifier.';
  }
  if (input.teacherId !== undefined && input.teacherId !== '' && !isValidUuid(input.teacherId)) {
    return 'Invalid teacher identifier.';
  }
  if (!Array.isArray(input.submissionIds) || input.submissionIds.length === 0) {
    return null;
  }
  for (const submissionId of input.submissionIds) {
    if (!isValidUuid(submissionId)) {
      return 'Invalid submission identifier in delivery batch.';
    }
  }
  return null;
}

export function validateGroupCreationUuids(input: {
  sectionId: string;
  projectId: string;
  leaderStudentId: string;
  memberStudentIds: string[];
}): string | null {
  if (!isValidUuid(input.sectionId)) {
    return 'Invalid section identifier.';
  }
  if (!isValidUuid(input.projectId)) {
    return 'Invalid project identifier.';
  }
  if (!isValidUuid(input.leaderStudentId)) {
    return 'Invalid group leader identifier.';
  }
  if (Array.isArray(input.memberStudentIds)) {
    for (const memberId of input.memberStudentIds) {
      if (!isValidUuid(memberId)) {
        return 'Invalid member student identifier.';
      }
    }
  }
  return null;
}
