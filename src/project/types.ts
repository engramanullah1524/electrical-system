/** The body that issues the building permit, which decides the approval route. */
export type PermitAuthority = 'DM' | 'DDA' | 'Trakhees' | 'Other';

export const PERMIT_AUTHORITY_LABEL: Record<PermitAuthority, string> = {
  DM: 'Dubai Municipality',
  DDA: 'Dubai Development Authority',
  Trakhees: 'Trakhees (PCFC)',
  Other: 'Other',
};

export interface Project {
  id: string;
  name: string;
  permitAuthority: PermitAuthority;
  /** False until the authority has been read off the actual permit, not just stated. */
  authorityConfirmed: boolean;
  buildings: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}
