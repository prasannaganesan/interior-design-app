
export interface WhiteBalance {
  r: number;
  g: number;
  b: number;
}

interface WhiteBalanceControlsProps {
  value: WhiteBalance;
  onChange: (wb: WhiteBalance) => void;
  onAuto: () => void;
}

export default function WhiteBalanceControls({ value, onChange, onAuto }: WhiteBalanceControlsProps) {
  const handleChange = (channel: 'r' | 'g' | 'b', newVal: number) => {
    onChange({ ...value, [channel]: newVal });
  };

  return (
    <div className="white-balance-controls">
      <div className="wb-slider">
        <label>Red</label>
        <input
          type="range"
          min="0.5"
          max="1.5"
          step="0.01"
          value={value.r}
          onChange={(e) => handleChange('r', Number(e.target.value))}
        />
        <span>{value.r.toFixed(2)}</span>
      </div>
      <div className="wb-slider">
        <label>Green</label>
        <input
          type="range"
          min="0.5"
          max="1.5"
          step="0.01"
          value={value.g}
          onChange={(e) => handleChange('g', Number(e.target.value))}
        />
        <span>{value.g.toFixed(2)}</span>
      </div>
      <div className="wb-slider">
        <label>Blue</label>
        <input
          type="range"
          min="0.5"
          max="1.5"
          step="0.01"
          value={value.b}
          onChange={(e) => handleChange('b', Number(e.target.value))}
        />
        <span>{value.b.toFixed(2)}</span>
      </div>
      <button onClick={onAuto}>Auto</button>
    </div>
  );
}
