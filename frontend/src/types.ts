export interface ExtractedForm {
  firstName: string | null;
  lastName: string | null;
  idNumber: string | null;
  centralNumbers: string[];
  sampleReceivedDate: string | null;
  referringOrganization: string | null;
  commitmentNumbers: string[];
}