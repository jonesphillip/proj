interface TimeRulerProps {
  duration: number;
  pixelsPerSecond: number;
}

export function TimeRuler({ duration, pixelsPerSecond }: TimeRulerProps) {
  // Calculate tick interval based on zoom level
  let majorInterval = 5; // seconds
  let minorInterval = 1;

  if (pixelsPerSecond > 100) {
    majorInterval = 1;
    minorInterval = 0.5;
  } else if (pixelsPerSecond > 50) {
    majorInterval = 2;
    minorInterval = 0.5;
  } else if (pixelsPerSecond < 30) {
    majorInterval = 10;
    minorInterval = 2;
  }

  const ticks: { time: number; major: boolean }[] = [];

  for (let t = 0; t <= duration; t += minorInterval) {
    const isMajor = Math.abs(t % majorInterval) < 0.001 || Math.abs(t % majorInterval - majorInterval) < 0.001;
    ticks.push({ time: t, major: isMajor });
  }

  return (
    <div className="h-7 bg-terminal-bg border-b border-terminal-border relative">
      {ticks.map(({ time, major }) => (
        <div
          key={time}
          className="absolute top-0"
          style={{ left: time * pixelsPerSecond }}
        >
          <div
            className={`w-px ${major ? 'h-4 bg-terminal-muted' : 'h-2 bg-terminal-border'}`}
          />
          {major && (
            <span className="absolute top-4 left-1 text-xs text-terminal-muted whitespace-nowrap">
              {formatTime(time)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  return `${secs}s`;
}
