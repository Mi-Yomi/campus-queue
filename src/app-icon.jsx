import React from "react";

// Decorative artwork always accompanies a visible text label.
export function AppIcon({ name, className = "" }) {
  return <img className={`app-icon ${className}`} src={`${import.meta.env.BASE_URL}media/icons/${name}.webp`}
    width="48" height="48" alt="" aria-hidden="true" decoding="async" />;
}
