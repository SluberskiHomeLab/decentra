import React, { useState, useRef } from 'react';

interface SoundboardUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
  isServerSound: boolean;
  serverId?: string;
  currentCount: number;
  maxCount: number;
  maxDurationSeconds: number;
}

const SoundboardUpload: React.FC<SoundboardUploadProps> = ({
  isOpen,
  onClose,
  onUploadSuccess,
  isServerSound,
  serverId,
  currentCount,
  maxCount,
  maxDurationSeconds,
}) => {
  const [soundName, setSoundName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [audioPreview, setAudioPreview] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    // Validate file type
    const validTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/wave', 'audio/x-wav'];
    if (!validTypes.includes(file.type)) {
      setError('Invalid file type. Please select an MP3, WAV, or OGG file.');
      return;
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      setError('File size exceeds 2MB limit.');
      return;
    }

    setSelectedFile(file);
    setError('');

    // Create audio preview and get duration
    const reader = new FileReader();
    reader.onload = () => {
      const audioUrl = reader.result as string;
      setAudioPreview(audioUrl);

      // Get audio duration
      const audio = new Audio(audioUrl);
      audio.addEventListener('loadedmetadata', () => {
        setAudioDuration(audio.duration);
      });
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!soundName.trim()) {
      setError('Please enter a name for the sound.');
      return;
    }

    if (soundName.length > 30) {
      setError('Sound name must be 30 characters or less.');
      return;
    }

    if (!/^[a-zA-Z0-9\s\-_]+$/.test(soundName)) {
      setError('Sound name can only contain letters, numbers, spaces, hyphens, and underscores.');
      return;
    }

    if (!selectedFile) {
      setError('Please select an audio file.');
      return;
    }

    if (audioDuration > maxDurationSeconds) {
      setError(`Sound duration (${audioDuration.toFixed(1)}s) exceeds maximum of ${maxDurationSeconds}s.`);
      return;
    }

    if (currentCount >= maxCount && maxCount !== -1) {
      setError(`You have reached the maximum of ${maxCount} sounds.`);
      return;
    }

    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('sound_name', soundName.trim());
      formData.append('is_server_sound', isServerSound.toString());
      if (isServerSound && serverId) {
        formData.append('server_id', serverId);
      }
      
      const token = localStorage.getItem('token');
      if (token) {
        formData.append('token', token);
      }

      const response = await fetch('/api/upload-soundboard-sound', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        // Reset form
        setSoundName('');
        setSelectedFile(null);
        setAudioPreview(null);
        setAudioDuration(0);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }

        onUploadSuccess();
        onClose();
      } else {
        setError(result.error || 'Failed to upload sound');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">
            Upload {isServerSound ? 'Server' : 'Personal'} Sound
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-400 mb-2">
            {currentCount} / {maxCount === -1 ? '∞' : maxCount} sounds used
          </p>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Sound Name
          </label>
          <input
            type="text"
            value={soundName}
            onChange={(e) => setSoundName(e.target.value)}
            placeholder="Enter sound name (max 30 chars)"
            maxLength={30}
            className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Audio File (.mp3, .wav, .ogg)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
            onChange={handleFileSelect}
            className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
          />
          <p className="text-xs text-gray-500 mt-1">
            Max file size: 2MB • Max duration: {maxDurationSeconds}s
          </p>
        </div>

        {audioPreview && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Preview
            </label>
            <audio controls src={audioPreview} className="w-full" />
            <p className="text-xs text-gray-400 mt-1">
              Duration: {audioDuration.toFixed(1)}s
            </p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-900 bg-opacity-50 border border-red-600 rounded text-red-200 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleUpload}
            disabled={uploading || !selectedFile || !soundName.trim()}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            {uploading ? 'Uploading...' : 'Upload Sound'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default SoundboardUpload;
