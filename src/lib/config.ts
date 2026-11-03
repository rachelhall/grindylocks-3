/**
 * App-wide links and addresses shown in Settings. Keep the support address
 * and privacy page in step with the web's src/lib/contact.ts.
 */
export const appConfig = {
  /** Where "Help and contact" and data requests go. */
  supportEmail: 'support@grindylocks.com',
  /** The published privacy policy (web/src/app/site/privacy). */
  privacyPolicyUrl: 'https://grindylocks.com/privacy',
  /** OpenStreetMap's copyright and licence page, for the map data credit. */
  osmCopyrightUrl: 'https://www.openstreetmap.org/copyright',
} as const;
