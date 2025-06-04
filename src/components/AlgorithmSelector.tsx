interface AlgorithmSelectorProps {
  value: string;
  onChange: (mode: string) => void;
  className?: string;
}

export const ALGORITHMS = {
  retinex: 'Retinex',
  intrinsic: 'Intrinsic (beta)'
};

export default function AlgorithmSelector({ value, onChange, className }: AlgorithmSelectorProps) {
  return (
    <div className={`algorithm-selector ${className ?? ''}`.trim()}>
      <h2>Recolor Method</h2>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {Object.entries(ALGORITHMS).map(([k, label]) => (
          <option key={k} value={k}>{label}</option>
        ))}
      </select>
    </div>
  );
}
