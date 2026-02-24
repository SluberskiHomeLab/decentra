/**
 * Voice quality presets for Decentra voice channels.
 *
 * Applied to both P2P (via RTCRtpSender.setParameters) and SFU
 * (via LiveKit publish options).
 */

/** Named quality presets selectable by the user. */
export type VoiceQualityPreset = 'voice' | 'standard' | 'high' | 'music'

/** Per-preset codec and encoding parameters. */
export interface VoiceQualityConfig {
  /** Target audio bitrate in bits-per-second. */
  bitrate: number
  /** Use stereo encoding (two channels). */
  stereo: boolean
  /** Discontinuous Transmission — silence packets suppressed (saves bandwidth). */
  dtx: boolean
  /** Human-readable label shown in settings UI. */
  label: string
  /** Short description shown below the label. */
  description: string
}

export const VOICE_QUALITY_CONFIGS: Record<VoiceQualityPreset, VoiceQualityConfig> = {
  voice: {
    bitrate: 32_000,
    stereo: false,
    dtx: true,
    label: 'Voice',
    description: '32 kbps mono · optimised for speech, lowest bandwidth',
  },
  standard: {
    bitrate: 64_000,
    stereo: true,
    dtx: true,
    label: 'Standard',
    description: '64 kbps stereo · Discord-equivalent default',
  },
  high: {
    bitrate: 128_000,
    stereo: true,
    dtx: false,
    label: 'High Quality',
    description: '128 kbps stereo · full fidelity voice',
  },
  music: {
    bitrate: 256_000,
    stereo: true,
    dtx: false,
    label: 'Music',
    description: '256 kbps stereo · TeamSpeak music-bot quality',
  },
}

/** Ordered list for UI display. */
export const VOICE_QUALITY_PRESETS_ORDER: VoiceQualityPreset[] = ['voice', 'standard', 'high', 'music']

/** Load the saved preset from localStorage, defaulting to 'standard'. */
export function loadVoiceQualityPreset(): VoiceQualityPreset {
  try {
    const stored = localStorage.getItem('voice_quality_preset') as VoiceQualityPreset | null
    if (stored && stored in VOICE_QUALITY_CONFIGS) return stored
  } catch {
    // localStorage unavailable
  }
  return 'standard'
}

/** Persist the chosen preset to localStorage. */
export function saveVoiceQualityPreset(preset: VoiceQualityPreset): void {
  try {
    localStorage.setItem('voice_quality_preset', preset)
  } catch {
    // localStorage unavailable
  }
}
