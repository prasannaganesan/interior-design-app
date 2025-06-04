export interface WallSurface {
  id: string;
  pixels: Uint32Array;
  color: string;
  enabled: boolean;
  groupId: string | null;
}

export interface WallGroup {
  id: string;
  name: string;
  color: string;
}
