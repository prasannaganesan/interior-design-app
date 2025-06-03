const MODEL_STORE = 'sam2-models';

interface ModelInfo {
  name: string;
  encoderUrl: string;
  decoderUrl: string;
  size: 'tiny' | 'base' | 'large';
}

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    name: 'SAM2 Tiny',
    encoderUrl: 'https://huggingface.co/g-ronimo/sam2-tiny/resolve/main/sam2_hiera_tiny_encoder.with_runtime_opt.ort',
    decoderUrl: 'https://huggingface.co/g-ronimo/sam2-tiny/resolve/main/sam2_hiera_tiny_decoder.onnx',
    size: 'tiny'
  },
  {
    name: 'SAM2 Base',
    encoderUrl: 'https://huggingface.co/g-ronimo/sam2-base/resolve/main/sam2_hiera_base_encoder.with_runtime_opt.ort',
    decoderUrl: 'https://huggingface.co/g-ronimo/sam2-base/resolve/main/sam2_hiera_base_decoder.onnx',
    size: 'base'
  }
];

export async function getModelFiles(
  modelInfo: ModelInfo,
  onStatus?: (msg: string) => void
): Promise<{ encoderPath: string, decoderPath: string }> {
  const updateStatus = onStatus ?? (() => {});
  try {
    // First try using Origin Private File System
    if ('showDirectoryPicker' in window && 'storage' in navigator) {
      try {
        const root = await navigator.storage.getDirectory();
        const modelDir = await root.getDirectoryHandle(MODEL_STORE, { create: true });

        // Check if models are already cached
        const encoderPath = await getCachedModel(
          modelDir,
          modelInfo.encoderUrl,
          `${modelInfo.size}-encoder`,
          updateStatus
        );
        const decoderPath = await getCachedModel(
          modelDir,
          modelInfo.decoderUrl,
          `${modelInfo.size}-decoder`,
          updateStatus
        );

        return { encoderPath, decoderPath };
      } catch (err) {
        console.warn('Failed to use Origin Private File System, falling back to direct downloads:', err);
      }
    }

    // Fallback: Download directly without caching
    updateStatus('Downloading models...');
    const [encoderResponse, decoderResponse] = await Promise.all([
      fetch(modelInfo.encoderUrl),
      fetch(modelInfo.decoderUrl)
    ]);

    if (!encoderResponse.ok) {
      throw new Error(`Failed to download encoder: ${encoderResponse.statusText}`);
    }
    if (!decoderResponse.ok) {
      throw new Error(`Failed to download decoder: ${decoderResponse.statusText}`);
    }

    const [encoderBlob, decoderBlob] = await Promise.all([
      encoderResponse.blob(),
      decoderResponse.blob()
    ]);

    return {
      encoderPath: URL.createObjectURL(encoderBlob),
      decoderPath: URL.createObjectURL(decoderBlob)
    };
  } catch (error) {
    console.error('Error in getModelFiles:', error);
    throw new Error(`Failed to get model files: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function getCachedModel(
  modelDir: FileSystemDirectoryHandle,
  url: string,
  filename: string,
  onStatus: (msg: string) => void
): Promise<string> {
  try {
    // Try to get existing file
    const fileHandle = await modelDir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    onStatus(`Using cached model: ${filename}`);
    return URL.createObjectURL(file);
  } catch {
    // File doesn't exist, download it
    onStatus(`Downloading model ${filename}...`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText} (${response.status})`);
    }

    const blob = await response.blob();
    const fileHandle = await modelDir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    onStatus(`Successfully downloaded and cached: ${filename}`);
    return URL.createObjectURL(blob);
  }
}
