export const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? '') || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
export const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
export const isStandalone = typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches;
export const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const hasOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';
/** Kısayol etiketleri: Apple'da ⌘, diğerlerinde Ctrl. */
export const MOD = isApple ? '⌘' : 'Ctrl';
export const ALT = isApple ? '⌥' : 'Alt';
export const SHIFT = '⇧';
/** Dar/dokunmatik düzen eşiği (iPad dikey ve telefonlar). */
export const compactQuery = '(max-width: 1100px)';
