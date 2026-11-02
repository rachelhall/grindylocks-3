import { requireOptionalNativeModule } from 'expo';

type DataSaverState = { lowData: boolean; autoplayVideo: boolean };

type DataSaverModule = { getStateAsync(): Promise<DataSaverState> };

// Optional: builds made before this module existed don't have it, and then
// clips simply autoplay (Reduce Motion is still respected in JavaScript).
const native = requireOptionalNativeModule<DataSaverModule>('GrindylocksDataSaver');

/** Low Data Mode / Data Saver, and iOS's Auto-Play Video Previews setting. */
export async function getDataSaverState(): Promise<DataSaverState> {
  if (!native) return { lowData: false, autoplayVideo: true };
  try {
    return await native.getStateAsync();
  } catch {
    return { lowData: false, autoplayVideo: true };
  }
}
