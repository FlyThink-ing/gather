import { RefObject, useCallback, useLayoutEffect, useState } from 'react';

interface FloatingPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * Positions a popup in the viewport instead of inside its (possibly scrolling)
 * parent. This keeps menus opened from modals from being clipped by the modal.
 */
export function useFloatingLayer(
  open: boolean,
  anchorRef: RefObject<HTMLElement>,
  floatingRef: RefObject<HTMLElement>,
  preferredMaxHeight: number,
) {
  const [position, setPosition] = useState<FloatingPosition | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;

    const gap = 6;
    const edge = 8;
    const rect = anchor.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const menuHeight = Math.min(floating.getBoundingClientRect().height || preferredMaxHeight, preferredMaxHeight);
    const spaceBelow = viewportHeight - rect.bottom - gap - edge;
    const spaceAbove = rect.top - gap - edge;
    const openAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const availableHeight = Math.max(0, openAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(preferredMaxHeight, availableHeight);
    const width = Math.min(rect.width, viewportWidth - edge * 2);

    setPosition({
      top: openAbove
        ? Math.max(edge, rect.top - gap - Math.min(menuHeight, maxHeight))
        : Math.min(rect.bottom + gap, viewportHeight - edge - maxHeight),
      left: Math.max(edge, Math.min(rect.left, viewportWidth - edge - width)),
      width,
      maxHeight,
    });
  }, [anchorRef, floatingRef, preferredMaxHeight]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    updatePosition();
    const frame = requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    const observer = new ResizeObserver(updatePosition);
    if (anchorRef.current) observer.observe(anchorRef.current);
    if (floatingRef.current) observer.observe(floatingRef.current);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      observer.disconnect();
    };
  }, [anchorRef, floatingRef, open, updatePosition]);

  return position;
}
