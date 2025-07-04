import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UndoIcon, RedoIcon, ResetIcon } from './Icons';
import { SAM2 } from '../lib/sam';
import { AVAILABLE_MODELS, getModelFiles } from '../lib/sam/model-loader';
import {
  srgbToLinear,
  linearRgbToLab,
  boxBlurFloat
} from '../lib/color';
import { NIIDNet, applyReflectanceColor } from '../lib/intrinsic';

import {
  applyWhiteBalance,
  applyLighting,
  scaleImageData,
  maskToIndices,
  applyRetinexRecolor
} from '../lib/imageUtils';

import GroupsSidebar from './GroupsSidebar';
import type { WallGroup, WallSurface } from '../types/wall';

import { type WhiteBalance } from './WhiteBalanceControls';


interface ImageCanvasProps {
  imageUrl: string;
  selectedColor: string;
  whiteBalance: WhiteBalance;
  lighting: string;
  algorithm: string;
  sidebarContainer?: HTMLElement | null;
}

interface HistoryState {
  imageData: ImageData;
  timestamp: number;
}





export default function ImageCanvas({ imageUrl, selectedColor, whiteBalance, lighting, algorithm, sidebarContainer }: ImageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rawImageData, setRawImageData] = useState<ImageData | null>(null);
  const [originalImageData, setOriginalImageData] = useState<ImageData | null>(null);
  const [baseImageData, setBaseImageData] = useState<ImageData | null>(null);
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [sam, setSam] = useState<SAM2 | null>(null);
  const [niid, setNiid] = useState<NIIDNet | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>('');
  const trimmedStatus = status.trim();
  const showSpinner =
    isProcessing ||
    (trimmedStatus.endsWith('...') &&
      trimmedStatus !== 'Processing decoder output...');
  const [walls, setWalls] = useState<WallSurface[]>([]);
  const [groups, setGroups] = useState<WallGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const surfaceCounter = useRef(1);

  const retinexRef = useRef<{
    L: Float32Array;
    A: Float32Array;
    B: Float32Array;
    gray: Float32Array;
    shade: Float32Array;
  } | null>(null);

  const intrinsicRef = useRef<{
    R: Float32Array;
    S: Float32Array;
    E: Float32Array;
  } | null>(null);

  // Radius used for the Retinex illumination estimate. A smaller
  // radius reduces over-blurring which previously caused the wall's
  // mean lightness to become unrealistically small and led to washed
  // out recoloring.
  const RETINEX_BLUR_RADIUS = 15;

  useEffect(() => {
    if (algorithm !== 'intrinsic') return;
    async function initNIID() {
      try {
        setIsProcessing(true);
        setStatus('Loading NIID-Net...');
        const modelUrl = '/models/niid-net-lite.onnx';
        const n = new NIIDNet(modelUrl);
        await n.initialize();
        setNiid(n);
        setStatus('NIID-Net loaded');
      } catch (err) {
        console.error('Failed to load NIID-Net', err);
        setStatus('Failed to load NIID-Net');
      } finally {
        setTimeout(() => setIsProcessing(false), 500);
      }
    }
    initNIID();
  }, [algorithm]);

  // Initialize SAM2
  useEffect(() => {
    async function initSAM() {
      try {
        setIsProcessing(true);
        setStatus('Initializing SAM2...');
        // Start with tiny model for faster loading
        const modelInfo = AVAILABLE_MODELS[0];
        const { encoderPath, decoderPath } = await getModelFiles(modelInfo, setStatus);

        const samInstance = new SAM2({
          encoderPath,
          decoderPath,
          modelSize: modelInfo.size,
          onStatus: setStatus
        });

        await samInstance.initialize();
        setSam(samInstance);
      } catch (error) {
        console.error('Failed to initialize SAM2:', error);
        setStatus('Failed to initialize SAM2');
      } finally {
        // Wait a bit to allow the WASM runtime to finish any remaining work
        // before removing the processing overlay so the UI remains responsive.
        setTimeout(() => setIsProcessing(false), 500);
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

        if (algorithm === 'intrinsic' && niid) {
          setStatus('Running NIID-Net...');
          const result = await niid.decompose(balancedData);
          intrinsicRef.current = {
            R: result.reflectance,
            S: result.shading,
            E: result.specular
          };
        }

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
      setTimeout(() => setIsProcessing(false), 100);
    }
  }
  process();
}, [rawImageData, whiteBalance, sam, algorithm, niid]);

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
    applyLighting(ctx, canvas.width, canvas.height, lighting);
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
    if (base) {
      ctx.putImageData(base, 0, 0);
      applyLighting(ctx, canvas.width, canvas.height, lighting);
    }
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
      let historyImage: ImageData | undefined;
      if (baseImageData) {
        const updated = new ImageData(
          new Uint8ClampedArray(baseImageData.data),
          baseImageData.width,
          baseImageData.height
        );
        if (algorithm === 'intrinsic' && intrinsicRef.current) {
          applyReflectanceColor(
            updated,
            {
              R: intrinsicRef.current.R,
              S: intrinsicRef.current.S,
              E: intrinsicRef.current.E
            },
            indices,
            selectedColor
          );
        } else if (retinexRef.current) {
          applyRetinexRecolor(updated, indices, selectedColor, retinexRef.current);
        }
        setBaseImageData(updated);
        ctx.putImageData(updated, 0, 0);
        applyLighting(ctx, canvas.width, canvas.height, lighting);
        historyImage = updated;
      }

        const newWall: WallSurface = {
          id: `Surface ${surfaceCounter.current++}`,
          pixels: indices,
          color: selectedColor,
          enabled: true,
          groupId: null
        };
      setWalls([...walls, newWall]);

      // Save to history
      saveToHistory(historyImage);
      setStatus('Ready');
    } catch (error) {
      console.error('Failed to generate/apply mask:', error);
      setStatus('Failed to generate mask');
    } finally {
      setTimeout(() => setIsProcessing(false), 100);
    }
  };


  const recolorWall = (wall: WallSurface, newColor: string) => {
    if (!baseImageData) return;
    const updated = new ImageData(
      new Uint8ClampedArray(baseImageData.data),
      baseImageData.width,
      baseImageData.height
    );
    if (algorithm === 'intrinsic' && intrinsicRef.current) {
      applyReflectanceColor(
        updated,
        intrinsicRef.current,
        wall.pixels,
        newColor
      );
    } else if (retinexRef.current) {
      applyRetinexRecolor(updated, wall.pixels, newColor, retinexRef.current);
    }
    setBaseImageData(updated);
    wall.color = newColor;
    setWalls(walls.map(w => (w.id === wall.id ? wall : w)));
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(updated, 0, 0);
        applyLighting(ctx, canvas.width, canvas.height, lighting);
      }
    }
    saveToHistory(updated);
  };

  const reapplyWalls = (wallList: WallSurface[] = walls): ImageData | null => {
    const canvas = canvasRef.current;
    if (!canvas || !originalImageData) return null;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const base = new ImageData(
      new Uint8ClampedArray(originalImageData.data),
      originalImageData.width,
      originalImageData.height
    );
    for (const wall of wallList) {
      if (!wall.enabled) continue;
      if (algorithm === 'intrinsic' && intrinsicRef.current) {
        applyReflectanceColor(
          base,
          intrinsicRef.current,
          wall.pixels,
          wall.color
        );
      } else if (retinexRef.current) {
        applyRetinexRecolor(base, wall.pixels, wall.color, retinexRef.current);
      }
    }
    setBaseImageData(base);
    ctx.putImageData(base, 0, 0);
    applyLighting(ctx, canvas.width, canvas.height, lighting);
    return base;
  };

  const saveToHistory = (img?: ImageData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const source = img ?? baseImageData;
    const currentImageData = source
      ? new ImageData(new Uint8ClampedArray(source.data), source.width, source.height)
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
    const base = reapplyWalls(updated);
    saveToHistory(base ?? undefined);
  };

  const removeWall = (wallId: string) => {
    const updated = walls.filter(w => w.id !== wallId);
    setWalls(updated);
    const base = reapplyWalls(updated);
    saveToHistory(base ?? undefined);
  };

  const addGroup = () => {
    const name = newGroupName.trim();
    if (!name || groups.some(g => g.name === name)) return;
    const id = `group-${Date.now()}`;
    const groupColor = selectedColor;
    const group: WallGroup = { id, name, color: groupColor };
    setGroups([...groups, group]);
    setEditingNames(prev => ({ ...prev, [id]: name }));
    setNewGroupName('');
  };

  const handleGroupNameChange = (groupId: string, name: string) => {
    setEditingNames(prev => ({ ...prev, [groupId]: name }));
  };

  const commitGroupName = (groupId: string) => {
    const name = (editingNames[groupId] ?? '').trim();
    const current = groups.find(g => g.id === groupId);
    if (!current) return;
    if (!name || groups.some(g => g.name === name && g.id !== groupId)) {
      setEditingNames(prev => ({ ...prev, [groupId]: current.name }));
      return;
    }
    if (name !== current.name) {
      setGroups(groups.map(g => g.id === groupId ? { ...g, name } : g));
    }
    setEditingGroupId(null);
  };

  const assignWallToGroup = (wallId: string, groupId: string | null) => {
    const wall = walls.find(w => w.id === wallId);
    if (!wall) return;

    const newColor = groupId
      ? groups.find(g => g.id === groupId)?.color || wall.color
      : wall.color;
    const updatedWall = { ...wall, groupId, color: newColor, enabled: true };

    if (wall.enabled && newColor === wall.color) {
      setWalls(walls.map(w => (w.id === wallId ? updatedWall : w)));
      saveToHistory();
      return;
    }

    if (wall.enabled) {
      recolorWall(updatedWall, newColor);
    } else {
      const updatedWalls = walls.map(w =>
        w.id === wallId ? updatedWall : w
      );
      setWalls(updatedWalls);
      const base = reapplyWalls(updatedWalls);
      saveToHistory(base ?? undefined);
    }

  };

  const handleDragStart = (
    e: React.DragEvent<HTMLLIElement>,
    wallId: string
  ) => {
    console.log('drag start', { wallId });
    e.dataTransfer.setData('text/plain', wallId);
  };

  const handleDrop = (
    e: React.DragEvent<HTMLElement>,
    groupId: string | null
  ) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    console.log('drop', { id, groupId });
    if (id) assignWallToGroup(id, groupId);
  };

  const allowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    console.log('allow drop');
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
    const base = reapplyWalls(updated);
    saveToHistory(base ?? undefined);
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
    intrinsicRef.current = null;
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
      <div className="canvas-content">
        <div className="canvas-area">
          <div className="canvas-controls">
            <button
              title="Undo"
              onClick={undo}
              disabled={currentHistoryIndex <= 0 || isProcessing}
            >
              <UndoIcon />
            </button>
            <button
              title="Redo"
              onClick={redo}
              disabled={currentHistoryIndex >= history.length - 1 || isProcessing}
            >
              <RedoIcon />
            </button>
            <button title="Reset" onClick={reset} disabled={isProcessing}>
              <ResetIcon />
            </button>
          </div>
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
          {showSpinner && (
            <div className="processing-overlay">
              <div
                className={`spinner${!sam ? ' spinner-large' : ''}`}
              />
              <span>{status}</span>
            </div>
          )}
        </div>
      </div>
      {!isProcessing && status && <div className="status-bar">{status}</div>}
      {sidebarContainer &&
        createPortal(
          <GroupsSidebar
            groups={groups}
            walls={walls}
            newGroupName={newGroupName}
            editingNames={editingNames}
            editingGroupId={editingGroupId}
            setNewGroupName={setNewGroupName}
            setEditingGroupId={setEditingGroupId}
            addGroup={addGroup}
            handleGroupNameChange={handleGroupNameChange}
            commitGroupName={commitGroupName}
            allowDrop={allowDrop}
            handleDrop={handleDrop}
            handleDragStart={handleDragStart}
            toggleWall={toggleWall}
            removeWall={removeWall}
            previewGroupColor={previewGroupColor}
            commitGroupColor={commitGroupColor}
          />,
          sidebarContainer
        )}
    </div>
  );
}
