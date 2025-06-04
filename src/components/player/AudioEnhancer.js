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
    // 添加用户交互激活标志
    const requiresUserActivation = ref(true);
    
    // Web Audio API 上下文
    let audioContext = null;
    let sourceNode = null;
    let gainNode = null;
    let compressorNode = null;
    let equalizerNodes = [];
    let reverbNode = null;
    let analyserNode = null;
    let enhancerConnected = false;
    let baselineConnected = false; // 添加基础连接状态标志
    
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

            // 如果需要用户激活且上下文被挂起，返回false
            if (audioContext.state === 'suspended' && requiresUserActivation.value) {
                console.log('[AudioEnhancer] 等待用户交互以激活AudioContext');
                return false;
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
            // 创建源节点（如果还没有创建）
            if (!sourceNode) {
                console.log('[AudioEnhancer] 创建音频源节点');
                audio.crossOrigin = 'anonymous';
                sourceNode = audioContext.createMediaElementSource(audio);
                // 立即建立基础连接
                sourceNode.connect(audioContext.destination);
                baselineConnected = true;
                console.log('[AudioEnhancer] 建立基础音频连接');
            }

            // 创建其他节点（如果需要）
            if (!gainNode) {
                gainNode = audioContext.createGain();
                gainNode.gain.value = 1.0;
            }

            if (!compressorNode) {
                compressorNode = audioContext.createDynamicsCompressor();
                compressorNode.threshold.setValueAtTime(-24, audioContext.currentTime);
                compressorNode.knee.setValueAtTime(30, audioContext.currentTime);
                compressorNode.ratio.setValueAtTime(12, audioContext.currentTime);
                compressorNode.attack.setValueAtTime(0.003, audioContext.currentTime);
                compressorNode.release.setValueAtTime(0.25, audioContext.currentTime);
            }

            if (equalizerNodes.length === 0) {
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
            }

            if (!reverbNode) {
                reverbNode = audioContext.createConvolver();
                createReverbImpulse();
            }

            if (!analyserNode) {
                analyserNode = audioContext.createAnalyser();
                analyserNode.fftSize = 2048;
            }

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
    
    // 建立基础音频连接
    const setupBaselineConnection = () => {
        if (!sourceNode || baselineConnected) return;
        
        try {
            sourceNode.disconnect();
            sourceNode.connect(audioContext.destination);
            baselineConnected = true;
            console.log('[AudioEnhancer] 建立基础音频连接');
        } catch (error) {
            console.error('[AudioEnhancer] 建立基础连接失败:', error);
        }
    };
    
    // 连接增强器节点链
    const connectEnhancerChain = () => {
        if (!sourceNode || !gainNode) return false;

        try {
            console.log('[AudioEnhancer] 开始连接增强器链');
            
            // 断开所有现有连接
            sourceNode.disconnect();
            baselineConnected = false;

            // 建立增强器处理链
            sourceNode.connect(compressorNode);
            
            let currentNode = compressorNode;
            equalizerNodes.forEach(eqNode => {
                currentNode.connect(eqNode);
                currentNode = eqNode;
            });

            // 连接增益和混响
            currentNode.connect(gainNode);
            
            // 添加混响（并行处理）
            if (reverbNode) {
                const reverbGain = audioContext.createGain();
                gainNode.connect(reverbNode);
                reverbNode.connect(reverbGain);
                reverbGain.gain.setValueAtTime(currentProfile.value.reverb.wetGain, audioContext.currentTime);
                reverbGain.connect(audioContext.destination);
            }

            // 连接分析器和主输出
            gainNode.connect(analyserNode);
            gainNode.connect(audioContext.destination);

            enhancerConnected = true;
            console.log('[AudioEnhancer] 增强器处理链连接成功');
            return true;
        } catch (error) {
            console.error('[AudioEnhancer] 连接增强器处理链失败:', error);
            setupBaselineConnection(); // 恢复基础连接
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

    // 用户激活音频上下文
    const activateAudioContext = async () => {
        if (!audioContext) {
            if (!initAudioContext()) return false;
        }

        if (audioContext.state === 'suspended') {
            try {
                await audioContext.resume();
                requiresUserActivation.value = false;
                console.log('[AudioEnhancer] AudioContext已被用户激活');

                // 确保基础节点创建和连接
                if (!isInitialized) {
                    if (!createBasicNodes()) return false;
                    isInitialized = true;
                }
                return true;
            } catch (error) {
                console.error('[AudioEnhancer] 激活AudioContext失败:', error);
                return false;
            }
        }
        return true;
    };

    // 初始化增强器
    const initializeEnhancer = async () => {
        console.log('[AudioEnhancer] 开始初始化增强器');

        // 确保音频上下文已激活
        if (!await activateAudioContext()) {
            console.log('[AudioEnhancer] 等待用户激活');
            return false;
        }

        // 如果启用了增强器，建立增强器链接
        if (isEnhancerEnabled.value) {
            if (connectEnhancerChain()) {
                applyEnhancement();
                setTimeout(() => {
                    if (isEnhancerEnabled.value) {
                        analyzeAudioQuality();
                    }
                }, 100);
            }
        }

        return true;
    };

    // 禁用增强器
    const disableEnhancer = () => {
        console.log('[AudioEnhancer] 禁用增强器');
        isAnalyzing.value = false;
        enhancerConnected = false;

        if (sourceNode) {
            setupBaselineConnection();
        }

        // 断开其他节点
        if (compressorNode) compressorNode.disconnect();
        if (gainNode) gainNode.disconnect();
        if (reverbNode) reverbNode.disconnect();
        if (analyserNode) analyserNode.disconnect();
        equalizerNodes.forEach(node => node.disconnect());
    };

    // 切换增强器状态
    const toggleEnhancer = async () => {
        const wasPlaying = !audio.paused;
        const currentTime = audio.currentTime;

        if (wasPlaying) {
            audio.pause();
        }

        // 确保上下文已激活
        if (!await activateAudioContext()) {
            console.warn('[AudioEnhancer] 无法激活AudioContext，保持原状态');
            if (wasPlaying) {
                audio.currentTime = currentTime;
                audio.play().catch(console.error);
            }
            return;
        }

        isEnhancerEnabled.value = !isEnhancerEnabled.value;

        if (isEnhancerEnabled.value) {
            await initializeEnhancer();
        } else {
            disableEnhancer();
        }

        // 保存设置
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        settings.audioEnhancer = isEnhancerEnabled.value;
        settings.enhancementLevel = enhancementLevel.value;
        localStorage.setItem('settings', JSON.stringify(settings));

        // 恢复播放
        if (wasPlaying) {
            audio.currentTime = currentTime;
            // 使用较短的延迟确保节点连接完成
            setTimeout(() => {
                audio.play().catch(e => console.error('[AudioEnhancer] 恢复播放失败:', e));
            }, 20);
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
    
    // 设置事件监听
    const setupAudioListeners = () => {
        // 监听音频源变化
        audio.addEventListener('loadedmetadata', () => {
            console.log('[AudioEnhancer] 检测到新的音频源');
            // 只在未初始化时尝试初始化
            if (!isInitialized && !requiresUserActivation.value) {
                initializeEnhancer();
            }
        });

        // 监听播放事件
        audio.addEventListener('play', async () => {
            console.log('[AudioEnhancer] 播放开始');
            // 确保音频上下文是激活的
            if (audioContext && audioContext.state === 'suspended') {
                await audioContext.resume();
            }
        });

        // 监听播放错误
        audio.addEventListener('error', (e) => {
            console.error('[AudioEnhancer] 音频播放错误:', e);
            setupBaselineConnection();
        });

        // 监听用户交互
        const handleUserInteraction = async () => {
            if (requiresUserActivation.value) {
                console.log('[AudioEnhancer] 检测到用户交互');
                if (await activateAudioContext()) {
                    // 如果增强器已启用，初始化它
                    if (isEnhancerEnabled.value) {
                        await initializeEnhancer();
                    }
                }
            }
        };

        // 添加用户交互监听
        document.addEventListener('click', handleUserInteraction, { once: true });
        document.addEventListener('touchstart', handleUserInteraction, { once: true });
        document.addEventListener('keydown', handleUserInteraction, { once: true });
    };
    
    // 初始化
    loadSettings();
    setupAudioListeners();
    // 尝试初始化音频上下文，但不强制激活
    initAudioContext();
    
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