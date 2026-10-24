'use strict';

/**
 * Profile definitions and storage, shared by the shell extension and the
 * preferences window.
 *
 * A profile is `{ id, name, factor, brightness, contrast, tint }`: `factor` is
 * desaturation (0-1), `brightness` and `contrast` are signed, and `tint` is an
 * RGB colour with `a` as intensity, or null.
 */

// Near the extremes brightness/contrast crush the screen to solid black or
// white, leaving nothing visible to correct, so the user could not undo a
// change. Brightness shifts every pixel equally and blanks the screen much
// sooner than contrast does, hence its tighter cap.
export const BRIGHTNESS_LIMIT = 0.6;
export const CONTRAST_LIMIT = 0.9;

// Tint intensity is a blend factor out of 255. At the top it replaces the
// screen with a flat colour, so it is capped well short of that.
export const TINT_INTENSITY_LIMIT = 150;

// Only a starting point: once saved, these are ordinary profiles that can be
// edited or deleted like any other.
export const DEFAULT_PROFILES = [
    { id: 'grayscale', name: 'Grayscale', factor: 1.0 },
    { id: 'soft', name: 'Soft', factor: 0.7 },
];

const cloneDefaultProfiles = () => DEFAULT_PROFILES.map(profile => ({ ...profile }));

const parseProfiles = json => {
    const parsed = JSON.parse(json);
    return parsed.filter(profile => profile.id && profile.name);
};

/**
 * An empty `profiles` key means the user has never saved, so the defaults are
 * returned. That is deliberately different from an empty list ('[]'), which
 * means the user deleted everything and must not get the defaults back.
 */
export function loadProfiles(settings) {
    const stored = settings.get_string('profiles');
    if (stored === '')
        return cloneDefaultProfiles();

    try {
        return parseProfiles(stored);
    } catch (e) {
        console.error('Chroma: Bad profile data', e);
        return cloneDefaultProfiles();
    }
}

export function saveProfiles(settings, profiles) {
    settings.set_string('profiles', JSON.stringify(profiles));
}
