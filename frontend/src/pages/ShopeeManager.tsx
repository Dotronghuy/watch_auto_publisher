import { useState, useEffect, useRef } from 'react'
import { dbAPI, driveAPI, fsAPI } from './ShopeeManager/apiClient';
import './ShopeeManager-tailwind.css';
import api from './ShopeeManager/apiClient.ts';

const safeFileUrl = (filePath: string) => {
  if (!filePath) return '';
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
  return `/api/shopee/serve-local-file?path=${encodeURIComponent(filePath)}&t=${Date.now()}`;
}

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'sync' | 'products' | 'settings'>('products')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [models, setModels] = useState<any[]>([])
  const [showInput, setShowInput] = useState(false)
  const [newModelName, setNewModelName] = useState('')

  const [selectedModel, setSelectedModel] = useState<any>(null)
  const [variants, setVariants] = useState<any[]>([])
  const [newVariant, setNewVariant] = useState({ color: '', sku: '', price: 0, shopeeProductId: '' })
  const [isImporting, setIsImporting] = useState(false) // Trạng thái đang nạp Excel
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'ready' | 'synced'>('all')
  const [variantSearchQuery, setVariantSearchQuery] = useState('')
  const [notification, setNotification] = useState('')
  const [sapoProgress, setSapoProgress] = useState<{current: number, total: number} | null>(null)
  
  const [showMissingModal, setShowMissingModal] = useState(false)
  const [missingVariants, setMissingVariants] = useState<any[]>([])

  const [watermarkPath, setWatermarkPath] = useState('')
  const [watermarkX, setWatermarkX] = useState(50)
  const [watermarkY, setWatermarkY] = useState(50)
  const [watermarkScale, setWatermarkScale] = useState(30)
  const [watermarkAspectRatio, setWatermarkAspectRatio] = useState(1)
  const [showWatermarkModal, setShowWatermarkModal] = useState(false)
  const [selectedVariantForWatermark, setSelectedVariantForWatermark] = useState<any>(null)
  
  const handleOpenWatermarkModal = (variant: any) => {
    setSelectedVariantForWatermark(variant)
    setShowWatermarkModal(true)
  }

  const handleSaveWatermarkConfig = async () => {
    await api.saveSetting('watermark_x', watermarkX.toString())
    await api.saveSetting('watermark_y', watermarkY.toString())
    await api.saveSetting('watermark_scale', watermarkScale.toString())
    setShowWatermarkModal(false)
    setNotification('✅ Đã lưu cấu hình vị trí Logo!')
    setTimeout(() => setNotification(''), 3000)
  }

  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [googleSheetUrl, setGoogleSheetUrl] = useState('')
  const [isMatchingAi, setIsMatchingAi] = useState(false)
  const [hasShopeeCookies, setHasShopeeCookies] = useState(false)
  const [telegramNotifyEnabled, setTelegramNotifyEnabled] = useState(false)
  const [telegramBotToken, setTelegramBotToken] = useState('')
  const [telegramChatId, setTelegramChatId] = useState('')

  const [processingVariantId, setProcessingVariantId] = useState<string | null>(null)
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null)
  const [editData, setEditData] = useState({ color: '', sku: '', shopeeProductId: '' })
  const [isBulkProcessing, setIsBulkProcessing] = useState(false)
  const [imagePool, setImagePool] = useState<string[]>([])
  const [isAutoSyncing, setIsAutoSyncing] = useState(false)
  const [priorityModel, setPriorityModel] = useState('')
  const [autoSyncLog, setAutoSyncLog] = useState<string[]>([])
  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [autoSyncLog])

  useEffect(() => {
    loadModels()
    loadSettings()
    
    // Đăng ký nhận sự kiện tiến trình Sapo
    api.onSapoProgress((data: any) => {
      setSapoProgress(data)
    })

    // Poll logs chạy ngầm từ backend
    const logInterval = setInterval(async () => {
      try {
        const res = await api.getAutoSyncLogs();
        if (res.success && res.logs && res.logs.length > 0) {
          setAutoSyncLog(prev => [...prev, ...res.logs].slice(-500)); // Hiển thị 500 dòng mới nhất
        }
      } catch (err) {
        console.error("Lỗi poll logs:", err);
      }
    }, 1500);

    return () => clearInterval(logInterval);
  }, [])

  const handleUpdateVariant = async (id: string) => {
    await api.updateVariant(id, { 
      color: editData.color, 
      sku: editData.sku, 
      shopeeProductId: editData.shopeeProductId 
    })
    setEditingVariantId(null)
    const data = await api.getVariants(selectedModel.id)
    setVariants(data)
  }

  const handleAssignRawImage = async (id: string) => {
    const path = await api.selectImage()
    if (path) {
      await api.updateVariant(id, { rawImage: path })
      const data = await api.getVariants(selectedModel.id)
      setVariants(data)
    }
  }

  const handleClearRawImage = async (id: string, currentPath: string) => {
    await api.updateVariant(id, { rawImage: null })
    const data = await api.getVariants(selectedModel.id)
    setVariants(data)
    // Nếu ảnh này không nằm trong pool, ném nó lại vào pool
    if (!imagePool.includes(currentPath)) {
      setImagePool(prev => [...prev, currentPath])
    }
  }

  const handleLoadImagePool = async () => {
    const paths = await api.selectMultipleImages()
    if (!paths || paths.length === 0) return
    setImagePool(paths)
    setNotification(`✅ Đã tải ${paths.length} ảnh vào kho!`)
    setTimeout(() => setNotification(''), 3000)
  }

  const handleAssignFromPool = async (path: string, variantId?: string) => {
    let targetId = variantId;
    if (!targetId) {
      const emptyVariant = variants.find(v => !v.rawImage || v.rawImage.trim() === '');
      if (!emptyVariant) {
        alert('Tất cả các màu đều đã có ảnh!');
        return;
      }
      targetId = emptyVariant.id;
    }

    await api.updateVariant(targetId, { rawImage: path })

    // Xóa ảnh khỏi pool
    setImagePool(prev => prev.filter(p => p !== path))

    const data = await api.getVariants(selectedModel.id)
    setVariants(data)
  }

  const handleGenerateAvatar = async (variantId: string) => {
    setProcessingVariantId(variantId)
    const result = await api.generateAvatar(variantId)
    if (result.success) {
      setNotification('✅ Đã tạo Avatar thành công!')
      setTimeout(() => setNotification(''), 3000)
      // Cập nhật lại danh sách biến thể
      if (selectedModel) {
        const data = await api.getVariants(selectedModel.id)
        setVariants(data)
      }
    } else if (result.message !== 'Đã hủy chọn ảnh') {
      alert('Lỗi tạo Avatar: ' + result.message)
    }
    setProcessingVariantId(null)
  }

  const handleGenerateBulkPhotoshop = async () => {
    if (!selectedModel) return
    setIsBulkProcessing(true)
    setNotification('⏳ Đang mở Photoshop để xử lý hàng loạt...')
    const result = await api.generateBulkAvatarsPhotoshop(selectedModel.id)
    if (result.success) {
      setNotification(`✅ ${result.message}`)
      setTimeout(() => setNotification(''), 5000)
      setImagePool([]) // Xóa kho ảnh sau khi làm xong
      // Cập nhật lại danh sách biến thể
      const data = await api.getVariants(selectedModel.id)
      setVariants(data)
    } else if (result.message !== 'Đã hủy chọn thư mục lưu') {
      alert('Lỗi tạo Album Photoshop: ' + result.message)
      setNotification('')
    } else {
      setNotification('')
    }
    setIsBulkProcessing(false)
  }

  const loadSettings = async () => {
    const path = await api.getSetting('watermark_path')
    if (path) setWatermarkPath(path)
    
    const wx = await api.getSetting('watermark_x')
    if (wx) setWatermarkX(parseFloat(wx))
    const wy = await api.getSetting('watermark_y')
    if (wy) setWatermarkY(parseFloat(wy))
    const wscale = await api.getSetting('watermark_scale')
    if (wscale) setWatermarkScale(parseFloat(wscale))

    const apiKey = await api.getSetting('gemini_api_key')
    if (apiKey) setGeminiApiKey(apiKey)
    const openaiKey = await api.getSetting('openai_api_key')
    if (openaiKey) setOpenaiApiKey(openaiKey)
    const sheetUrl = await api.getSetting('google_sheet_webhook_url')
    if (sheetUrl) setGoogleSheetUrl(sheetUrl)
    const cookies = await api.getSetting('shopee_cookies')
    if (cookies) setHasShopeeCookies(true)
    const telEnabled = await api.getSetting('telegram_notify_enabled')
    setTelegramNotifyEnabled(telEnabled === 'true')
    const telToken = await api.getSetting('telegram_bot_token')
    if (telToken) setTelegramBotToken(telToken)
    const telChatId = await api.getSetting('telegram_chat_id')
    if (telChatId) setTelegramChatId(telChatId)
  }

  const handleSelectWatermark = async () => {
    const path = await api.selectFile()
    if (path) {
      await api.saveSetting('watermark_path', path)
      setWatermarkPath(path)
      setNotification('✅ Đã lưu đường dẫn khung ảnh!')
      setTimeout(() => setNotification(''), 3000)
    }
  }

  const handleSaveGeminiKey = async () => {
    await api.saveSetting('gemini_api_key', geminiApiKey)
    setNotification('✅ Đã lưu danh sách Gemini API Key!')
    setTimeout(() => setNotification(''), 3000)
  }

  const handleSaveOpenAiKey = async () => {
    await api.saveSetting('openai_api_key', openaiApiKey)
    setNotification('✅ Đã lưu OpenAI API Key!')
    setTimeout(() => setNotification(''), 3000)
  }

  const handleSaveGoogleSheetUrl = async () => {
    await api.saveSetting('google_sheet_webhook_url', googleSheetUrl)
    setNotification('✅ Đã lưu Google Sheet Webhook URL!')
    setTimeout(() => setNotification(''), 3000)
  }

  const handleToggleTelegram = async () => {
    const newValue = !telegramNotifyEnabled;
    setTelegramNotifyEnabled(newValue);
    await api.saveSetting('telegram_notify_enabled', newValue ? 'true' : 'false');
    setNotification(newValue ? '🔔 Đã bật thông báo Telegram!' : '🔕 Đã tắt thông báo Telegram!');
    setTimeout(() => setNotification(''), 3000);
  }

  const handleSaveTelegramSettings = async () => {
    await api.saveSetting('telegram_bot_token', telegramBotToken);
    await api.saveSetting('telegram_chat_id', telegramChatId);
    setNotification('✅ Đã lưu cấu hình Telegram!');
    setTimeout(() => setNotification(''), 3000);
  }

  const handleTestTelegramNotification = async () => {
    if (!telegramBotToken || !telegramChatId) {
      alert('Vui lòng điền đầy đủ Bot Token và Chat ID để kiểm thử!');
      return;
    }
    setNotification('⏳ Đang gửi thử tin nhắn Telegram...');
    const result = await api.testTelegramNotification(telegramBotToken, telegramChatId);
    if (result.success) {
      setNotification('✅ ' + result.message);
    } else {
      alert(result.message);
      setNotification('');
    }
    setTimeout(() => setNotification(''), 4000);
  }

  const handleAutoMatchAi = async () => {
    if (imagePool.length === 0) return;
    setIsMatchingAi(true);
    setNotification('🤖 AI đang phân tích ảnh, vui lòng chờ...');
    
    const unassignedVariants = variants.filter(v => !v.rawImage || v.rawImage.trim() === '');
    
    const result = await api.autoMatchImagesAi({
      imagePaths: imagePool,
      variants: unassignedVariants
    });
    
    if (result.success) {
      let matchCount = 0;
      for (const match of result.data) {
        const { imageIndex, variantId } = match;
        const imgPath = imagePool[imageIndex];
        if (imgPath && variantId) {
          await api.updateVariant(variantId, { rawImage: imgPath });
          matchCount++;
        }
      }
      
      const assignedIndices = result.data.map((m: any) => m.imageIndex);
      setImagePool(prev => prev.filter((_, idx) => !assignedIndices.includes(idx)));
      
      const updatedVariants = await api.getVariants(selectedModel?.id);
      setVariants(updatedVariants);
      
      setNotification(`✅ AI đã tự động gán thành công ${matchCount} ảnh!`);
      setTimeout(() => setNotification(''), 5000);
    } else {
      alert('Lỗi AI: ' + result.message);
      setNotification('');
    }
    setIsMatchingAi(false);
  }

  const handleShopeeLogin = async () => {
    setNotification('Mở cửa sổ đăng nhập Shopee...')
    const result = await api.shopeeLogin()
    if (result.success) {
      setHasShopeeCookies(true)
      setNotification(`✅ ${result.message}`)
      alert('Tuyệt vời! ' + result.message)
    } else {
      setNotification('')
      alert('Lỗi đăng nhập Shopee: ' + result.message)
    }
    setTimeout(() => setNotification(''), 4000)
  }

  const handleFullAutoSync = async () => {
    if (!hasShopeeCookies) {
      alert('Vui lòng đăng nhập Shopee trước! (Vào mục Cài đặt Khung/Logo)');
      return;
    }

    if (!window.confirm('⚠️ Bạn sắp chạy tự động Sync TOÀN BỘ sản phẩm có Shopee ID.\n\nTool sẽ tự tạo Avatar và đăng/cập nhật từng sản phẩm một.\n\nBảo đảm bạn đã sẵn sàng!')) return;
    
    setIsAutoSyncing(true);
    setAutoSyncLog(['🚀 Đã khởi động Full Auto Sync...']);
    setActiveTab('sync'); // Chuyển sang tab Sync để hiển thị log trực tiếp
    const result = await api.runFullAutoSync(priorityModel.trim());
    if (result.success) {
      setNotification(`🎉 ${result.message}`);
    } else {
      alert('Lỗi Auto Sync: ' + result.message);
      setNotification('');
      setIsAutoSyncing(false);
    }
  }

  const handleStopAutoSync = async () => {
    if (!window.confirm('🛑 Bạn có chắc chắn muốn DỪNG tiến trình Auto Sync hiện tại?')) return;
    const result = await api.stopAutoSync();
    if (result.success) {
      setNotification(`🛑 ${result.message}`);
      setIsAutoSyncing(false);
    } else {
      alert('Lỗi dừng Auto Sync: ' + result.message);
    }
  }

  const handleSyncShopee = async (variantId: string) => {
    if (!hasShopeeCookies) {
      alert('Vui lòng đăng nhập Shopee trước! (Vào mục Cài đặt Khung/Logo)');
      return;
    }
    
    setProcessingVariantId(variantId)
    
    // BƯỚC 1: Xử lý Logo
    setNotification('⏳ Đang ghép Logo vào ảnh gốc...')
    const genResult = await api.generateAvatar(variantId)
    if (!genResult.success) {
      setNotification('')
      alert('Lỗi ghép Logo: ' + genResult.message)
      setProcessingVariantId(null)
      return;
    }

    // BƯỚC 2: Đồng bộ Shopee
    setNotification('⏳ Đang khởi động trình duyệt đăng bài Shopee...')
    const result = await api.syncShopee(variantId)
    if (result.success) {
      setNotification('✅ Đã đồng bộ thành công lên Shopee!')
    } else {
      setNotification('')
      alert('Lỗi đồng bộ Shopee: ' + result.message)
    }
    
    setProcessingVariantId(null)
    setTimeout(() => setNotification(''), 5000)
  }

  const loadModels = async () => {
    const data = await api.getModels()

    // --- BẮT ĐẦU THUẬT TOÁN SẮP XẾP TÙY CHỈNH ---
    const sortedData = data.sort((a: any, b: any) => {
      const nameA = a.name.toUpperCase();
      const nameB = b.name.toUpperCase();

      const getBaseName = (name: string) => name.replace(/\s*-\s*(DT|DD|DS).*/, '').trim();
      const baseA = getBaseName(nameA);
      const baseB = getBaseName(nameB);

      if (baseA < baseB) return -1;
      if (baseA > baseB) return 1;

      const getWeight = (name: string) => {
        if (name.includes('- DT')) return 1; // DT ưu tiên số 1 (Nằm trên cùng)
        if (name.includes('- DD')) return 2; // DD ưu tiên số 2
        if (name.includes('- DS')) return 3; // DS ưu tiên số 3
        return 4; // Những mã khác thì vứt xuống cuối
      };

      return getWeight(nameA) - getWeight(nameB);
    });
    // --- KẾT THÚC THUẬT TOÁN ---

    setModels([...sortedData])
  }

  const handleSaveModel = async () => {
    if (newModelName.trim() !== '') {
      try {
        await api.createModel(newModelName.trim())
        setNewModelName(''); setShowInput(false); loadModels()
      } catch (error: any) {
        alert('Lỗi: ' + error.message)
      }
    }
  }

  const handleSelectModel = async (model: any) => {
    setSelectedModel(model)
    setVariantSearchQuery('') // Reset thanh tìm kiếm biến thể khi chọn Model mới
    const data = await api.getVariants(model.id)
    setVariants(data)
  }

  const handleAddVariant = async () => {
    if (!newVariant.color || !newVariant.sku) return alert("Vui lòng nhập màu và SKU!")
    await api.createVariant({ ...newVariant, modelId: selectedModel.id })
    setNewVariant({ color: '', sku: '', price: 0, shopeeProductId: '' })
    const data = await api.getVariants(selectedModel.id)
    setVariants(data)
  }

  const handleDeleteModel = async (id: string, name: string) => {
    if (window.confirm(`XÓA CẢNH BÁO: Bạn có chắc muốn xóa Model "${name}" không?\n(Toàn bộ màu sắc bên trong cũng sẽ bị xóa vĩnh viễn!)`)) {
      await api.deleteModel(id)
      if (selectedModel?.id === id) setSelectedModel(null) // Reset cột phải nếu đang mở
      loadModels()
    }
  }

  const handleDeleteVariant = async (id: string, color: string) => {
    if (window.confirm(`Xóa màu "${color}" này?`)) {
      await api.deleteVariant(id)
      const data = await api.getVariants(selectedModel.id)
      setVariants(data)
    }
  }

  const handleImportExcel = async () => {
    setIsImporting(true)
    const result = await api.importExcel()
    if (result.success) {
      setNotification(`🎉 Nhập thành công ${result.count} sản phẩm!`)
      setTimeout(() => setNotification(''), 4000)
      loadModels()
      if (selectedModel) handleSelectModel(selectedModel)
    } else if (result.message !== 'Đã hủy') {
      alert('Lỗi nhập Excel: ' + result.message)
    }
    setIsImporting(false)
  }

  const handleImportSapoExcel = async () => {
    setIsImporting(true)
    setSapoProgress({ current: 0, total: 100 })
    const result = await api.importSapoExcel()
    if (result.success) {
      setNotification(`🎉 Đã đồng bộ hoàn hảo ${result.count} mã từ Sapo!`)
      setTimeout(() => setNotification(''), 5000)
      loadModels() 
      if (selectedModel) handleSelectModel(selectedModel)
    } else if (result.message !== 'Đã hủy') {
      alert('Lỗi nhập Sapo: ' + result.message)
    }
    setIsImporting(false)
    setSapoProgress(null)
  }

  const handleCheckMissingShopee = async () => {
    const data = await api.getMissingShopeeVariants()
    setMissingVariants(data)
    setShowMissingModal(true)
  }

  const handleUpdateShopeeIds = async () => {
    setIsImporting(true)
    setNotification('⏳ Đang cập nhật ID Shopee từ file...')
    const result = await api.updateShopeeIdsFromFile()
    if (result.success) {
      setNotification(`🎉 ${result.message}`)
      setTimeout(() => setNotification(''), 4000)
      if (selectedModel) {
         const data = await api.getVariants(selectedModel.id)
         setVariants(data)
      }
    } else {
      alert('Lỗi cập nhật ID Shopee: ' + result.message)
      setNotification('')
    }
    setIsImporting(false)
  }

  const handleImportShopeeIdsCustomExcel = async () => {
    setIsImporting(true)
    setNotification('⏳ Đang phân tích file Excel mã ẩn từ Shopee...')
    const result = await api.importShopeeIdsCustomExcel()
    if (result.success) {
      setNotification(`🎉 ${result.message}`)
      setTimeout(() => setNotification(''), 5000)
      loadModels()
      if (selectedModel) {
         const data = await api.getVariants(selectedModel.id)
         setVariants(data)
      }
    } else if (result.message !== 'Đã hủy chọn file.') {
      alert('Lỗi nhập Excel: ' + result.message)
      setNotification('')
    } else {
      setNotification('')
    }
    setIsImporting(false)
  }

  const handleDeleteAll = async () => {
    if (window.confirm('⚠️ CẢNH BÁO NGUY HIỂM:\nBạn có chắc chắn muốn XÓA SẠCH toàn bộ Model và Biến thể không?\nHành động này không thể hoàn tác!')) {
      await api.deleteAllModels()
      setSelectedModel(null)
      setVariants([])
      loadModels()
      alert('Đã dọn sạch toàn bộ cơ sở dữ liệu!')
    }
  }
  // Calculation for stats and filtering
  const totalVariants = models.reduce((sum: number, m: any) => sum + (m.variants?.length || 0), 0);
  const totalSyncedVariants = models.reduce((sum: number, m: any) => sum + (m.variants?.filter((v: any) => v.shopeeProductId)?.length || 0), 0);
  const syncPercentage = totalVariants === 0 ? 0 : (totalSyncedVariants / totalVariants) * 100;

  const displayModels = models.filter((m: any) => {
    const total = m.variants?.length || 0;
    const synced = m.variants?.filter((v: any) => v.shopeeProductId)?.length || 0;
    if (filterType === 'synced' && synced === 0) return false;
    if (filterType === 'unsynced' && synced === total && total > 0) return false;
    return true;
  });

  const renderExpandedContent = (model: any) => {
    return (
      <div className="p-6 bg-[#0B0F19] shadow-inner animate-in slide-in-from-top-2 duration-200 cursor-default border-t border-[#2D3349]/50" onClick={(e) => e.stopPropagation()}>
        {/* Variants List */}
        <div className="w-full">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold text-[#94A3B8] uppercase tracking-wider">Các SKU (Biến thể)</h4>
            <span className="text-xs text-[#515C67]">Preview Logo Overlay</span>
          </div>
          
          <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {model.variants?.map((v: any) => (
              <div key={v.id} className="bg-[#12141C] border border-[#2D3349]/60 rounded-xl p-4 flex flex-col sm:flex-row gap-4 items-center hover:border-[#00F5FF]/50 transition-colors">
                <div className="flex-1 w-full min-w-0">
                  <div className="font-bold text-white text-sm truncate">{v.color}</div>
                  <div className="text-[10px] text-[#94A3B8] font-mono mt-1 truncate">
                    SKU: {v.sku} {v.isAvatar && <span className="text-[#00F5FF] font-bold ml-1" title="Ảnh đại diện (AVT) cho bộ">* (AVT)</span>}
                  </div>
                </div>
                
                <div className="flex items-center gap-6 shrink-0">
                  {/* Raw Image */}
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-[9px] text-[#515C67] font-bold uppercase tracking-widest">Ảnh gốc</span>
                    <div className="w-16 h-16 rounded-xl bg-[#0B0F19] border border-[#2D3349] overflow-hidden">
                      {v.rawImage ? <img src={safeFileUrl(v.rawImage)} className="w-full h-full object-contain" /> : <span className="text-[10px] text-[#515C67] flex h-full items-center justify-center">N/A</span>}
                    </div>
                  </div>
                  
                  <div className="text-[#2D3349] font-light">➜</div>
                  
                  {/* Preview Image */}
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-[9px] text-[#00F5FF] font-bold uppercase tracking-widest drop-shadow-[0_0_8px_rgba(0,245,255,0.5)]">Sau Logo</span>
                    <div className="w-16 h-16 rounded-xl bg-[#0B0F19] border border-[#00F5FF]/40 overflow-hidden relative shadow-[0_0_15px_rgba(0,245,255,0.1)] cursor-pointer hover:border-[#00F5FF] hover:scale-105 transition-all group" onClick={() => handleOpenWatermarkModal(v)}>
                      {v.rawImage ? (
                        <>
                          <img src={safeFileUrl(v.rawImage)} className="w-full h-full object-contain" />
                          {watermarkPath && <img src={safeFileUrl(watermarkPath)} onLoad={(e) => setWatermarkAspectRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} className="absolute z-10 pointer-events-none drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]" style={{ top: watermarkY + '%', left: watermarkX + '%', width: watermarkScale + '%',  }} />}
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity z-20">
                             <span className="text-[8px] text-white font-bold bg-[#00F5FF]/20 border border-[#00F5FF]/50 px-1.5 py-0.5 rounded">SỬA LOGO</span>
                          </div>
                        </>
                      ) : <span className="text-[10px] text-[#515C67] flex h-full items-center justify-center">N/A</span>}
                    </div>
                  </div>
                  
                  {/* Sync SKU Button */}
                  <div className="ml-4 pl-4 border-l border-[#2D3349]/50 flex items-center">
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleSyncShopee(v.id); }}
                      className="px-4 py-2.5 bg-gradient-to-r from-[#00F5FF] to-[#00B8FF] text-black font-bold text-xs rounded-lg hover:shadow-[0_0_15px_rgba(0,245,255,0.3)] hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                      AUTO SYNC
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {(!model.variants || model.variants.length === 0) && (
               <div className="text-center text-[#515C67] text-xs py-8 bg-[#12141C] rounded-xl border border-[#2D3349]/30">Không có biến thể nào</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="shopee-manager-wrapper p-4 md:p-8 text-white min-h-[calc(100vh-60px)] bg-[#0A0A0B] font-sans selection:bg-[#FF4D8D]/30 relative pb-32">
      
      {/* Floating Navigation Tabs */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 glass-panel rounded-2xl p-1.5 flex gap-1 shadow-[0_0_40px_rgba(0,245,255,0.1)] border border-[#2D3349]/80 bg-[#0B0F19]/90 backdrop-blur-xl">
        <button 
          onClick={() => setActiveTab('dashboard')}
          className={`flex items-center gap-2 py-2.5 px-6 rounded-xl transition-all duration-300 font-bold text-xs uppercase tracking-wider ${
            activeTab === 'dashboard' ? 'bg-[#00F5FF]/10 text-[#00F5FF] shadow-[inset_0_0_20px_rgba(0,245,255,0.1)] border border-[#00F5FF]/20' : 'text-[#94A3B8] hover:text-white hover:bg-white/5'
          }`}
        >
          Data
        </button>
        <button 
          onClick={() => setActiveTab('products')}
          className={`flex items-center gap-2 py-2.5 px-6 rounded-xl transition-all duration-300 font-bold text-xs uppercase tracking-wider ${
            activeTab === 'products' ? 'bg-[#00F5FF]/10 text-[#00F5FF] shadow-[inset_0_0_20px_rgba(0,245,255,0.1)] border border-[#00F5FF]/20' : 'text-[#94A3B8] hover:text-white hover:bg-white/5'
          }`}
        >
          Models
        </button>
        <button 
          onClick={() => setActiveTab('sync')}
          className={`flex items-center gap-2 py-2.5 px-6 rounded-xl transition-all duration-300 font-bold text-xs uppercase tracking-wider ${
            activeTab === 'sync' ? 'bg-[#00F5FF]/10 text-[#00F5FF] shadow-[inset_0_0_20px_rgba(0,245,255,0.1)] border border-[#00F5FF]/20' : 'text-[#94A3B8] hover:text-white hover:bg-white/5'
          }`}
        >
          Logs
        </button>
        <button 
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-2 py-2.5 px-6 rounded-xl transition-all duration-300 font-bold text-xs uppercase tracking-wider ${
            activeTab === 'settings' ? 'bg-[#00F5FF]/10 text-[#00F5FF] shadow-[inset_0_0_20px_rgba(0,245,255,0.1)] border border-[#00F5FF]/20' : 'text-[#94A3B8] hover:text-white hover:bg-white/5'
          }`}
        >
          Config
        </button>
      </div>

      {/* Main Content Area */}
              {showWatermarkModal && selectedVariantForWatermark && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#121624] border border-[#2D3349] rounded-2xl w-full max-w-4xl flex flex-col max-h-[90vh] overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-[#2D3349] flex justify-between items-center bg-[#0B0F19]">
                <h3 className="text-xl font-bold text-white flex items-center gap-3">
                  <svg className="w-6 h-6 text-[#00F5FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Chỉnh Vị Trí Logo (Watermark)
                </h3>
                <button onClick={() => setShowWatermarkModal(false)} className="text-[#94A3B8] hover:text-white transition-colors">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex gap-6">
                {/* Editor Area */}
                <div className="w-[450px] shrink-0 bg-[#0A0A0B] border border-[#2D3349] rounded-xl overflow-hidden relative group cursor-crosshair"
                     style={{ height: '450px' }}
                     onClick={(e) => {
                       const rect = e.currentTarget.getBoundingClientRect()
                       const x = ((e.clientX - rect.left) / rect.width) * 100
                       const y = ((e.clientY - rect.top) / rect.height) * 100
                       setWatermarkX(x)
                       setWatermarkY(y)
                     }}>
                  <img src={safeFileUrl(selectedVariantForWatermark.rawImage)} className="w-full h-full object-contain pointer-events-none" />
                  {watermarkPath && (
                    <img src={safeFileUrl(watermarkPath)}
                                       onLoad={(e) => setWatermarkAspectRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
                                       className="absolute object-contain pointer-events-none drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]"
                         style={{ 
                           top: watermarkY + '%', 
                           left: watermarkX + '%', 
                           width: watermarkScale + '%',
                            
                         }} />
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <span className="bg-black/80 text-white px-4 py-2 rounded-lg text-sm font-medium border border-white/10 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
                      Click vào hình để ghim Logo
                    </span>
                  </div>
                </div>

                {/* Controls */}
                <div className="w-72 flex flex-col gap-6">
                  <div className="bg-[#0B0F19] border border-[#2D3349] rounded-xl p-5 space-y-4 shadow-[0_4px_20px_rgba(0,0,0,0.2)]">
                    <div>
                      <div className="text-sm font-medium text-[#94A3B8] mb-2 flex justify-between">
                        <span>Kích thước Logo (px)</span>
                      </div>
                      <div className="flex items-center text-[#00F5FF] bg-black/30 rounded-lg border border-[#2D3349] p-3">
                         <input type="number" step="1" value={Math.round((watermarkScale / 100) * 800)} onChange={(e) => {
                           setWatermarkScale((parseFloat(e.target.value) || 0) / 800 * 100);
                         }} className="w-full bg-transparent text-center font-mono text-2xl outline-none border-b border-[#00F5FF]/30 focus:border-[#00F5FF] focus:bg-[#00F5FF]/10 rounded-sm" />
                         <span className="text-sm font-mono ml-2 text-[#515C67]">px</span>
                      </div>
                    </div>
                    
                    <div className="pt-4 border-t border-[#2D3349]">
                      <label className="text-sm font-medium text-[#94A3B8] mb-3 block">Tọa độ góc trái-trên (trên khung 800×800):</label>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-black/30 rounded-lg border border-[#2D3349] p-3 text-center flex flex-col items-center">
                          <div className="text-[10px] text-[#515C67] font-bold tracking-widest uppercase mb-1">X (Left)</div>
                          <div className="flex items-center text-[#00F5FF]">
                             <input type="number" step="1" value={Math.round((watermarkX / 100) * 800)} onChange={(e) => {
                               setWatermarkX((parseFloat(e.target.value) || 0) / 800 * 100);
                             }} className="w-16 bg-transparent text-center font-mono text-lg outline-none border-b border-[#00F5FF]/30 focus:border-[#00F5FF] focus:bg-[#00F5FF]/10 rounded-sm" />
                             <span className="text-xs font-mono ml-1 text-[#515C67]">px</span>
                          </div>
                        </div>
                        <div className="bg-black/30 rounded-lg border border-[#2D3349] p-3 text-center flex flex-col items-center">
                          <div className="text-[10px] text-[#515C67] font-bold tracking-widest uppercase mb-1">Y (Top)</div>
                          <div className="flex items-center text-[#00F5FF]">
                             <input type="number" step="1" value={Math.round((watermarkY / 100) * 800)} onChange={(e) => {
                               setWatermarkY((parseFloat(e.target.value) || 0) / 800 * 100);
                             }} className="w-16 bg-transparent text-center font-mono text-lg outline-none border-b border-[#00F5FF]/30 focus:border-[#00F5FF] focus:bg-[#00F5FF]/10 rounded-sm" />
                             <span className="text-xs font-mono ml-1 text-[#515C67]">px</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-[10px] text-[#515C67] mt-2 text-center italic">Góc trái-trên của ảnh Logo trên canvas 800×800</div>
                    </div>
                    <div className="text-xs text-[#515C67] italic mt-2 text-center">
                      Mẹo: Click vào bất kỳ đâu trên ảnh đồng hồ, Logo sẽ tự động nhảy đến đó!
                    </div>
                  </div>

                  <button onClick={handleSaveWatermarkConfig} className="mt-auto bg-gradient-to-r from-[#00F5FF] to-[#00BFFF] text-black font-bold py-4 px-6 rounded-xl hover:opacity-90 hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(0,245,255,0.2)]">
                    Lưu cấu hình Logo
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="max-w-[1400px] mx-auto">
        
        {/* TAB 1: DASHBOARD (Data Management) */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
              <h1 className="text-3xl font-bold text-white tracking-tight">Data Management</h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* SAPO Import */}
              <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-3xl p-8 relative overflow-hidden group">
                <div className="flex items-start gap-4 mb-8">
                  <div className="w-12 h-12 rounded-xl bg-[#00F5FF]/10 flex items-center justify-center border border-[#00F5FF]/20 shrink-0">
                    <span className="text-[#00F5FF] text-xl">📄</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">SAPO File Import</h3>
                  </div>
                </div>

                <div className="relative">
                  <button onClick={handleImportSapoExcel} className="w-full bg-[#00F5FF] hover:bg-[#00E5EE] text-black font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 relative z-0 shadow-[0_0_20px_rgba(0,245,255,0.2)]">
                    <span className="text-lg">↑</span> Select File
                  </button>
                </div>
              </div>

              {/* Shopee Import */}
              <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-3xl p-8 relative overflow-hidden group">
                <div className="flex items-start gap-4 mb-8">
                  <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center border border-green-500/20 shrink-0">
                    <span className="text-green-500 text-xl">🏪</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">Shopee File Import</h3>
                  </div>
                </div>

                <div className="relative">
                  <button onClick={handleImportShopeeIdsCustomExcel} className="w-full bg-[#00F5FF] hover:bg-[#00E5EE] text-black font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 relative z-0 shadow-[0_0_20px_rgba(0,245,255,0.2)]">
                    <span className="text-lg">☁</span> Upload Shopee Data
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Quick Operations */}
              <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-3xl p-6 md:col-span-2 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#94A3B8] flex items-center gap-2">
                  <span className="text-[#FF4D8D]">⚡</span> QUICK OPERATIONS
                </h3>
                
                <div className="space-y-3 pt-2">
                  <button 
                    onClick={handleCheckMissingShopee}
                    className="w-full bg-[#0B0F19] hover:bg-[#1A1D27] border border-[#2D3349] p-4 rounded-2xl flex items-center justify-between text-left transition-all"
                  >
                    <div>
                      <h4 className="text-sm font-bold text-white">Filter Unsynced</h4>
                      <p className="text-[11px] text-[#94A3B8] mt-0.5">View items pending synchronization</p>
                    </div>
                    <span className="text-[#94A3B8] font-bold">➔</span>
                  </button>

                  <button
                    onClick={handleDeleteAll}
                    className="w-full mt-4 bg-red-500/5 hover:bg-red-500/10 text-red-400 border border-red-500/20 p-4 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                  >
                    <span className="text-lg">🗑</span> Clear All Database Entries
                  </button>
                </div>
              </div>

              {/* Active Daemon */}
              <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-3xl p-6 flex flex-col items-center justify-center relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-tr from-green-500/5 to-transparent opacity-50"></div>
                <div className="w-16 h-16 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center mb-6">
                  <span className="text-green-500 text-2xl">🛡</span>
                </div>
                <span className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-widest">ACTIVE DAEMON</span>
                <span className="text-2xl font-bold text-green-500 mt-1 tracking-tight">ONLINE</span>
                <span className="text-[9px] text-[#94A3B8] mt-6 font-mono">horologist_main_process</span>
              </div>
            </div>

            {/* System Log Mini */}
            <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-2xl overflow-hidden">
               <div className="bg-[#0B0F19] px-5 py-3 border-b border-[#2D3349]/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 block animate-pulse"></span>
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#94A3B8]">SYSTEM LOG</h3>
                  </div>
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2D3349]"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2D3349]"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2D3349]"></span>
                  </div>
               </div>
               <div className="p-5 font-mono text-[11px] text-[#94A3B8] min-h-[120px] bg-[#0A0A0B] space-y-1.5">
                  <div className="text-[#94A3B8]"><span className="opacity-50">[10:42:01]</span> System initialized. Awaiting commands...</div>
                  {watermarkPath && <div className="text-green-400"><span className="opacity-50 text-[#94A3B8]">[10:46:00]</span> Watermark image loaded successfully from local storage.</div>}
                  {hasShopeeCookies && <div className="text-green-400"><span className="opacity-50 text-[#94A3B8]">[10:46:10]</span> Shopee Login Cookie session successfully reconciled.</div>}
                  {isImporting && <div className="text-[#00F5FF]"><span className="opacity-50 text-[#94A3B8]">[11:02:44]</span> Reading and processing Excel file streams...</div>}
                  {sapoProgress && <div className="text-[#FF4D8D]"><span className="opacity-50 text-[#94A3B8]">[11:05:12]</span> ALERT: Syncing SAPO items {sapoProgress.current}/{sapoProgress.total}.</div>}
               </div>
            </div>
          </div>
        )}

        {/* TAB 2: SETTINGS (Configuration) */}
        {activeTab === 'settings' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
              <h1 className="text-3xl font-bold text-white tracking-tight">Configuration & Platform Credentials</h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Column: Watermark */}
              <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-3xl p-8 flex flex-col">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#94A3B8] flex items-center gap-2 mb-6">
                  <span className="text-[#FF4D8D]">🖼</span> WATERMARK OVERLAY FRAME
                </h3>

                <div className="border border-dashed border-[#2D3349] rounded-3xl bg-[#0B0F19]/50 flex-1 min-h-[300px] flex flex-col items-center justify-center p-8 mb-6 relative group overflow-hidden">
                   {watermarkPath ? (
                      <img src={safeFileUrl(watermarkPath)} className="max-w-full max-h-full object-contain p-4 group-hover:scale-105 transition-transform duration-500" />
                   ) : (
                      <div className="text-center text-[#2D3349]">
                        <span className="text-6xl block mb-4">👑</span>
                        <p className="font-bold tracking-widest uppercase">VUA ĐỒNG HỒ</p>
                      </div>
                   )}
                </div>

                <div className="relative">
                  <button onClick={handleSelectWatermark} className="w-full bg-[#FF4D8D] hover:bg-[#FF669D] text-white font-bold py-4 rounded-xl transition-all shadow-[0_0_20px_rgba(255,77,141,0.2)] flex items-center justify-center gap-2 relative z-0">
                    <span className="text-lg">↑</span> Chọn khung ảnh (.png)
                  </button>
                </div>
              </div>

              {/* Right Column: APIs & Connections */}
              <div className="space-y-6">
                
                <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-3xl p-6">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#94A3B8] flex items-center gap-2 mb-4">
                    <span className="text-[#00E676]">🤖</span> GEMINI AI KEY MANAGER
                    <span className="ml-auto bg-green-500/10 text-green-500 border border-green-500/20 px-2 py-0.5 rounded text-[9px]">ĐÃ NẠP</span>
                  </h3>
                  
                  <div className="flex gap-2 mb-4">
                    <div className="flex-1 bg-[#0B0F19] border border-[#2D3349] rounded-xl flex items-center px-4">
                       <input 
                         type={showGeminiKey ? "text" : "password"} 
                         value={geminiApiKey} 
                         onChange={(e) => setGeminiApiKey(e.target.value)} 
                         className="bg-transparent border-none outline-none text-white text-sm w-full font-mono placeholder-[#2D3349]"
                         placeholder="AIzaSyA..."
                       />
                       <span 
                         className="text-[#94A3B8] cursor-pointer hover:text-white transition-colors select-none" 
                         onClick={() => setShowGeminiKey(!showGeminiKey)}
                         title={showGeminiKey ? 'Ẩn Key' : 'Hiện Key'}
                       >{showGeminiKey ? '🙈' : '👁'}</span>
                    </div>
                    <button onClick={handleSaveGeminiKey} className="bg-[#FF4D8D] hover:bg-[#FF669D] text-white font-bold px-6 py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(255,77,141,0.3)]">
                      Lưu Key
                    </button>
                  </div>
                  <a href="#" className="text-[10px] text-[#00F5FF] hover:underline flex items-center gap-1">
                    <span>⚡</span> Nhấn vào đây để đăng ký nhận API Key miễn phí từ Google AI Studio
                  </a>
                </div>

                <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-3xl p-6">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#94A3B8] flex items-center gap-2 mb-4">
                    <span className="text-white">🧠</span> OPENAI BACKUP API
                  </h3>
                  
                  <div className="flex gap-2">
                    <input 
                      type={showOpenaiKey ? "text" : "password"} 
                      value={openaiApiKey} 
                      onChange={(e) => setOpenaiApiKey(e.target.value)} 
                      className="flex-1 bg-[#0B0F19] border border-[#2D3349] rounded-xl px-4 text-sm text-white font-mono placeholder-[#2D3349]"
                      placeholder="sk-proj-..."
                    />
                    <button onClick={handleSaveOpenAiKey} className="bg-[#FF4D8D] hover:bg-[#FF669D] text-white font-bold px-6 py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(255,77,141,0.3)]">
                      Lưu Key
                    </button>
                  </div>
                </div>

                <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-3xl p-6">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#94A3B8] flex items-center gap-2 mb-6">
                    <span className="text-[#FF4D8D]">🛍</span> SHOPEE MERCHANT CONNECTION
                    {hasShopeeCookies && (
                      <span className="ml-auto bg-green-500/10 text-green-500 border border-green-500/20 px-2 py-0.5 rounded-full text-[9px] flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> CONNECTED
                      </span>
                    )}
                  </h3>
                  
                  <div className="bg-[#0B0F19] border border-[#2D3349] rounded-2xl p-6 relative overflow-hidden">
                    <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-[#2D3349]/20 to-transparent pointer-events-none"></div>
                    <div className="absolute -right-4 top-1/2 -translate-y-1/2 text-[#2D3349]/40 text-7xl">⎈</div>
                    
                    <button onClick={handleShopeeLogin} className="w-full sm:w-auto bg-[#FF4D8D] hover:bg-[#FF669D] text-white font-bold py-3 px-8 rounded-xl transition-all flex items-center justify-center gap-2 mx-auto relative z-10 shadow-[0_0_15px_rgba(255,77,141,0.3)]">
                      <span className="text-lg">🔄</span> Refresh Cookie Session
                    </button>
                    {hasShopeeCookies && (
                      <p className="text-center text-[10px] text-[#515C67] mt-4 font-mono">Last synced: Just now</p>
                    )}
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SYNC LOGS */}
        {activeTab === 'sync' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col h-[calc(100vh-140px)]">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 shrink-0">
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight">System Synchronization Logs</h1>
                <p className="text-[#94A3B8] mt-2 text-sm">Real-time terminal output for active connections.</p>
              </div>
              <div className="flex gap-3">
                <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-xl px-4 py-2 flex items-center gap-3">
                  <span className="text-[10px] font-bold text-[#94A3B8] uppercase">AUTO-SYNC</span>
                  <div className={`w-8 h-4 rounded-full relative cursor-pointer transition-colors ${isAutoSyncing ? 'bg-[#00F5FF]' : 'bg-[#2D3349]'}`}>
                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isAutoSyncing ? 'right-0.5' : 'left-0.5'}`}></div>
                  </div>
                </div>
                <input 
                  type="text" 
                  value={priorityModel} 
                  onChange={(e) => setPriorityModel(e.target.value)} 
                  placeholder="Nhập tên Model ưu tiên chạy trước (VD: 751G)" 
                  className="bg-[#12141C] border border-[#2D3349]/60 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#515C67] w-64 focus:outline-none focus:border-[#00F5FF]/50"
                />
                <button onClick={handleFullAutoSync} disabled={isAutoSyncing} className={`border px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors ${isAutoSyncing ? 'bg-[#2D3349]/50 text-[#515C67] border-[#2D3349]/30 cursor-not-allowed' : 'bg-green-500/10 text-green-500 border-green-500/30 hover:bg-green-500/20'}`}>
                  <span>⚡</span> {isAutoSyncing ? 'Running...' : 'Run Auto'}
                </button>
                {isAutoSyncing && (
                  <button onClick={handleStopAutoSync} className="bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors">
                    <span>🛑</span> Stop
                  </button>
                )}
                <button onClick={() => setAutoSyncLog([])} className="bg-[#12141C] text-[#94A3B8] hover:text-white border border-[#2D3349]/60 hover:bg-[#2D3349] px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors">
                  <span>🗑</span> Clear
                </button>
              </div>
            </div>

            <div className="flex-1 bg-[#0A0A0B] border border-[#2D3349]/60 rounded-2xl overflow-hidden flex flex-col shadow-2xl relative">
              {/* Terminal Header */}
              <div className="bg-[#12141C] px-4 py-3 border-b border-[#2D3349]/50 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5 mr-4">
                    <span className="w-3 h-3 rounded-full bg-[#FF5F56]"></span>
                    <span className="w-3 h-3 rounded-full bg-[#FFBD2E]"></span>
                    <span className="w-3 h-3 rounded-full bg-[#27C93F]"></span>
                  </div>
                  <span className="text-green-500 text-xs">●</span>
                  <span className="text-xs font-mono text-[#94A3B8]">bash — horologist_sync_daemon</span>
                </div>
                <div className="flex gap-3 text-[#515C67]">
                   <span className="cursor-pointer hover:text-white">🔍</span>
                   <span className="cursor-pointer hover:text-white">⚙</span>
                </div>
              </div>

              {/* Terminal Body */}
              <div className="flex-1 p-6 font-mono text-[13px] text-[#94A3B8] overflow-y-auto space-y-2 leading-relaxed" ref={logContainerRef}>
                  {autoSyncLog.map((log, i) => {
                     const isError = log.includes('ERROR') || log.includes('Lỗi');
                     const isSuccess = log.includes('SUCCESS') || log.includes('hoàn hảo') || log.includes('thành công');
                     const isInfo = log.includes('INFO');
                     return (
                        <div key={i}>
                          <span className="opacity-50 mr-3">[{new Date().toLocaleTimeString()}]</span>
                          <span className={`mr-2 font-bold ${isError ? 'text-[#FF4D8D]' : isSuccess ? 'text-green-500' : isInfo ? 'text-[#00F5FF]' : 'text-[#94A3B8]'}`}>
                             {isError ? 'ERROR' : isSuccess ? 'SUCCESS' : isInfo ? 'INFO' : 'PROC'}
                          </span>
                          <span className={isError ? 'text-[#FF4D8D]' : 'text-[#94A3B8]'}>{log}</span>
                        </div>
                     )
                  })}
                  
                  {notification && <div><span className="opacity-50 mr-3">[{new Date().toLocaleTimeString()}]</span> <span className="text-yellow-400 font-bold mr-2">WARN</span>{notification}</div>}
                  {isImporting && <div><span className="opacity-50 mr-3">[{new Date().toLocaleTimeString()}]</span> <span className="text-[#00F5FF] font-bold mr-2">PROC</span>Reading excel file...</div>}
                  {sapoProgress && <div><span className="opacity-50 mr-3">[{new Date().toLocaleTimeString()}]</span> <span className="text-[#00F5FF] font-bold mr-2">PROC</span>Importing SAPO item {sapoProgress.current}/{sapoProgress.total}...</div>}
                  
                  {autoSyncLog.length === 0 && !isAutoSyncing && !isImporting && !sapoProgress && !notification && (
                    <div className="italic opacity-40 mt-4">No active synchronization logs. Trigger FULL AUTO SYNC to watch real-time console telemetry.</div>
                  )}
                  {(isAutoSyncing || isImporting || sapoProgress) && (
                    <div className="mt-4"><span className="opacity-50 mr-3">[{new Date().toLocaleTimeString()}]</span> <span className="animate-pulse bg-[#94A3B8] w-2 h-4 inline-block align-middle"></span></div>
                  )}
              </div>

              {/* Terminal Footer */}
              <div className="bg-[#12141C] px-4 py-1.5 border-t border-[#2D3349]/50 flex items-center justify-between shrink-0">
                 <div className="flex items-center gap-6 text-[9px] font-bold text-[#515C67] tracking-widest uppercase">
                    <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> OPERATIONAL</span>
                    <span>NODE: US-EAST-1</span>
                    <span>QUEUE: 0</span>
                 </div>
                 <div className="text-[9px] font-bold text-[#515C67] tracking-widest uppercase">UTF-8</div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: PRODUCTS */}
        {activeTab === 'products' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight">Model Directory</h1>
              </div>
              <button 
                onClick={() => setShowInput(!showInput)}
                className="bg-[#FF4D8D] hover:bg-[#FF669D] text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-colors flex items-center gap-2 shrink-0 shadow-[0_0_20px_rgba(255,77,141,0.2)]"
              >
                <span className="text-lg">+</span> Add Model
              </button>
            </div>

            {showInput && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex justify-center items-center">
                <div className="bg-[#12141C] border border-[#2D3349] rounded-3xl p-8 max-w-md w-full mx-4 shadow-2xl relative animate-in zoom-in-95 duration-200">
                  <button onClick={() => setShowInput(false)} className="absolute top-6 right-6 text-[#94A3B8] hover:text-white text-2xl">×</button>
                  <h2 className="text-2xl font-bold text-white mb-6">Add New Model</h2>
                  <div className="mb-6">
                    <label className="block text-sm font-bold text-[#94A3B8] uppercase tracking-widest mb-2">Model Name</label>
                    <input 
                      type="text" 
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      placeholder="e.g. Casio G-Shock"
                      className="w-full bg-[#0B0F19] border border-[#2D3349] rounded-xl px-4 py-3 text-white placeholder-[#2D3349] outline-none focus:border-[#FF4D8D] transition-colors"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveModel()}
                    />
                  </div>
                  <button 
                    onClick={handleSaveModel}
                    className="w-full bg-[#FF4D8D] hover:bg-[#FF669D] text-white font-bold py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(255,77,141,0.2)]"
                  >
                    Save Model
                  </button>
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="flex items-center gap-1 bg-[#12141C] border border-[#2D3349]/60 p-1.5 rounded-2xl w-fit">
              <button onClick={() => setFilterType('all')} className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors ${filterType === 'all' ? 'bg-[#007BFF] text-white' : 'text-[#94A3B8] hover:text-white hover:bg-white/5'}`}>ALL</button>
              <button onClick={() => setFilterType('unsynced')} className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors ${filterType === 'unsynced' ? 'bg-[#007BFF] text-white' : 'text-[#94A3B8] hover:text-white hover:bg-white/5'}`}>UNSYNCED</button>
              <button onClick={() => setFilterType('synced')} className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors ${filterType === 'synced' ? 'bg-[#007BFF] text-white' : 'text-[#94A3B8] hover:text-white hover:bg-white/5'}`}>SYNCED</button>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
               <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-3xl p-6">
                 <div className="flex justify-between items-start mb-4">
                   <h4 className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-widest">ACTIVE SKUS</h4>
                   <span className="text-[#FF4D8D] text-lg">📦</span>
                 </div>
                 <div className="text-3xl font-bold text-white tracking-tight">{models.reduce((sum, m) => sum + m.variants.length, 0).toLocaleString()}</div>
                 <div className="text-green-500 text-[10px] font-bold mt-2 flex items-center gap-1">
                   <span>↗</span> +12% this month
                 </div>
               </div>
               
               <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-3xl p-6">
                 <div className="flex justify-between items-start mb-4">
                   <h4 className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-widest">SYNC STATUS</h4>
                    <span className="text-green-500 text-lg">⇄</span>
                 </div>
                 <div className="text-3xl font-bold text-white tracking-tight">{syncPercentage.toFixed(1)}%</div>
                 <div className="text-[#94A3B8] text-[10px] font-bold mt-2 flex items-center gap-1">
                   {syncPercentage === 100 ? (
                     <><span className="text-green-500">✓</span> Fully synced</>
                   ) : (
                     <><span className="text-yellow-500">⚠</span> Partial sync pending</>
                   )}
                 </div>
               </div>
            </div>

            {/* Table */}
            <div className="bg-[#12141C] border border-[#2D3349]/60 rounded-3xl overflow-hidden">
               <div className="px-6 py-5 border-b border-[#2D3349]/50 flex justify-between items-center bg-[#0B0F19]/50">
                 <div className="flex items-center gap-3">
                   <h2 className="text-lg font-bold text-white">Inventory Assets</h2>
                   <span className="bg-[#2D3349] text-[#94A3B8] text-[10px] font-bold px-2 py-0.5 rounded-full">{models.length} ITEMS</span>
                 </div>
                 <div className="flex gap-2">
                   <button onClick={() => setViewMode('list')} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-[#2D3349] text-white shadow-md' : 'bg-[#2D3349]/50 hover:bg-[#2D3349] text-[#94A3B8]'}`} title="List View">≡</button>
                   <button onClick={() => setViewMode('grid')} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${viewMode === 'grid' ? 'bg-[#2D3349] text-white shadow-md' : 'bg-[#2D3349]/50 hover:bg-[#2D3349] text-[#94A3B8]'}`} title="Grid View">⊞</button>
                 </div>
               </div>

               {viewMode === 'list' ? (
                 <div className="overflow-x-auto">
                   <table className="w-full text-left border-collapse">
                     {displayModels.map(model => {
                       const totalV = model.variants?.length || 0;
                       const syncedV = model.variants?.filter((v: any) => v.shopeeProductId)?.length || 0;
                       const syncRatio = totalV === 0 ? 0 : (syncedV / totalV) * 100;
                       const isExpanded = selectedModel?.id === model.id;
                       
                       return (
                       <tbody key={model.id} className="divide-y divide-[#2D3349]/30 border-b border-[#2D3349]/50">
                       <tr onClick={() => setSelectedModel(isExpanded ? null : model)} className={`transition-colors cursor-pointer group ${isExpanded ? 'bg-[#2D3349]/20' : 'hover:bg-white/[0.02]'}`}>
                         <td className="px-6 py-4">
                           <div className="flex items-center gap-4">
                             <div className="w-10 h-10 rounded-xl bg-[#0B0F19] border border-[#2D3349] flex items-center justify-center overflow-hidden shrink-0 relative">
                               {model.variants?.[0]?.avatarImage || model.variants?.[0]?.rawImage ? (
                                  <>
                                    <img src={safeFileUrl(model.variants[0].avatarImage || model.variants[0].rawImage)} className="w-full h-full object-contain" />
                                    {watermarkPath && (
                                      <img src={safeFileUrl(watermarkPath)} onLoad={(e) => setWatermarkAspectRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} className="absolute z-10 pointer-events-none drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]" style={{ top: watermarkY + '%', left: watermarkX + '%', width: watermarkScale + '%',  }} />
                                    )}
                                  </>
                               ) : (
                                  <span className="text-[#515C67] text-xs">📷</span>
                               )}
                             </div>
                             <div>
                               <div className="font-bold text-sm text-white group-hover:text-[#00F5FF] transition-colors">{model.name}</div>
                               <div className="text-[10px] text-[#515C67] font-mono mt-0.5">ID: {model.id}</div>
                             </div>
                           </div>
                         </td>
                         <td className="px-6 py-4">
                           <span className="bg-[#2D3349]/30 border border-[#2D3349] text-[#94A3B8] text-[10px] font-mono px-2 py-1 rounded">{model.variants?.[0]?.sku || 'NO-SKU'}</span>
                         </td>
                         <td className="px-6 py-4">
                           <div className="text-xs font-bold text-white mb-1">{model.variants?.length * 10 || 0} units</div>
                           <div className="w-24 h-1 bg-[#2D3349] rounded-full overflow-hidden">
                             <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${syncRatio}%` }}></div>
                           </div>
                         </td>
                         <td className="px-6 py-4">
                           <div className="flex items-center gap-2">
                             <span className={`w-1.5 h-1.5 rounded-full ${syncRatio === 100 ? 'bg-green-500' : syncRatio > 0 ? 'bg-yellow-500' : 'bg-[#FF4D8D]'}`}></span>
                             <span className={`text-xs font-bold ${syncRatio === 100 ? 'text-green-500' : syncRatio > 0 ? 'text-yellow-500' : 'text-[#FF4D8D]'}`}>
                               {syncRatio === 100 ? 'Operational' : syncRatio > 0 ? 'Partial' : 'Unsynced'}
                             </span>
                           </div>
                         </td>
                         <td className="px-6 py-4 text-right">
                           <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button className="w-8 h-8 rounded-lg hover:bg-[#2D3349] flex items-center justify-center text-[#94A3B8] hover:text-white transition-colors" title="History">🕒</button>
                           </div>
                         </td>
                       </tr>
                       {isExpanded && (
                         <tr>
                           <td colSpan={5} className="p-0 border-0">
                             {renderExpandedContent(model)}
                           </td>
                         </tr>
                       )}
                       </tbody>
                     )})}
                     {displayModels.length === 0 && (
                       <tbody>
                        <tr>
                           <td colSpan={5} className="px-6 py-12 text-center text-[#515C67] text-sm">
                              No models available matching criteria.
                           </td>
                        </tr>
                       </tbody>
                     )}
                 </table>
               </div>
               ) : (
                 <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                   {displayModels.map(model => {
                     const totalV = model.variants?.length || 0;
                     const syncedV = model.variants?.filter((v: any) => v.shopeeProductId)?.length || 0;
                     const syncRatio = totalV === 0 ? 0 : (syncedV / totalV) * 100;
                     const isExpanded = selectedModel?.id === model.id;

                     return (
                       <div key={model.id} className={`bg-[#0B0F19] border border-[#2D3349] rounded-2xl overflow-hidden hover:border-[#00F5FF]/50 transition-colors group relative cursor-pointer ${isExpanded ? 'col-span-full' : ''}`} onClick={() => setSelectedModel(isExpanded ? null : model)}>
                         {/* Card Header */}
                         <div className="p-5 flex items-start gap-4 border-b border-[#2D3349]/50">
                           <div className="w-16 h-16 rounded-xl bg-[#12141C] border border-[#2D3349] flex items-center justify-center overflow-hidden shrink-0 relative">
                             {model.variants?.[0]?.avatarImage || model.variants?.[0]?.rawImage ? (
                                <>
                                  <img src={safeFileUrl(model.variants[0].avatarImage || model.variants[0].rawImage)} className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500" />
                                  {watermarkPath && (
                                    <img src={safeFileUrl(watermarkPath)} onLoad={(e) => setWatermarkAspectRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} className="absolute z-10 pointer-events-none drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]" style={{ top: watermarkY + '%', left: watermarkX + '%', width: watermarkScale + '%',  }} />
                                  )}
                                </>
                             ) : (
                                <span className="text-[#515C67] text-xs">⌚</span>
                             )}
                           </div>
                           <div className="flex-1 min-w-0">
                             <div className="flex justify-between items-start">
                               <div className="truncate">
                                 <div className="font-bold text-white group-hover:text-[#00F5FF] transition-colors truncate">{model.name}</div>
                                 <div className="text-xs text-[#94A3B8] font-mono mt-0.5">{model.variants?.[0]?.sku || 'NO-SKU'}</div>
                               </div>
                               <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                 <button className="w-6 h-6 rounded bg-[#2D3349]/50 hover:bg-[#2D3349] flex items-center justify-center text-[#94A3B8] hover:text-white transition-colors" title="Edit Model" onClick={(e) => { e.stopPropagation(); alert('Tính năng sửa Model đang được phát triển.'); }}>✏️</button>
                                 <button className="w-6 h-6 rounded bg-[#2D3349]/50 hover:bg-[#2D3349] flex items-center justify-center text-[#94A3B8] hover:text-white transition-colors" title="Sync History" onClick={(e) => { e.stopPropagation(); alert('Tính năng xem lịch sử đồng bộ đang được phát triển.'); }}>🕒</button>
                               </div>
                             </div>
                             
                             <div className="mt-3 flex items-center justify-between">
                               <div className="text-[10px] font-bold text-[#94A3B8]">{totalV * 10} units</div>
                               <div className="flex items-center gap-1.5">
                                 <span className={`w-1 h-1 rounded-full ${syncRatio === 100 ? 'bg-green-500' : syncRatio > 0 ? 'bg-yellow-500' : 'bg-[#FF4D8D]'}`}></span>
                                 <span className={`text-[10px] font-bold ${syncRatio === 100 ? 'text-green-500' : syncRatio > 0 ? 'text-yellow-500' : 'text-[#FF4D8D]'}`}>
                                   {syncRatio === 100 ? '100%' : syncRatio > 0 ? `${syncRatio.toFixed(0)}%` : '0%'}
                                 </span>
                               </div>
                             </div>
                             <div className="w-full h-1 bg-[#2D3349] rounded-full mt-1.5 overflow-hidden">
                               <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${syncRatio}%` }}></div>
                             </div>
                           </div>
                         </div>
                         
                         {/* Card Expanded Variants */}
                         {isExpanded && renderExpandedContent(model)}
                       </div>
                     )
                   })}
                 </div>
               )}
            </div>
            
          </div>
        )}
      </div>
    </div>
  );

}

export default App;

