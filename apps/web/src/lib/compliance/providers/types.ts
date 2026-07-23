/**
 * Enums and unions for compliance types
 */
export type DocType = 'PASSPORT' | 'DRIVERS_LICENSE' | 'NATIONAL_ID' | 'RESIDENCE_PERMIT' | 'PAN' | 'AADHAAR' | 'VOTER_ID' | 'VISA' | 'OTHER';
export type CheckType = 'GOV_ID' | 'FACE' | 'LIVENESS' | 'AML' | 'PEP' | 'SANCTIONS' | 'ADVERSE_MEDIA' | 'KYB' | 'ADDRESS' | 'SOURCE_OF_FUNDS';
export type VerificationStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'expired' | 'requires_review';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type EntityType = 'person' | 'company';

// Inputs
export interface VerifyConfig {
  templateId?: string;
  levelName?: string;
  country?: string;
  requiredDocs: DocType[];
  requiredChecks: CheckType[];
  referenceId: string;   // FurlPay internal user ID
  redirectUrl?: string;
}

export interface AMLInput {
  name: string;
  dateOfBirth?: string;
  country?: string;
  entityType: EntityType;
  referenceId: string;
}

export interface PEPInput extends AMLInput {}

export interface SanctionsInput extends AMLInput {
  walletAddresses?: string[];
}

export interface KYBInput {
  companyName: string;
  registrationNumber?: string;
  country: string;
  referenceId: string;
}

// Results
export interface VerifySession {
  sessionId: string;
  sessionUrl: string;     // URL to redirect user to for verification
  provider: string;
  expiresAt: number;
  status: VerificationStatus;
}

export interface DocResult {
  documentId: string;
  type: DocType;
  status: 'accepted' | 'rejected' | 'pending';
  extractedData?: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    documentNumber?: string;
    expiryDate?: string;
    nationality?: string;
    address?: string;
  };
  reason?: string;
}

export interface LivenessResult {
  passed: boolean;
  confidence: number;  // 0-1
  method: 'passive' | 'active' | 'motion';
  reason?: string;
}

export interface IdentityResult {
  status: VerificationStatus;
  riskLevel: RiskLevel;
  checks: CheckResult[];
  verifiedAt?: number;
  provider: string;
  providerRef: string;
  rawProviderStatus?: string;
}

export interface CheckResult {
  type: CheckType;
  passed: boolean;
  confidence: number;
  details?: Record<string, unknown>;
  reason?: string;
}

export interface AMLResult {
  matched: boolean;
  riskLevel: RiskLevel;
  hits: AMLHit[];
  screenedAt: number;
  provider: string;
  searchRef: string;
}

export interface AMLHit {
  name: string;
  matchScore: number;
  sources: string[];
  types: string[];      // 'sanction' | 'pep' | 'adverse-media' etc
  listingUrl?: string;
}

export interface PEPResult extends AMLResult {}
export interface SanctionsResult extends AMLResult {}

export interface KYBResult {
  status: VerificationStatus;
  companyName: string;
  registrationVerified: boolean;
  officers?: { name: string; role: string }[];
  ubos?: { name: string; ownership: number }[];
  riskLevel: RiskLevel;
  provider: string;
}

export interface RefreshResult {
  status: VerificationStatus;
  changesDetected: boolean;
  details?: string;
}

export interface WebhookPayload {
  provider: string;
  eventType: string;
  referenceId: string;
  status: VerificationStatus;
  riskLevel?: RiskLevel;
  rawEvent: Record<string, unknown>;
  timestamp: number;
}

/**
 * The main interface for Compliance Providers
 */
export interface ComplianceProvider {
  readonly name: string;
  
  // Identity verification
  startVerification(userId: string, config: VerifyConfig): Promise<VerifySession>;
  uploadDocument?(sessionId: string, doc: Buffer, type: DocType): Promise<DocResult>;
  performLiveness?(sessionId: string): Promise<LivenessResult>;
  verifyIdentity(sessionId: string): Promise<IdentityResult>;
  
  // AML screening
  screenAML(input: AMLInput): Promise<AMLResult>;
  screenPEP(input: PEPInput): Promise<PEPResult>;
  screenSanctions(input: SanctionsInput): Promise<SanctionsResult>;
  
  // Business verification
  verifyBusiness?(input: KYBInput): Promise<KYBResult>;
  
  // Lifecycle
  refreshVerification?(userId: string): Promise<RefreshResult>;
  
  // Webhooks
  verifyWebhook(rawBody: string | Buffer, signature: string, timestamp?: string): Promise<WebhookPayload>;
}

/**
 * Audit record stored in KV for every compliance action
 */
export interface ComplianceAuditRecord {
  id: string;
  userId: string;
  action: string;
  provider: string;
  result: VerificationStatus | RiskLevel;
  timestamp: number;
  metadata: Record<string, unknown>;
}
