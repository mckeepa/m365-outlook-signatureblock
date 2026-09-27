export interface SignatureProfile {
  displayName?: string | null;
  mail?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  businessPhone?: string | null;
}

export interface SignatureTemplate {
  id: string;
  name: string;
  version: number;
  html: string;
  isDefault: boolean;
  eligibleDepartments?: string[];
  eligibleJobTitles?: string[];
}

export interface SignaturePreferences {
  favoriteTemplateIds: string[];
  lastSelectedTemplateId?: string;
}