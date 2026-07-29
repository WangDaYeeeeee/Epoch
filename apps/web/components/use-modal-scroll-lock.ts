"use client";

import { useEffect } from "react";

let activeLocks = 0;
let previousOverflow = "";
let previousPaddingRight = "";

export function useModalScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    if (activeLocks === 0) {
      previousOverflow = document.body.style.overflow;
      previousPaddingRight = document.body.style.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = "hidden";
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    activeLocks += 1;

    return () => {
      activeLocks = Math.max(0, activeLocks - 1);
      if (activeLocks === 0) {
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPaddingRight;
      }
    };
  }, [active]);
}
