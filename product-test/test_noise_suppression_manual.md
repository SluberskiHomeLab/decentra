# Manual Test: Noise Suppression Feature

This document describes how to manually test the noise suppression feature in Decentra's voice chat.

## Prerequisites
- Two browser tabs or two different devices
- Microphone access enabled
- A way to generate background noise (e.g., play music or white noise)

## Test Steps

### 1. Access Voice Settings
1. Log in to Decentra
2. Click the **⚙ menu button** in the bottom left
3. Select **Voice Settings**
4. Verify that you see a "Noise Suppression" dropdown with three options:
   - None
   - Medium
   - High (should be selected by default)

### 2. Test Default Setting (High)
1. Start a voice call or join a voice channel
2. Verify that the voice call connects successfully
3. Play background noise (e.g., music, keyboard typing)
4. Have another user listen to your audio
5. **Expected**: Background noise should be significantly reduced

### 3. Test None Setting
1. While still in the voice call, go to Voice Settings
2. Change "Noise Suppression" to **None**
3. Verify that the audio stream reconnects (you may hear a brief interruption)
4. Play background noise again
5. Have another user listen to your audio
6. **Expected**: Background noise should be audible and not filtered

### 4. Test Medium Setting
1. While still in the voice call, go to Voice Settings
2. Change "Noise Suppression" to **Medium**
3. Verify that the audio stream reconnects
4. Play background noise again
5. Have another user listen to your audio
6. **Expected**: Background noise should be partially reduced (less aggressive than High)

### 5. Test Setting Persistence
1. Change the noise suppression setting to **Medium**
2. Close the Voice Settings modal
3. Refresh the page or log out and log back in
4. Open Voice Settings again
5. **Expected**: The setting should still be **Medium**

### 6. Test Setting Changes Before Call
1. Ensure you're not in an active voice call
2. Open Voice Settings
3. Change noise suppression to **None**
4. Start a new voice call
5. **Expected**: The voice call should start with no noise suppression applied

### 7. Browser Console Verification
1. Open browser Developer Tools (F12)
2. Go to the Console tab
3. Start a voice call
4. **Expected**: You should see a log message like:
   ```
   Requesting microphone access with constraints: {audio: {noiseSuppression: true, echoCancellation: true, autoGainControl: true}, video: false}
   ```
5. Change the noise suppression setting
6. **Expected**: You should see a log message:
   ```
   Noise suppression changed to: [none/medium/high]
   ```

### 8. LocalStorage Verification
1. Open browser Developer Tools (F12)
2. Go to the Application (or Storage) tab
3. Navigate to Local Storage → your Decentra URL
4. Look for the `noiseSuppression` key
5. **Expected**: The value should match your current setting ('none', 'medium', or 'high')

## Expected Behaviors

### Noise Suppression Levels
- **None**: `noiseSuppression: false` - Minimal audio processing, maximum voice clarity but background noise is audible
- **Medium**: `noiseSuppression: { ideal: true }` - Balanced approach, some noise reduction with good voice quality
- **High**: `noiseSuppression: true` - Aggressive noise reduction, best for noisy environments

### Audio Quality Notes
- Echo cancellation and auto gain control remain enabled for all noise suppression levels
- Changing settings during an active call should maintain the muted/unmuted state
- Push-to-talk functionality should work independently of noise suppression settings

## Troubleshooting

If the feature doesn't work as expected:
1. Check browser console for errors
2. Verify microphone permissions are granted
3. Test with a different browser (Chrome, Firefox, Edge)
4. Ensure you're using HTTPS or localhost (required for WebRTC)

## Browser Compatibility

Noise suppression is supported in:
- Chrome/Edge 70+
- Firefox 55+
- Safari 14.1+

Note: Browser support and effectiveness may vary. Some browsers may ignore the noiseSuppression constraint.
