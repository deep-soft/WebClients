/**
 * Feature flag list from Unleash
 * Format should be FeatureFlagName = 'FeatureFlagName'
 */
enum MailFeatureFlag {
    ExternalSSOWeb = 'ExternalSSOWeb',
    AttachmentThumbnails = 'AttachmentThumbnails',
    WebMailPageSizeSetting = 'WebMailPageSizeSetting',
    EmailForwarding = 'EmailForwarding',
}

enum AccountFlag {
    MaintenanceImporter = 'MaintenanceImporter',
    SignedInAccountRecovery = 'SignedInAccountRecovery',
}

export type FeatureFlag = `${MailFeatureFlag}` | `${AccountFlag}`;
