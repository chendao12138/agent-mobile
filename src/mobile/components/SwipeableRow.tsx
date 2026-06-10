import { useRef, useState, useCallback, type ReactNode } from 'react';

interface SwipeableRowProps {
  children: ReactNode;
  rightActions?: ReactNode;   // shown on right swipe (revealed at left edge)
  leftActions?: ReactNode;    // shown on left swipe (revealed at right edge)
  onLongPress?: () => void;
  onClick?: () => void;
}

const RIGHT_W = 80;   // px
const LEFT_W = 180;   // px

export default function SwipeableRow({ children, rightActions, leftActions, onLongPress, onClick }: SwipeableRowProps) {
  const [translateX, setTranslateX] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>();
  const hasMoved = useRef(false);

  const maxRight = rightActions ? RIGHT_W : 0;
  const maxLeft = leftActions ? LEFT_W : 0;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0]!.clientX;
    startY.current = e.touches[0]!.clientY;
    tracking.current = true;
    hasMoved.current = false;
    if (onLongPress) {
      longPressTimer.current = setTimeout(() => {
        if (!hasMoved.current) { onLongPress(); tracking.current = false; setTranslateX(0); }
      }, 500);
    }
  }, [onLongPress]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!tracking.current) return;
    const dx = e.touches[0]!.clientX - startX.current;
    const dy = Math.abs(e.touches[0]!.clientY - startY.current);
    if (dy > Math.abs(dx) * 1.5) { tracking.current = false; clearTimeout(longPressTimer.current); return; }
    if (Math.abs(dx) > 5) { hasMoved.current = true; clearTimeout(longPressTimer.current); }
    // dx > 0 = finger moves right → show rightActions
    // dx < 0 = finger moves left → show leftActions
    const newX = Math.max(-maxLeft, Math.min(maxRight, dx));
    setTranslateX(newX);
    e.preventDefault();
  }, [maxLeft, maxRight]);

  const onTouchEnd = useCallback(() => {
    tracking.current = false;
    clearTimeout(longPressTimer.current);
    if (translateX > maxRight * 0.4) setTranslateX(maxRight);
    else if (translateX < -maxLeft * 0.4) setTranslateX(-maxLeft);
    else setTranslateX(0);
  }, [translateX, maxLeft, maxRight]);

  return (
    <div className="overflow-hidden">
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => { if (translateX !== 0) setTranslateX(0); else onClick?.(); }}
        className="flex"
        style={{
          width: `calc(100vw + ${maxRight + maxLeft}px)`,
          marginLeft: -maxRight,
          transform: `translateX(${translateX}px)`,
          transition: tracking.current ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        {/* Right actions (at left edge, revealed on right swipe) */}
        <div style={{ width: maxRight }} className="shrink-0 flex">
          {rightActions && rightActions}
        </div>

        {/* Main content */}
        <div className="shrink-0 bg-slate-850" style={{ width: '100vw' }}>
          {children}
        </div>

        {/* Left actions (at right edge, revealed on left swipe) */}
        <div style={{ width: maxLeft }} className="shrink-0 flex">
          {leftActions && leftActions}
        </div>
      </div>
    </div>
  );
}
