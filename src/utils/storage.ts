export interface Settings {
  sound: boolean;
  music: boolean;
}

export interface PlayerProfile {
  username: string;
  bestScore: number;
  bestDistance: number;
}

const DEFAULT_SETTINGS: Settings = { sound: true, music: true };
const DEFAULT_PROFILE: PlayerProfile = { username: '', bestScore: 0, bestDistance: 0 };

/**
 * Run records for the current page only.
 *
 * Nothing is written to localStorage, sessionStorage, cookies or IndexedDB, so
 * the best score, best distance and callsign live in these two variables and
 * are discarded the moment the tab is closed or refreshed. There is no
 * device-side residue, which also means there is nothing to expire or clear.
 *
 * The previous implementation parsed and re-validated JSON on every load
 * because stored data is untrusted. That reasoning no longer applies: the only
 * writer is this module, and the callsign is validated by `normaliseUsername`
 * before it arrives. Reads therefore hand back copies so callers cannot mutate
 * the live state by accident.
 */
let settings: Settings = { ...DEFAULT_SETTINGS };
let profile: PlayerProfile = { ...DEFAULT_PROFILE };

export const storage = {
  loadSettings(): Settings {
    return { ...settings };
  },

  saveSettings(next: Settings): void {
    settings = { ...next };
  },

  loadProfile(): PlayerProfile {
    return { ...profile };
  },

  saveProfile(next: PlayerProfile): void {
    profile = { ...next };
  },

  /** Resets this session's run records, keeping the chosen callsign. */
  clearBestScore(): PlayerProfile {
    profile = { ...DEFAULT_PROFILE, username: profile.username };
    return { ...profile };
  },
};
