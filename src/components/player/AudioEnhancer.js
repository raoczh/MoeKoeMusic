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
            eq: [0, 1, 2, 1, 0, -1, 0, 1, 2, 1], // 10频段EQ增益(dB)
            reverb: { roomSize: 0.1, damping: 0.8, wetGain: 0.05 },
            gain: 1.1
        },
        medium: {
            compression: { threshold: -20, ratio: 3, attack: 0.003, release: 0.1 },
            eq: [1, 2, 3, 2, 1, -1, 1, 2, 3, 2],
            reverb: { roomSize: 0.2, damping: 0.7, wetGain: 0.1 },
            gain: 1.2
        },
        heavy: {
            compression: { threshold: -18, ratio: 4, attack: 0.002, release: 0.08 },
            eq: [2, 3, 4, 3, 2, -2, 2, 3, 4, 3],
            reverb: { roomSize: 0.3, damping: 0.6, wetGain: 0.15 },
            gain: 1.3
        }
    };
    
    // 当前增强配置
    const currentProfile = computed(() => {
        const profiles = ['light', 'medium', 'heavy'];
        return enhancementProfiles[profiles[enhancementLevel.value - 1]];
    });
    
    // 初始化Web Audio API
    const initAudioContext = () => {
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                audioContext.resume(); // 确保音频上下文是激活状态
                console.log('[AudioEnhancer] Web Audio API初始化成功');
            } else {
                // 如果上下文已存在但处于暂停状态，尝试恢复
                if (audioContext.state === 'suspended') {
                    audioContext.resume();
                }
            }
            return true;
        } catch (error) {
            console.error('[AudioEnhancer] Web Audio API初始化失败:', error);
            return false;
        }
    };
    
    // 创建音频处理节点
    const createAudioNodes = () => {
        if (!audioContext) return false;
        
        try {
            // 清理之前的节点
            if (sourceNode) {
                try {
                    sourceNode.disconnect();
                } catch (e) {}
            }
            
            // 只有在还没有创建源节点时才创建新的源节点
            // 因为MediaElementSource一旦创建就会接管音频元素的输出
            if (!sourceNode) {
                sourceNode = audioContext.createMediaElementSource(audio);
            }
            
            // 创建增益节点
            gainNode = audioContext.createGain();
            gainNode.gain.value = 1.0; // 初始增益设为1
            
            // 创建压缩器节点
            compressorNode = audioContext.createDynamicsCompressor();
            compressorNode.threshold.setValueAtTime(-24, audioContext.currentTime);
            compressorNode.knee.setValueAtTime(30, audioContext.currentTime);
            compressorNode.ratio.setValueAtTime(12, audioContext.currentTime);
            compressorNode.attack.setValueAtTime(0.003, audioContext.currentTime);
            compressorNode.release.setValueAtTime(0.25, audioContext.currentTime);
            
            // 创建均衡器节点组
            equalizerNodes = [];
            const frequencies = [60, 170, 350, 1000, 3500, 5000, 10000, 12000, 14000, 16000];
            frequencies.forEach((freq, index) => {
                const filter = audioContext.createBiquadFilter();
                filter.type = index === 0 ? 'lowshelf' : 
                             index === frequencies.length - 1 ? 'highshelf' : 'peaking';
                filter.frequency.setValueAtTime(freq, audioContext.currentTime);
                filter.Q.setValueAtTime(1, audioContext.currentTime);
                filter.gain.setValueAtTime(0, audioContext.currentTime); // 初始EQ设置为平坦
                equalizerNodes.push(filter);
            });
            
            // 创建混响节点
            reverbNode = audioContext.createConvolver();
            createReverbImpulse();
            
            // 创建分析节点
            analyserNode = audioContext.createAnalyser();
            analyserNode.fftSize = 2048;
            
            console.log('[AudioEnhancer] 音频处理节点创建成功');
            return true;
        } catch (error) {
            console.error('[AudioEnhancer] 音频处理节点创建失败:', error);
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
    
    // 连接音频处理链
    const connectAudioChain = () => {
        if (!sourceNode) return;
        
        try {
            // 断开所有现有连接
            try {
                sourceNode.disconnect();
            } catch (e) {}
            
            if (!isEnhancerEnabled.value) {
                // 即使禁用增强器，也需要保持基本的音频连接
                // 因为一旦创建了MediaElementSource，音频元素就失去了直接播放能力
                sourceNode.connect(audioContext.destination);
                enhancerConnected = false;
                console.log('[AudioEnhancer] 增强器已禁用，使用直通模式');
                return;
            }
            
            // 创建主音频处理链
            let currentNode = sourceNode;
            
            // 连接压缩器
            currentNode.connect(compressorNode);
            currentNode = compressorNode;
            
            // 连接均衡器链
            equalizerNodes.forEach(eqNode => {
                currentNode.connect(eqNode);
                currentNode = eqNode;
            });
            
            // 连接增益节点
            currentNode.connect(gainNode);
            
            // 创建干湿混合
            const dryGain = audioContext.createGain();
            const wetGain = audioContext.createGain();
            
            // 设置干湿比例
            const wetLevel = Math.min(currentProfile.value.reverb.wetGain, 0.3); // 限制最大混响比例
            wetGain.gain.setValueAtTime(wetLevel, audioContext.currentTime);
            dryGain.gain.setValueAtTime(1 - wetLevel, audioContext.currentTime);
            
            // 干声路径
            gainNode.connect(dryGain);
            
            // 湿声路径（混响）
            gainNode.connect(reverbNode);
            reverbNode.connect(wetGain);
            
            // 混合干湿声
            const mixNode = audioContext.createGain();
            dryGain.connect(mixNode);
            wetGain.connect(mixNode);
            
            // 连接分析器
            mixNode.connect(analyserNode);
            
            // 最后连接到输出
            mixNode.connect(audioContext.destination);
            
            enhancerConnected = true;
            console.log('[AudioEnhancer] 音频处理链连接成功');
        } catch (error) {
            console.error('[AudioEnhancer] 音频处理链连接失败:', error);
            // 发生错误时，确保音频可以正常播放
            try {
                sourceNode.disconnect();
                sourceNode.connect(audioContext.destination);
            } catch (e) {
                console.error('[AudioEnhancer] 恢复直接音频输出失败:', e);
            }
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
                bitrate: 0, // 需要从其他地方获取
                sampleRate: audioContext.sampleRate,
                dynamicRange: Math.round(dynamicRange * 100),
                frequencySpectrum: spectrum,
                noiseLevel: Math.round(noiseLevel * 100),
                quality
            };
            
            currentQuality.value = quality;
            
            // 根据分析结果自动调整增强级别
            autoAdjustEnhancement(quality, dynamicRange, noiseLevel);
            
            requestAnimationFrame(analyze);
        };
        
        analyze();
    };
    
    // 自动调整增强级别
    const autoAdjustEnhancement = (quality, dynamicRange, noiseLevel) => {
        if (quality === 'low' && dynamicRange < 0.3) {
            enhancementLevel.value = 3; // 重度增强
        } else if (quality === 'medium' && dynamicRange < 0.5) {
            enhancementLevel.value = 2; // 中度增强
        } else if (quality === 'high') {
            enhancementLevel.value = 1; // 轻度增强
        }
        
        applyEnhancement();
    };
    
    // 启用/禁用增强器
    const toggleEnhancer = () => {
        console.log('[AudioEnhancer] 切换增强器状态，当前状态:', isEnhancerEnabled.value);
        isEnhancerEnabled.value = !isEnhancerEnabled.value;
        
        if (isEnhancerEnabled.value) {
            if (!audioContext || audioContext.state === 'closed') {
                initAudioContext();
            }
            initializeEnhancer();
        } else {
            // 禁用增强器时，重新连接音频链以确保音频正常播放
            connectAudioChain();
        }
        
        // 保存设置
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        settings.audioEnhancer = isEnhancerEnabled.value;
        settings.enhancementLevel = enhancementLevel.value;
        localStorage.setItem('settings', JSON.stringify(settings));
        
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
    
    // 初始化增强器
    const initializeEnhancer = () => {
        console.log('[AudioEnhancer] 开始初始化增强器');
        if (!initAudioContext()) return false;
        
        // 等待音频元素准备就绪
        const initWhenReady = () => {
            if (audio.readyState >= 1 && audio.src) { // HAVE_METADATA 且有音频源
                if (createAudioNodes()) {
                    connectAudioChain();
                    if (isEnhancerEnabled.value) {
                        applyEnhancement();
                        // 延迟启动分析，确保音频开始播放
                        setTimeout(() => {
                            if (isEnhancerEnabled.value) {
                                analyzeAudioQuality();
                            }
                        }, 500);
                    }
                    console.log('[AudioEnhancer] 增强器初始化完成');
                }
            } else {
                setTimeout(initWhenReady, 100);
            }
        };
        
        initWhenReady();
        return true;
    };
    
    // 禁用增强器
    const disableEnhancer = () => {
        console.log('[AudioEnhancer] 开始禁用增强器');
        isAnalyzing.value = false;
        
        if (sourceNode) {
            try {
                // 断开所有节点的连接
                sourceNode.disconnect();
                if (compressorNode) {
                    try { compressorNode.disconnect(); } catch (e) {}
                }
                if (gainNode) {
                    try { gainNode.disconnect(); } catch (e) {}
                }
                if (reverbNode) {
                    try { reverbNode.disconnect(); } catch (e) {}
                }
                if (analyserNode) {
                    try { analyserNode.disconnect(); } catch (e) {}
                }
                equalizerNodes.forEach(node => {
                    try { node.disconnect(); } catch (e) {}
                });
                
                // 直接连接到输出，保持音频播放
                sourceNode.connect(audioContext.destination);
                
                enhancerConnected = false;
                console.log('[AudioEnhancer] 增强器已禁用，音频输出已恢复');
            } catch (error) {
                console.error('[AudioEnhancer] 禁用增强器时出错:', error);
                // 确保音频能够播放
                try {
                    sourceNode.disconnect();
                    sourceNode.connect(audioContext.destination);
                } catch (e) {
                    console.error('[AudioEnhancer] 恢复直接音频输出失败:', e);
                }
            }
        }
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
    
    // 从设置中恢复配置
    const loadSettings = () => {
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        isEnhancerEnabled.value = settings.audioEnhancer !== false; // 默认启用
        enhancementLevel.value = settings.enhancementLevel || 2;
        console.log('[AudioEnhancer] 设置已加载:', { enabled: isEnhancerEnabled.value, level: enhancementLevel.value });
        
        // 如果增强器启用，在音频准备好后自动初始化
        if (isEnhancerEnabled.value) {
            const checkAndInit = () => {
                if (audio.readyState >= 1 && audio.src) {
                    try {
                        initializeEnhancer();
                    } catch (error) {
                        console.error('[AudioEnhancer] 自动初始化失败:', error);
                        // 初始化失败时禁用增强器，确保音频正常播放
                        isEnhancerEnabled.value = false;
                    }
                } else {
                    audio.addEventListener('loadedmetadata', () => {
                        if (isEnhancerEnabled.value) {
                            try {
                                initializeEnhancer();
                            } catch (error) {
                                console.error('[AudioEnhancer] 延迟初始化失败:', error);
                                isEnhancerEnabled.value = false;
                            }
                        }
                    }, { once: true });
                }
            };
            
            // 延迟检查，确保audio元素已经设置了src
            setTimeout(checkAndInit, 100);
        }
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
    
    return {
        // 状态
        isEnhancerEnabled,
        enhancementLevel,
        isAnalyzing,
        currentQuality,
        audioAnalysis,
        
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