interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onChangeEnd?: () => void;
  color?: string;
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  onChangeEnd,
  color = '#9B8EC4',
}: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="relative h-6 flex items-center">
      <div className="absolute w-full h-2 bg-terminal-border rounded-full" />
      <div
        className="absolute h-2 rounded-full"
        style={{ width: `${percentage}%`, backgroundColor: color }}
      />
      <div
        className="absolute w-4 h-4 rounded-full border-2 border-terminal-bg"
        style={{
          left: `calc(${percentage}% - 8px)`,
          backgroundColor: color,
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={() => onChangeEnd?.()}
        onKeyUp={() => onChangeEnd?.()}
        className="absolute w-full h-6 opacity-0 cursor-pointer"
      />
    </div>
  );
}
