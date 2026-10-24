'use strict';

/**
 * Built-in profiles, shared by the shell extension and the preferences window.
 *
 * `factor` is desaturation (0-1), `brightness` and `contrast` are -1 to 1,
 * and `tint` is an RGB colour with `a` as intensity (0-255).
 */

export const DEFAULT_PROFILES = {
    'grayscale': { name: 'Grayscale', factor: 1.0, type: 'preset' },
    'soft': { name: 'Soft', factor: 0.7, type: 'preset' },
    'high-contrast': { name: 'High Contrast', factor: 1.0, brightness: 0.1, contrast: 0.2, type: 'preset' },
    'low-brightness': { name: 'Low Brightness', factor: 1.0, brightness: -0.2, type: 'preset' },
    'sepia': { name: 'Sepia', factor: 0.8, tint: { r: 255, g: 220, b: 180, a: 40 }, type: 'preset' }
};

// Near the extremes brightness/contrast crush the screen to solid black or
// white, leaving nothing visible to correct, so the user could not undo a
// change. Brightness shifts every pixel equally and blanks the screen much
// sooner than contrast does, hence its tighter cap.
export const BRIGHTNESS_LIMIT = 0.6;
export const CONTRAST_LIMIT = 0.9;

// Tint intensity is a blend factor out of 255. At the top it replaces the
// screen with a flat colour, so it is capped well short of that.
export const TINT_INTENSITY_LIMIT = 150;
