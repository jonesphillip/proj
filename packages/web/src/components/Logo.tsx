interface LogoProps {
  size?: 'sm' | 'lg';
}

export function Logo({ size = 'sm' }: LogoProps) {
  const isLg = size === 'lg';
  const fontSize = isLg ? 'text-4xl' : 'text-sm';
  const lineH = isLg ? 'h-[2.5px]' : 'h-[1.5px]';

  return (
    <span className={`relative inline-block font-mono font-bold select-none cursor-default ${fontSize}`}>
      <span className="text-accent-primary">p</span>
      <span className="text-terminal-text">ro</span>
      <span className="text-accent-primary">j</span>
      <span
        className={`absolute left-[-2%] w-[104%] bg-accent-primary ${lineH}`}
        style={{ top: '15%', transform: 'rotate(-7deg)' }}
      />
    </span>
  );
}
