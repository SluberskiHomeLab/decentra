import React, { useState, useEffect } from 'react';
import SoundboardUpload from './SoundboardUpload';

interface Sound {
  sound_id: string;
  name: string;
  duration_ms: number;
  file_size: number;
  created_at: string;
  uploader?: string;
}

interface SoundboardPanelProps {
  isOpen: boolean;
  onClose: () => void;
  serverId?: string | null;
  isServerAdmin: boolean;
  onPlaySound: (soundId: string, soundName: string) => void;
  sendWebSocketMessage: (message: any) => void;
}

const SoundboardPanel: React.FC<SoundboardPanelProps> = ({
  isOpen,
  onClose,
  serverId,
  isServerAdmin,
  onPlaySound,
  sendWebSocketMessage,
}) => {
  const [activeTab, setActiveTab] = useState<'personal' | 'server'>('personal');
  const [personalSounds, setPersonalSounds] = useState<Sound[]>([]);
  const [serverSounds, setServerSounds] = useState<Sound[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [adminSettings, setAdminSettings] = useState<any>(null);

  useEffect(() => {
    if (isOpen) {
      loadSounds();
      loadAdminSettings();
    }
  }, [isOpen, serverId]);

  const loadAdminSettings = async () => {
    try {
      const response = await fetch(`/api/admin-settings?token=${localStorage.getItem('token')}`);
      if (response.ok) {
        const data = await response.json();
        setAdminSettings(data);
      }
    } catch (err) {
      console.error('Failed to load admin settings:', err);
    }
  };

  const loadSounds = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      
      // Load personal sounds
      const personalResponse = await fetch(`/api/soundboard-sounds?type=user&token=${token}`);
      if (personalResponse.ok) {
        const personalData = await personalResponse.json();
        setPersonalSounds(personalData.sounds || []);
      }

      // Load server sounds if in a server
      if (serverId) {
        const serverResponse = await fetch(`/api/soundboard-sounds?type=server&server_id=${serverId}&token=${token}`);
        if (serverResponse.ok) {
          const serverData = await serverResponse.json();
          setServerSounds(serverData.sounds || []);
        }
      }
    } catch (err) {
      console.error('Failed to load sounds:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePlaySound = (sound: Sound) => {
    // Send websocket message to play sound
    sendWebSocketMessage({
      type: 'play_soundboard',
      sound_id: sound.sound_id,
    });

    // Also trigger local playback via callback
    onPlaySound(sound.sound_id, sound.name);
  };

  const handleDeleteSound = async (soundId: string) => {
    if (!confirm('Are you sure you want to delete this sound?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/delete-soundboard-sound/${soundId}?token=${token}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        loadSounds(); // Reload sounds
      } else {
        const result = await response.json();
        alert(result.error || 'Failed to delete sound');
      }
    } catch (err) {
      alert('Network error. Please try again.');
    }
  };

  const formatDuration = (durationMs: number): string => {
    const seconds = durationMs / 1000;
    return `${seconds.toFixed(1)}s`;
  };

  const getCurrentSounds = () => {
    return activeTab === 'personal' ? personalSounds : serverSounds;
  };

  const getCurrentCount = () => {
    return activeTab === 'personal' ? personalSounds.length : serverSounds.length;
  };

  const getMaxCount = () => {
    if (!adminSettings) return 10;
    return activeTab === 'personal' 
      ? adminSettings.max_sounds_per_user || 10
      : adminSettings.max_server_sounds || 25;
  };

  const getMaxDuration = () => {
    return adminSettings?.max_sound_duration_seconds || 10;
  };

  if (!isOpen) {
    return null;
  }

  const currentSounds = getCurrentSounds();

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
        <div className="bg-bg-secondary rounded-lg p-6 w-full max-w-2xl max-h-[80vh] flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-text-primary">Soundboard</h2>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary text-xl"
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('personal')}
              className={`px-4 py-2 rounded ${
                activeTab === 'personal'
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary/70'
              }`}
            >
              Personal ({personalSounds.length})
            </button>
            {serverId && (
              <button
                onClick={() => setActiveTab('server')}
                className={`px-4 py-2 rounded ${
                  activeTab === 'server'
                    ? 'bg-accent-primary text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary/70'
                }`}
              >
                Server ({serverSounds.length})
              </button>
            )}
          </div>

          {/* Sound Grid */}
          <div className="flex-1 overflow-y-auto mb-4">
            {loading ? (
              <div className="text-center text-text-muted py-8">Loading sounds...</div>
            ) : currentSounds.length === 0 ? (
              <div className="text-center text-text-muted py-8">
                <p className="mb-2">No sounds yet.</p>
                <p className="text-sm">Upload your first soundboard sound!</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {currentSounds.map((sound) => (
                  <div
                    key={sound.sound_id}
                    className="bg-bg-tertiary rounded-lg p-3 hover:bg-bg-tertiary/70 transition group relative"
                  >
                    <button
                      onClick={() => handlePlaySound(sound)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-2xl">🔊</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-text-primary truncate">
                            {sound.name}
                          </div>
                          <div className="text-xs text-text-muted">
                            {formatDuration(sound.duration_ms)}
                          </div>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleDeleteSound(sound.sound_id)}
                      className="absolute top-2 right-2 text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition"
                      title="Delete sound"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upload Button */}
          <div className="flex gap-2">
            <button
              onClick={() => setUploadModalOpen(true)}
              disabled={
                (activeTab === 'server' && !isServerAdmin) ||
                (getCurrentCount() >= getMaxCount() && getMaxCount() !== -1)
              }
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-bg-tertiary disabled:cursor-not-allowed"
            >
              {activeTab === 'server' && !isServerAdmin
                ? 'Admin Only'
                : getCurrentCount() >= getMaxCount() && getMaxCount() !== -1
                ? 'Limit Reached'
                : '+ Upload Sound'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-bg-tertiary text-text-primary rounded hover:bg-bg-tertiary/70"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Upload Modal */}
      <SoundboardUpload
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onUploadSuccess={loadSounds}
        isServerSound={activeTab === 'server'}
        serverId={serverId || undefined}
        currentCount={getCurrentCount()}
        maxCount={getMaxCount()}
        maxDurationSeconds={getMaxDuration()}
      />
    </>
  );
};

export default SoundboardPanel;
