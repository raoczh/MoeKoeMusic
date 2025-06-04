import { ref } from 'vue';
import useAudioEnhancer from './AudioEnhancer';

export default function useAudioController({ onSongEnd, updateCurrentTime }) {
    const audio = new Audio();
    const playing = ref(false);
    const isMuted = ref(false);
    const volume = ref(66);
    const playbackRate = ref(1.0);
    
    // 初始化AI音质增强器
    const audioEnhancer = useAudioEnhancer(audio);
    const { 
        isEnhancerEnabled, 
        enhancementLevel, 
        currentQuality, 
        audioAnalysis,
        toggleEnhancer, 
        setEnhancementLevel, 
        getEnhancerStatus 
    } = audioEnhancer;

    // 初始化音频设置
    const initAudio = () => {
        const savedVolume = localStorage.getItem('player_volume');
        if (savedVolume !== null) volume.value = parseFloat(savedVolume);
        isMuted.value = volume.value === 0;
        audio.volume = volume.value / 100;
        audio.muted = isMuted.value;

        // 初始化播放速度
        const savedSpeed = localStorage.getItem('player_speed');
        if (savedSpeed !== null) {
            playbackRate.value = parseFloat(savedSpeed);
            audio.playbackRate = playbackRate.value;
        }

        audio.addEventListener('ended', onSongEnd);
        audio.addEventListener('pause', handleAudioEvent);
        audio.addEventListener('play', handleAudioEvent);
        audio.addEventListener('timeupdate', updateCurrentTime);
        
        // 音频开始播放时初始化增强器
        audio.addEventListener('play', () => {
            if (isEnhancerEnabled.value) {
                try {
                    // 确保在播放开始时重新初始化增强器，但不切换状态
                    if (!audioEnhancer.enhancerConnected) {
                        console.log('[AudioController] 播放开始，初始化AI音质增强器');
                        audioEnhancer.initializeEnhancer().catch(error => {
                            console.error('[AudioController] 增强器初始化失败:', error);
                        });
                    }
                } catch (error) {
                    console.error('[AudioController] 增强器初始化失败:', error);
                }
            }
        });
        
        // 监听音频源变化
        let lastSrc = '';
        const checkSrcChange = () => {
            if (audio.src !== lastSrc) {
                console.log('[AudioController] 检测到音频源变化:', audio.src);
                lastSrc = audio.src;
                if (audio.src && isEnhancerEnabled.value && !audioEnhancer.enhancerConnected) {
                    // 只在增强器未连接时重新初始化
                    console.log('[AudioController] 音频源变化，需要重新初始化增强器');
                    setTimeout(() => {
                        if (audio.readyState >= 1) { // HAVE_METADATA
                            audioEnhancer.initializeEnhancer().catch(error => {
                                console.error('[AudioController] 音频源变化时增强器初始化失败:', error);
                            });
                        }
                    }, 100); // 给予一些时间让音频元数据加载
                }
            }
        };
        
        // 监听音频错误
        audio.addEventListener('error', (error) => {
            console.error('[AudioController] 音频错误:', error);
            // 出现错误时尝试恢复音频播放
            if (isEnhancerEnabled.value) {
                audioEnhancer.disableEnhancer();
                setTimeout(() => {
                    if (isEnhancerEnabled.value) {
                        audioEnhancer.initializeEnhancer();
                    }
                }, 1000);
            }
        });
        
        // 定期检查音频源变化
        setInterval(checkSrcChange, 1000);
        
        // 监听设置变更事件
        if (typeof window !== 'undefined') {
            window.addEventListener('audio-enhancer-setting-changed', (event) => {
                const { enabled } = event.detail;
                if (enabled !== isEnhancerEnabled.value) {
                    console.log('[AudioController] 响应增强器设置变更:', enabled ? '启用' : '禁用');
                    if (enabled) {
                        audioEnhancer.toggleEnhancer();
                    } else {
                        if (isEnhancerEnabled.value) {
                            audioEnhancer.toggleEnhancer();
                        }
                    }
                }
            });
        }

        console.log('[AudioController] 初始化完成，音量:', audio.volume, 'volume值:', volume.value, '播放速度:', audio.playbackRate, 'AI增强:', isEnhancerEnabled.value);
    };

    // 处理播放/暂停事件
    const handleAudioEvent = (event) => {
        playing.value = event.type === 'play';
        console.log(`[AudioController] ${event.type}事件: playing=${playing.value}`);
        if (typeof window !== 'undefined' && typeof window.electron !== 'undefined') {
            window.electron.ipcRenderer.send('play-pause-action', playing.value, audio.currentTime);
        }
    };

    // 切换播放/暂停
    const togglePlayPause = async () => {
        console.log(`[AudioController] 切换播放状态: playing=${playing.value}, src=${audio.src}`);
        if (playing.value) {
            audio.pause();
            playing.value = false;
        } else {
            try {
                await audio.play();
                playing.value = true;
            } catch (error) {
                console.error('[AudioController] 播放失败:', error);
                return false;
            }
        }
        return true;
    };

    // 切换静音
    const toggleMute = () => {
        isMuted.value = !isMuted.value;
        audio.muted = isMuted.value;
        console.log(`[AudioController] 切换静音: muted=${isMuted.value}`);
        if (isMuted.value) {
            volume.value = 0;
        } else {
            volume.value = audio.volume * 100;
        }
        localStorage.setItem('player_volume', volume.value);
    };

    // 修改音量
    const changeVolume = () => {
        audio.volume = volume.value / 100;
        localStorage.setItem('player_volume', volume.value);
        isMuted.value = volume.value === 0;
        audio.muted = isMuted.value;
        console.log(`[AudioController] 修改音量: volume=${volume.value}, audio.volume=${audio.volume}, muted=${isMuted.value}`);
    };

    // 设置进度
    const setCurrentTime = (time) => {
        audio.currentTime = time;
        console.log(`[AudioController] 设置进度: time=${time}`);
    };

    // 设置播放速度
    const setPlaybackRate = (speed) => {
        playbackRate.value = speed;
        audio.playbackRate = speed;
        localStorage.setItem('player_speed', speed);
        console.log('[AudioController] 设置播放速度:', speed);
    };

    // 销毁时清理
    const destroy = () => {
        console.log('[AudioController] 销毁音频控制器');
        audio.removeEventListener('ended', onSongEnd);
        audio.removeEventListener('pause', handleAudioEvent);
        audio.removeEventListener('play', handleAudioEvent);
        audio.removeEventListener('timeupdate', updateCurrentTime);
    };

    return {
        audio,
        playing,
        isMuted,
        volume,
        playbackRate,
        initAudio,
        togglePlayPause,
        toggleMute,
        changeVolume,
        setCurrentTime,
        setPlaybackRate,
        destroy,
        // AI音质增强相关
        isEnhancerEnabled,
        enhancementLevel,
        currentQuality,
        audioAnalysis,
        toggleEnhancer,
        setEnhancementLevel,
        getEnhancerStatus
    };
}