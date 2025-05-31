import { useEffect, useRef, useState } from 'react';
import ColorPicker from './ColorPicker';
import { SAM2 } from '../lib/sam';
import { AVAILABLE_MODELS, getModelFiles } from '../lib/sam/model-loader';
import {
  srgbToLinear,
  linearToSrgb,
  linearRgbToLab,
  labToLinearRgb,
  hexToLab,
  boxBlurFloat
} from '../lib/color';

import { type WhiteBalance } from './WhiteBalanceControls';

interface LightingPreset {
  r: number;
  g: number;
  b: number;
  brightness: number;
}

const LIGHTING_SETTINGS: Record<string, LightingPreset> = {
  normal: { r: 1, g: 1, b: 1, brightness: 1 },
  morning: { r: 1.1, g: 1.05, b: 0.95, brightness: 1.1 },
  afternoon: { r: 1.05, g: 1.05, b: 1.1, brightness: 1 },
  evening: { r: 1.1, g: 0.9, b: 0.8, brightness: 1 },
  // Night mode simulates indoor LED lighting rather than moonlight
  night: { r: 0.9, g: 0.95, b: 1.1, brightness: 0.8 },
  cloudy: { r: 0.95, g: 1, b: 1.1, brightness: 0.95 }
};

function applyWhiteBalance(image: ImageData, wb: WhiteBalance): ImageData {
  const out = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    out[i] = Math.min(255, image.data[i] * wb.r);
    out[i + 1] = Math.min(255, image.data[i + 1] * wb.g);
    out[i + 2] = Math.min(255, image.data[i + 2] * wb.b);
    out[i + 3] = image.data[i + 3];
  }
  return new ImageData(out, image.width, image.height);
}

function applyLighting(ctx: CanvasRenderingContext2D, width: number, height: number, mode: string) {
  const preset = LIGHTING_SETTINGS[mode];
  if (!preset || mode === 'normal') return;
  const img = ctx.getImageData(0, 0, width, height);
  const { r, g, b, brightness } = preset;
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, data[i] * r * brightness);
    data[i + 1] = Math.min(255, data[i + 1] * g * brightness);
    data[i + 2] = Math.min(255, data[i + 2] * b * brightness);
  }
  ctx.putImageData(img, 0, 0);
}

interface ImageCanvasProps {
  imageUrl: string;
  selectedColor: string;
  whiteBalance: WhiteBalance;
  lighting: string;
}

interface HistoryState {
  imageData: ImageData;
  timestamp: number;
}


interface WallSurface {
  id: string;
  pixels: Uint32Array;
  color: string;
  enabled: boolean;
  groupId: string | null;
}

interface WallGroup {
  id: string;
  name: string;
  color: string;
}


export default function ImageCanvas({ imageUrl, selectedColor, whiteBalance, lighting }: ImageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rawImageData, setRawImageData] = useState<ImageData | null>(null);
  const [originalImageData, setOriginalImageData] = useState<ImageData | null>(null);
  const [baseImageData, setBaseImageData] = useState<ImageData | null>(null);
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [sam, setSam] = useState<SAM2 | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [walls, setWalls] = useState<WallSurface[]>([]);
  const [groups, setGroups] = useState<WallGroup[]>([]);

  const retinexRef = useRef<{
    L: Float32Array;
    A: Float32Array;
    B: Float32Array;
    gray: Float32Array;
    shade: Float32Array;
  } | null>(null);

  // Radius used for the Retinex illumination estimate. A smaller
  // radius reduces over-blurring which previously caused the wall's
  // mean lightness to become unrealistically small and led to washed
  // out recoloring.
  const RETINEX_BLUR_RADIUS = 15;

  // Initialize SAM2
  useEffect(() => {
    async function initSAM() {
      try {
        setIsProcessing(true);
        setStatus('Initializing SAM2...');
        // Start with tiny model for faster loading
        const modelInfo = AVAILABLE_MODELS[0];
        const { encoderPath, decoderPath } = await getModelFiles(modelInfo);

        const samInstance = new SAM2({
          encoderPath,
          decoderPath,
          modelSize: modelInfo.size
        });

        setStatus('Loading SAM2 model...');
        await samInstance.initialize();
        setSam(samInstance);
        setStatus('SAM2 initialized');
      } catch (error) {
        console.error('Failed to initialize SAM2:', error);
        setStatus('Failed to initialize SAM2');
      } finally {
        setIsProcessing(false);
      }
    }

    initSAM();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const image = new Image();
    image.src = imageUrl;
    image.onload = () => {
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.drawImage(image, 0, 0);
      const rawData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setRawImageData(rawData);
    };
  }, [imageUrl]);

  useEffect(() => {
    async function process() {
      const canvas = canvasRef.current;
      if (!canvas || !rawImageData) return;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      setIsProcessing(true);
      setStatus('Processing image...');

      try {
        const balancedData = applyWhiteBalance(rawImageData, whiteBalance);
        setOriginalImageData(balancedData);
        ctx.putImageData(balancedData, 0, 0);

      const { data } = balancedData;
      const size = canvas.width * canvas.height;
      const logR = new Float32Array(size);
      const logG = new Float32Array(size);
      const logB = new Float32Array(size);
      const logL = new Float32Array(size);
      const gray = new Float32Array(size);

      for (let i = 0, p = 0; i < size; i++, p += 4) {
        const rl = srgbToLinear(data[p]);
        const gl = srgbToLinear(data[p + 1]);
        const bl = srgbToLinear(data[p + 2]);
        logR[i] = Math.log(rl + 1e-6);
        logG[i] = Math.log(gl + 1e-6);
        logB[i] = Math.log(bl + 1e-6);
        const lum = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
        gray[i] = lum;
        logL[i] = Math.log(lum + 1e-6);
      }

      const S_log = boxBlurFloat(logL, canvas.width, canvas.height, RETINEX_BLUR_RADIUS);

      const L = new Float32Array(size);
      const A = new Float32Array(size);
      const B = new Float32Array(size);
      const shade = new Float32Array(size);

      for (let i = 0; i < size; i++) {
        const rl = Math.exp(logR[i] - S_log[i]);
        const gl = Math.exp(logG[i] - S_log[i]);
        const bl = Math.exp(logB[i] - S_log[i]);
        const lab = linearRgbToLab(rl, gl, bl);
        L[i] = lab[0];
        A[i] = lab[1];
        B[i] = lab[2];
        shade[i] = Math.exp(S_log[i]);
      }

      retinexRef.current = { L, A, B, gray, shade };

      setBaseImageData(balancedData);
      setHistory([{ imageData: balancedData, timestamp: Date.now() }]);
      setCurrentHistoryIndex(0);

      setWalls([]);
      setGroups([]);

      if (sam) {
        try {
          setStatus('Generating image embeddings...');
          await sam.generateEmbedding(balancedData);
        } catch (error) {
          console.error('Failed to generate embeddings:', error);
          setStatus('Failed to generate embeddings');
        }
      }

      setStatus('Ready');
    } catch (error) {
      console.error('Failed to process image:', error);
      setStatus('Failed to process image');
    } finally {
      setIsProcessing(false);
    }
  }
  process();
}, [rawImageData, whiteBalance, sam]);

  const hoverTimer = useRef<number | null>(null);


  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !sam) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round(e.nativeEvent.offsetX * scaleX);
    const y = Math.round(e.nativeEvent.offsetY * scaleY);
    const clampedX = Math.min(Math.max(x, 0), canvas.width - 1);
    const clampedY = Math.min(Math.max(y, 0), canvas.height - 1);

    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
    }

    hoverTimer.current = window.setTimeout(async () => {
      try {
        const mask = await sam.generateMask({ x: clampedX, y: clampedY });
        showHoverMask(mask);
      } catch (err) {
        console.error('Failed to generate hover mask', err);
      }
    }, 150);
  };

  const showHoverMask = (mask: ImageData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const base = history[currentHistoryIndex]?.imageData;
    if (!base) return;

    ctx.putImageData(base, 0, 0);
    const scaledMask =
      mask.width === canvas.width && mask.height === canvas.height
        ? mask
        : scaleImageData(mask, canvas.width, canvas.height);

    const overlay = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = overlay.data;
    const maskData = scaledMask.data;

    for (let i = 0; i < data.length; i += 4) {
      if (maskData[i] > 0) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 128;
      }
    }

    ctx.putImageData(overlay, 0, 0);
  };

  const clearHover = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const base = history[currentHistoryIndex]?.imageData;
    if (base) ctx.putImageData(base, 0, 0);
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const handleMouseDown = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sam || isProcessing) return;

    // Cancel any pending hover highlight
    clearHover();

    const canvas = canvasRef.current;
    if (!canvas || !originalImageData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsProcessing(true);
    setStatus('Generating mask...');

    try {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round(e.nativeEvent.offsetX * scaleX);
      const y = Math.round(e.nativeEvent.offsetY * scaleY);

      const clampedX = Math.min(Math.max(x, 0), canvas.width - 1);
      const clampedY = Math.min(Math.max(y, 0), canvas.height - 1);

      // Generate mask for clicked point
      const mask = await sam.generateMask({ x: clampedX, y: clampedY });

      // Scale mask to canvas size if needed
      const scaledMask =
        mask.width === canvas.width && mask.height === canvas.height
          ? mask
          : scaleImageData(mask, canvas.width, canvas.height);
      const indices = maskToIndices(scaledMask);
      if (baseImageData) {
        const updated = new ImageData(
          new Uint8ClampedArray(baseImageData.data),
          baseImageData.width,
          baseImageData.height
        );
        applyRetinexRecolor(updated, indices, selectedColor);
        setBaseImageData(updated);
        ctx.putImageData(updated, 0, 0);
        applyLighting(ctx, canvas.width, canvas.height, lighting);
      }

      const newWall: WallSurface = {
        id: `wall-${Date.now()}`,
        pixels: indices,
        color: selectedColor,
        enabled: true,
        groupId: null
      };
      setWalls([...walls, newWall]);

      // Save to history
      saveToHistory();
      setStatus('Ready');
    } catch (error) {
      console.error('Failed to generate/apply mask:', error);
      setStatus('Failed to generate mask');
    } finally {
      setIsProcessing(false);
    }
  };

  const scaleImageData = (source: ImageData, targetWidth: number, targetHeight: number): ImageData => {
    if (source.width === targetWidth && source.height === targetHeight) {
      return source;
    }
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    // Draw source image data
    ctx.putImageData(source, 0, 0);

    // Create a temporary canvas for scaling
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = targetWidth;
    tempCanvas.height = targetHeight;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) throw new Error('Failed to get temp canvas context');

    // Disable smoothing for crisp mask edges
    tempCtx.imageSmoothingEnabled = false;

    // Scale the image
    tempCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
    return tempCtx.getImageData(0, 0, targetWidth, targetHeight);
  };

  const maskToIndices = (mask: ImageData): Uint32Array => {
    const { width, height, data } = mask;
    const pixels: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i] > 0) {
          pixels.push(y * width + x);
        }
      }
    }
    return new Uint32Array(pixels);
  };

  const applyRetinexRecolor = (baseData: ImageData, indices: Uint32Array, colorHex: string) => {
    const pre = retinexRef.current;
    if (!pre) return;

    const data = baseData.data;

    const { L, A, B, gray, shade } = pre;

    let sumL = 0;
    let sumA = 0;
    let sumB = 0;
    let sumGray = 0;
    const count = indices.length;

    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      sumL += L[i];
      sumA += A[i];
      sumB += B[i];
      sumGray += gray[i];
    }

    if (count === 0) return;
    const meanL = sumL / count;
    const meanA = sumA / count;
    const meanB = sumB / count;
    const meanGray = sumGray / count;

    const [Lt, at, bt] = hexToLab(colorHex);

    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const p = i * 4;
      const chromaScale = Math.min(Math.max(gray[i] / meanGray, 0.4), 1.0);
      const a = at + (A[i] - meanA) * chromaScale;
      const b = bt + (B[i] - meanB) * chromaScale;
      const rawScale = meanL > 0 ? Lt / meanL : 1;
      const lightnessScale = Math.min(rawScale, 5);
      const Lval = Math.min(Math.max(L[i] * lightnessScale, 0), 100);
      const [rLin, gLin, bLin] = labToLinearRgb(Lval, a, b);
      const r = linearToSrgb(rLin * shade[i]);
      const g = linearToSrgb(gLin * shade[i]);
      const bb = linearToSrgb(bLin * shade[i]);
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = bb;
    }

  };

  const recolorWall = (wall: WallSurface, newColor: string) => {
    if (!baseImageData) return;
    const updated = new ImageData(
      new Uint8ClampedArray(baseImageData.data),
      baseImageData.width,
      baseImageData.height
    );
    applyRetinexRecolor(updated, wall.pixels, newColor);
    setBaseImageData(updated);
    wall.color = newColor;
    setWalls(walls.map(w => w.id === wall.id ? wall : w));
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(updated, 0, 0);
        applyLighting(ctx, canvas.width, canvas.height, lighting);
      }
    }
    saveToHistory();
  };

  const reapplyWalls = (wallList: WallSurface[] = walls) => {
    const canvas = canvasRef.current;
    if (!canvas || !originalImageData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const base = new ImageData(
      new Uint8ClampedArray(originalImageData.data),
      originalImageData.width,
      originalImageData.height
    );
    for (const wall of wallList) {
      if (!wall.enabled) continue;
      applyRetinexRecolor(base, wall.pixels, wall.color);
    }
    setBaseImageData(base);
    ctx.putImageData(base, 0, 0);
    applyLighting(ctx, canvas.width, canvas.height, lighting);
  };

  const saveToHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentImageData = baseImageData
      ? new ImageData(new Uint8ClampedArray(baseImageData.data), baseImageData.width, baseImageData.height)
      : ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Remove any redo states
    const newHistory = history.slice(0, currentHistoryIndex + 1);
    newHistory.push({
      imageData: currentImageData,
      timestamp: Date.now()
    });

    // Limit history size to prevent memory issues
    if (newHistory.length > 20) {
      newHistory.shift();
    }

    setHistory(newHistory);
    setCurrentHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (currentHistoryIndex > 0) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const newIndex = currentHistoryIndex - 1;
      const img = history[newIndex].imageData;
      setBaseImageData(img);
      ctx.putImageData(img, 0, 0);
      applyLighting(ctx, canvas.width, canvas.height, lighting);
      setCurrentHistoryIndex(newIndex);
    }
  };

  const redo = () => {
    if (currentHistoryIndex < history.length - 1) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const newIndex = currentHistoryIndex + 1;
      const img = history[newIndex].imageData;
      setBaseImageData(img);
      ctx.putImageData(img, 0, 0);
      applyLighting(ctx, canvas.width, canvas.height, lighting);
      setCurrentHistoryIndex(newIndex);
    }
  };

  const toggleWall = (id: string) => {
    const updated = walls.map(w =>
      w.id === id ? { ...w, enabled: !w.enabled } : w
    );
    setWalls(updated);
    reapplyWalls(updated);
    saveToHistory();
  };

  const addGroup = () => {
    const name = prompt('Group name?');
    if (!name) return;
    const id = `group-${Date.now()}`;
    const groupColor = selectedColor;
    const group: WallGroup = { id, name, color: groupColor };
    setGroups([...groups, group]);
  };

  const assignWallToGroup = (wallId: string, groupId: string | null) => {
    const wall = walls.find(w => w.id === wallId);
    if (!wall) return;

    const newColor = groupId ? (groups.find(g => g.id === groupId)?.color || wall.color) : wall.color;
    const updatedWall = { ...wall, groupId, color: newColor };

    if (newColor !== wall.color) {
      recolorWall(updatedWall, newColor);
    } else {
      setWalls(walls.map(w => w.id === wallId ? updatedWall : w));
      saveToHistory();
    }

  };

  const previewGroupColor = (groupId: string, color: string) => {
    setGroups(groups.map(g => g.id === groupId ? { ...g, color } : g));
  };

  const commitGroupColor = (groupId: string, color: string) => {
    setGroups(groups.map(g => g.id === groupId ? { ...g, color } : g));
    const updated = walls.map(w =>
      w.groupId === groupId ? { ...w, color } : w
    );
    setWalls(updated);
    reapplyWalls(updated);
    saveToHistory();
  };

  const reset = () => {
    const canvas = canvasRef.current;
    if (!canvas || !originalImageData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const base = new ImageData(
      new Uint8ClampedArray(originalImageData.data),
      originalImageData.width,
      originalImageData.height
    );
    setBaseImageData(base);
    ctx.putImageData(base, 0, 0);
    setHistory([{ imageData: base, timestamp: Date.now() }]);
    setCurrentHistoryIndex(0);
    setWalls([]);
    setGroups([]);
    applyLighting(ctx, canvas.width, canvas.height, lighting);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseImageData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.putImageData(baseImageData, 0, 0);
    applyLighting(ctx, canvas.width, canvas.height, lighting);
  }, [lighting, baseImageData]);

  return (
    <div className="canvas-wrapper">
      <div className="canvas-controls">
        <button onClick={undo} disabled={currentHistoryIndex <= 0 || isProcessing}>Undo</button>
        <button onClick={redo} disabled={currentHistoryIndex >= history.length - 1 || isProcessing}>Redo</button>
        <button onClick={reset} disabled={isProcessing}>Reset</button>
      </div>
      <div className="canvas-content">
        <div className="canvas-area">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseLeave={clearHover}
            style={{
              maxWidth: '100%',
              height: 'auto',
              cursor: isProcessing ? 'wait' : 'pointer',
              border: '1px solid #ccc'
            }}
          />
          {isProcessing && (
            <div className="processing-overlay">
              <div className="spinner" />
              <span>{status}</span>
            </div>
          )}
        </div>
        <div className="sidebar">
          <button className="add-group" onClick={addGroup}>Add Group</button>
          {groups.map(g => (
            <div key={g.id} className="group-section">
              <div className="group-header">
                <span>{g.name}</span>
                <ColorPicker
                  value={g.color}
                  onChange={c => previewGroupColor(g.id, c)}
                  onChangeComplete={c => commitGroupColor(g.id, c)}
                />
              </div>
              <ul className="group-surfaces">
                {walls.filter(w => w.groupId === g.id).map(w => (
                  <li key={w.id}>
                    <label>
                      <input type="checkbox" checked={w.enabled} onChange={() => toggleWall(w.id)} /> {w.id}
                    </label>
                    <button onClick={() => assignWallToGroup(w.id, null)}>Remove</button>
                  </li>
                ))}
                <li>
                  <select onChange={e => { const wid = e.target.value; if (wid) { assignWallToGroup(wid, g.id); e.target.value=''; } }}>
                    <option value="">Add surface...</option>
                    {walls.filter(w => w.groupId !== g.id).map(w => (
                      <option key={w.id} value={w.id}>{w.id}</option>
                    ))}
                  </select>
                </li>
              </ul>
            </div>
          ))}
          {walls.filter(w => !w.groupId).length > 0 && (
            <div className="group-section">
              <div className="group-header"><span>Other</span></div>
              <ul className="group-surfaces">
                {walls.filter(w => !w.groupId).map(w => (
                  <li key={w.id}>
                    <label>
                      <input type="checkbox" checked={w.enabled} onChange={() => toggleWall(w.id)} /> {w.id}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
