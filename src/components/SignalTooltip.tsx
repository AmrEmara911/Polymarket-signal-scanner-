'use client';

import React, { useEffect, useId, useRef, useState } from 'react';

interface SignalTooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  className?: string;
}

export function SignalTooltip({ children, content, className = 'inline-flex' }: SignalTooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
    };
  }, []);

  const clearOpenTimer = () => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };

  const showTooltip = () => {
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        left: Math.min(window.innerWidth - 148, Math.max(148, rect.left + rect.width / 2)),
        top: rect.top - 8,
      });
      setOpen(true);
    }, 150);
  };

  const hideTooltip = () => {
    clearOpenTimer();
    setOpen(false);
  };

  return (
    <span
      ref={triggerRef}
      tabIndex={0}
      aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      className={className}
    >
      {children}
      <span
        id={tooltipId}
        role="tooltip"
        style={{ left: position.left, top: position.top }}
        className={`pointer-events-none fixed z-50 max-w-[280px] -translate-x-1/2 -translate-y-full rounded-md border border-[#2a3142] bg-[#1a1f2e] p-3 text-left text-white shadow-lg transition-opacity duration-200 ${
          open ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        {content}
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-[#2a3142] bg-[#1a1f2e]"
        />
      </span>
    </span>
  );
}

export function AheadOfCurveTooltipContent() {
  return (
    <>
      <span className="block font-bold text-white">⚡ Ahead of Curve</span>
      <span className="mt-3 block text-sm font-semibold text-[#9ca3af]">
        Three criteria must all be true:
      </span>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-[#9ca3af]">
        <li>Probability in contested range (25–75%)</li>
        <li>Volume above $50K (credible market)</li>
        <li>Moved more than 15pp in last 24 hours</li>
      </ul>
      <span className="mt-3 block text-sm font-normal leading-relaxed text-white">
        <span className="font-semibold">Why it matters:</span> the market is updating its view but consensus hasn&apos;t formed yet. This is the window to act before the stock price reflects the outcome — which matches BIT Capital&apos;s &apos;act before consensus&apos; investment thesis.
      </span>
    </>
  );
}

export function Delta24HTooltipContent() {
  return (
    <span className="block text-sm font-normal leading-relaxed text-white">
      Δ 24H = Probability change over the last 24 hours, measured in percentage points (pp). Example: a market that moved from 40% to 44% shows +4pp. This is the absolute movement, not a relative percentage change.
    </span>
  );
}
