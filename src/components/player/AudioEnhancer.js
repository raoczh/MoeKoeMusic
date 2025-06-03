import { ref, computed } from 'vue';

/**
 * AI音质增强器
 * 集成多种音频增强算法，自动优化低品质音频
 */
export default function useAudioEnhancer(audio) {
    // 增强器状态
    const isEnhancerEnabled = ref(true);
    const enhancementLevel = ref(2); // 1-轻度, 2-中度, 3-重度
    const isAnalyzing = ref(false);
    const currentQuality = ref('unknown');
    
    // Web Audio API 上下文
    let audioContext = null;
    let sourceNode = null;
    let gainNode = null;
    let compressorNode = null;
    let equalizerNodes = [];
    let reverbNode = null;
    let analyserNode = null;
    let enhancerConnected = false;
    
    // 音频分析数据
    const audioAnalysis = ref({
        bitrate: 0,
        sampleRate: 0,
        dynamicRange: 0,
        frequencySpectrum: [],
        noiseLevel: 0,
        quality: 'unknown'
    });
    
    // 增强算法配置
    const enhancementProfiles = {
        light: {
            compression: { threshold: -24, ratio: 2, attack: 0.003, release: 0.1 },
            eq: [1, 0.5, 0, 0.5, 1, 1.5, 1, 0.5, 0, 0],
            reverb: { roomSize: 0.1, damping: 0.8, wetGain: 0.05 },
            gain: 1.1
        },
        medium: {
            compression: { threshold: -20, ratio: 3, attack: 0.003, release: 0.1 },
            eq: [2, 1, 0, 1, 2, 2.5, 2, 1, 0.5, 0],
            reverb: { roomSize: 0.15, damping: 0.7, wetGain: 0.1 },
            gain: 1.2
        },
        heavy: {
            compression: { threshold: -18, ratio: 4, attack: 0.002, release: 0.08 },
            eq: [3, 2, 1, 1.5, 2.5, 3, 2.5, 2, 1, 0.5],
            reverb: { roomSize: 0.2, damping: 0.6, wetGain: 0.15 },
            gain: 1.3
        }
    };
    
    // 当前增强配置
    const currentProfile = computed(() => {
        const profiles = ['light', 'medium', 'heavy'];
        return enhancementProfiles[profiles[enhancementLevel.value - 1]];
    });
    
    // 添加一个标志来跟踪是否已经初始化过
    let isInitialized = false;
    
    // 初始化Web Audio API
    const initAudioContext = () => {
        try {
            if (!audioContext || audioContext.state === 'closed') {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                console.log('[AudioEnhancer] Web Audio API初始化成功');
            }
            
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
            return true;
        } catch (error) {
            console.error('[AudioEnhancer] Web Audio API初始化失败:', error);
            return false;
        }
    };
    
    // 创建基本的音频处理节点
    const createBasicNodes = () => {
        if (!audioContext) return false;
        
        try {
            // 只在第一次初始化时创建源节点
            if (!sourceNode) {
                audio.crossOrigin = 'anonymous';
                sourceNode = audioContext.createMediaElementSource(audio);
                // 始终保持与destination的连接
                sourceNode.connect(audioContext.destination);
                console.log('[AudioEnhancer] 创建基本音频连接');
            }
            
            // 创建增益节点
            gainNode = audioContext.createGain();
            gainNode.gain.value = 1.0;
            
            // 创建压缩器
            compressorNode = audioContext.createDynamicsCompressor();
            compressorNode.threshold.setValueAtTime(-24, audioContext.currentTime);
            compressorNode.knee.setValueAtTime(30, audioContext.currentTime);
            compressorNode.ratio.setValueAtTime(12, audioContext.currentTime);
            compressorNode.attack.setValueAtTime(0.003, audioContext.currentTime);
            compressorNode.release.setValueAtTime(0.25, audioContext.currentTime);
            
            // 创建均衡器节点
            equalizerNodes = [];
            const frequencies = [60, 170, 350, 1000, 3500, 5000, 10000, 12000, 14000, 16000];
            frequencies.forEach((freq, index) => {
                const filter = audioContext.createBiquadFilter();
                filter.type = index === 0 ? 'lowshelf' : 
                             index === frequencies.length - 1 ? 'highshelf' : 'peaking';
                filter.frequency.setValueAtTime(freq, audioContext.currentTime);
                filter.Q.setValueAtTime(1, audioContext.currentTime);
                filter.gain.setValueAtTime(0, audioContext.currentTime);
                equalizerNodes.push(filter);
            });
            
            // 创建混响节点
            reverbNode = audioContext.createConvolver();
            createReverbImpulse();
            
            // 创建分析器节点
            analyserNode = audioContext.createAnalyser();
            analyserNode.fftSize = 2048;
            
            return true;
        } catch (error) {
            console.error('[AudioEnhancer] 创建音频节点失败:', error);
            return false;
        }
    };
    
    // 创建混响脉冲响应
    const createReverbImpulse = () => {
        if (!audioContext || !reverbNode) return;
        
        const profile = currentProfile.value;
        const length = audioContext.sampleRate * 2; // 2秒混响
        const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - i / length, profile.reverb.damping);
                channelData[i] = (Math.random() * 2 - 1) * decay * profile.reverb.roomSize;
            }
        }
        
        reverbNode.buffer = impulse;
    };
    
    // 连接增强器节点链
    const connectEnhancerChain = () => {
        if (!sourceNode || !gainNode) return false;
        
        try {
            // 先断开源节点的额外连接（保持与destination的连接）
            try {
                const connections = sourceNode.numberOfOutputs;
                if (connections > 1) {
                    sourceNode.disconnect(compressorNode);
                }
            } catch (e) {}
            
            // 建立增强器处理链
            sourceNode.connect(compressorNode);
            let currentNode = compressorNode;
            
            // 连接均衡器链
            equalizerNodes.forEach(eqNode => {
                currentNode.connect(eqNode);
                currentNode = eqNode;
            });
            
            // 连接增益和混响
            currentNode.connect(gainNode);
            
            if (reverbNode) {
                const reverbGain = audioContext.createGain();
                currentNode.connect(reverbNode);
                reverbNode.connect(reverbGain);
                reverbGain.gain.setValueAtTime(currentProfile.value.reverb.wetGain, audioContext.currentTime);
                reverbGain.connect(gainNode);
            }
            
            // 连接分析器
            gainNode.connect(analyserNode);
            gainNode.connect(audioContext.destination);
            
            enhancerConnected = true;
            console.log('[AudioEnhancer] 增强器处理链连接成功');
            return true;
        } catch (error) {
            console.error('[AudioEnhancer] 连接增强器处理链失败:', error);
            return false;
        }
    };
    
    // 应用增强设置
    const applyEnhancement = () => {
        if (!enhancerConnected) return;
        
        const profile = currentProfile.value;
        
        try {
            // 应用压缩器设置
            if (compressorNode) {
                compressorNode.threshold.setValueAtTime(profile.compression.threshold, audioContext.currentTime);
                compressorNode.ratio.setValueAtTime(profile.compression.ratio, audioContext.currentTime);
                compressorNode.attack.setValueAtTime(profile.compression.attack, audioContext.currentTime);
                compressorNode.release.setValueAtTime(profile.compression.release, audioContext.currentTime);
            }
            
            // 应用均衡器设置
            equalizerNodes.forEach((node, index) => {
                if (node && profile.eq[index] !== undefined) {
                    node.gain.setValueAtTime(profile.eq[index], audioContext.currentTime);
                }
            });
            
            // 应用增益设置
            if (gainNode) {
                gainNode.gain.setValueAtTime(profile.gain, audioContext.currentTime);
            }
            
            // 重新创建混响
            createReverbImpulse();
            
            console.log('[AudioEnhancer] 增强设置已应用:', profile);
        } catch (error) {
            console.error('[AudioEnhancer] 应用增强设置失败:', error);
        }
    };
    
    // 分析音频质量
    const analyzeAudioQuality = () => {
        if (!analyserNode || !isEnhancerEnabled.value) return;
        
        isAnalyzing.value = true;
        
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const analyze = () => {
            if (!isAnalyzing.value) return;
            
            analyserNode.getByteFrequencyData(dataArray);
            
            // 计算频谱分析
            const spectrum = Array.from(dataArray).map(value => value / 255);
            
            // 计算动态范围
            const max = Math.max(...spectrum);
            const min = Math.min(...spectrum.filter(v => v > 0));
            const dynamicRange = max - min;
            
            // 估算噪声水平
            const noiseLevel = spectrum.slice(0, 50).reduce((sum, val) => sum + val, 0) / 50;
            
            // 评估音质
            let quality = 'low';
            if (dynamicRange > 0.6 && noiseLevel < 0.1) {
                quality = 'high';
            } else if (dynamicRange > 0.4 && noiseLevel < 0.2) {
                quality = 'medium';
            }
            
            audioAnalysis.value = {
                bitrate: 0,
                sampleRate: audioContext.sampleRate,
                dynamicRange: Math.round(dynamicRange * 100),
                frequencySpectrum: spectrum,
                noiseLevel: Math.round(noiseLevel * 100),
                quality
            };
            
            currentQuality.value = quality;
            
            // 使用较低的更新频率进行分析
            setTimeout(() => {
                if (isAnalyzing.value) {
                    requestAnimationFrame(analyze);
                }
            }, 500);
        };
        
        analyze();
    };
    
    // 从设置中恢复配置
    const loadSettings = () => {
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        isEnhancerEnabled.value = settings.audioEnhancer !== undefined ? settings.audioEnhancer : false; // 默认关闭
        enhancementLevel.value = settings.enhancementLevel || 2;
        console.log('[AudioEnhancer] 设置已加载:', { enabled: isEnhancerEnabled.value, level: enhancementLevel.value });
    };
    
    // 修改初始化增强器函数
    const initializeEnhancer = () => {
        console.log('[AudioEnhancer] 开始初始化增强器');
        
        if (!initAudioContext()) return false;

        // 如果是第一次初始化
        if (!isInitialized) {
            if (!createBasicNodes()) return false;
            isInitialized = true;

            // 根据设置决定是否启用增强器
            if (!isEnhancerEnabled.value) {
                console.log('[AudioEnhancer] 根据设置保持增强器关闭状态');
                return true;
            }
        }

        if (isEnhancerEnabled.value) {
            connectEnhancerChain();
            applyEnhancement();
            
            // 延迟启动分析
            setTimeout(() => {
                if (isEnhancerEnabled.value) {
                    analyzeAudioQuality();
                }
            }, 500);
        }

        return true;
    };

    // 添加音频事件监听
    const setupAudioListeners = () => {
        // 监听音频源变化
        audio.addEventListener('loadedmetadata', () => {
            console.log('[AudioEnhancer] 检测到新的音频源');
            if (!isInitialized) {
                initializeEnhancer();
            } else if (isEnhancerEnabled.value) {
                // 重新连接增强器链
                connectEnhancerChain();
                applyEnhancement();
            }
        });

        // 监听播放错误
        audio.addEventListener('error', (e) => {
            console.error('[AudioEnhancer] 音频播放错误:', e);
            if (sourceNode) {
                try {
                    // 确保基本连接存在
                    sourceNode.disconnect();
                    sourceNode.connect(audioContext.destination);
                } catch (err) {
                    console.error('[AudioEnhancer] 恢复基本连接失败:', err);
                }
            }
        });
    };

    // 修改禁用增强器函数
    const disableEnhancer = () => {
        console.log('[AudioEnhancer] 开始禁用增强器');
        isAnalyzing.value = false;
        
        if (sourceNode) {
            try {
                // 断开除了destination之外的所有连接
                const connections = sourceNode.numberOfOutputs;
                if (connections > 1) {
                    sourceNode.disconnect(compressorNode);
                }
                
                // 断开其他节点
                if (compressorNode) compressorNode.disconnect();
                if (gainNode) gainNode.disconnect();
                if (reverbNode) reverbNode.disconnect();
                if (analyserNode) analyserNode.disconnect();
                equalizerNodes.forEach(node => {
                    try { node.disconnect(); } catch (e) {}
                });
                
                enhancerConnected = false;
                console.log('[AudioEnhancer] 增强器已禁用，保持基本音频输出');
            } catch (error) {
                console.error('[AudioEnhancer] 禁用增强器时出错:', error);
            }
        }
    };
    
    // 修改 toggleEnhancer 函数
    const toggleEnhancer = () => {
        console.log('[AudioEnhancer] 切换增强器状态，当前状态:', isEnhancerEnabled.value);
        
        // 保存当前播放状态
        const wasPlaying = !audio.paused;
        const currentTime = audio.currentTime;
        
        isEnhancerEnabled.value = !isEnhancerEnabled.value;

        if (isEnhancerEnabled.value) {
            initializeEnhancer();
        } else {
            disableEnhancer();
        }

        // 保存设置
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        settings.audioEnhancer = isEnhancerEnabled.value;
        settings.enhancementLevel = enhancementLevel.value;
        localStorage.setItem('settings', JSON.stringify(settings));

        // 如果之前在播放，确保继续播放
        if (wasPlaying) {
            audio.currentTime = currentTime;
            audio.play().catch(e => console.error('[AudioEnhancer] 恢复播放失败:', e));
        }

        console.log('[AudioEnhancer] 增强器状态已更新:', isEnhancerEnabled.value ? '启用' : '禁用');
    };
    
    // 设置增强级别
    const setEnhancementLevel = (level) => {
        console.log('[AudioEnhancer] 设置增强级别:', level);
        enhancementLevel.value = Math.max(1, Math.min(3, level));
        
        // 立即应用新的增强设置
        if (enhancerConnected && isEnhancerEnabled.value) {
            applyEnhancement();
        }
        
        // 保存设置
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        settings.enhancementLevel = enhancementLevel.value;
        localStorage.setItem('settings', JSON.stringify(settings));
        
        console.log('[AudioEnhancer] 增强级别已更新为:', enhancementLevel.value);
    };
    
    // 获取增强器状态信息
    const getEnhancerStatus = () => {
        return {
            enabled: isEnhancerEnabled.value,
            level: enhancementLevel.value,
            analyzing: isAnalyzing.value,
            quality: currentQuality.value,
            analysis: audioAnalysis.value,
            profile: currentProfile.value
        };
    };
    
    // 监听设置变更事件
    if (typeof window !== 'undefined') {
        window.addEventListener('audio-enhancer-setting-changed', (event) => {
            const { enabled } = event.detail;
            isEnhancerEnabled.value = enabled;
            
            if (enabled) {
                initializeEnhancer();
            } else {
                disableEnhancer();
            }
            
            console.log('[AudioEnhancer] 响应设置变更:', enabled ? '启用' : '禁用');
        });
    }
    
    // 初始化
    loadSettings();
    setupAudioListeners();
    
    return {
        // 状态
        isEnhancerEnabled,
        enhancementLevel,
        isAnalyzing,
        currentQuality,
        audioAnalysis,
        get enhancerConnected() { return enhancerConnected; },
        
        // 方法
        toggleEnhancer,
        setEnhancementLevel,
        initializeEnhancer,
        disableEnhancer,
        getEnhancerStatus,
        
        // 计算属性
        currentProfile
    };
}