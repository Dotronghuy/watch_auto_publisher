import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Cloud, Settings, Share2, Search, Pause, Terminal, Image as ImageIcon, BrainCircuit, FileText, UploadCloud, RotateCcw, Trash2, FlaskConical, X, MessageSquare, Camera, Zap, CheckCircle, Palette, PenTool, Maximize } from 'lucide-react';
import Swal from 'sweetalert2';
import { useAuth } from '../context/AuthContext';
import './Workflow.css';

const INITIAL_NODES = {
  source: { id: 'source', x: 40, y: 150 },
  gpt: { id: 'gpt', x: 370, y: 30 },
  gemini: { id: 'gemini', x: 670, y: 150 },
  publish: { id: 'publish', x: 980, y: 150 },
};

const INITIAL_PROMPTS = {
  gpt: 'Tạo 4-6 ảnh mới với góc nhìn và ánh sáng khác nhau, giữ phong cách luxury, 8k resolution.',
  gemini_post: 'Viết caption SEO cho sản phẩm đồng hồ dưới đây theo phong cách sang trọng, có emoji, kêu gọi hành động.',
  gemini_video: 'Viết kịch bản TikTok/Shorts 30 giây cho sản phẩm đồng hồ này. Hook mạnh đầu tiên, thể hiện sự sang trọng.',
};

const NODE_WIDTH = 230;
const NODE_HEIGHT_SOURCE = 190;
const NODE_HEIGHT_GPT = 170;
const NODE_HEIGHT_GEMINI = 220;
const NODE_HEIGHT_PUBLISH = 110;

// Đọc vị trí node đã lưu từ localStorage
const getSavedNodes = () => {
  try {
    const saved = localStorage.getItem('workflow_node_positions');
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return INITIAL_NODES;
};

const Workflow = () => {
  const { hasPermission } = useAuth();
  const [logs, setLogs] = useState([]);
  const [imageGallery, setImageGallery] = useState([]);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [previewFB, setPreviewFB] = useState(null);
  const [previewIG, setPreviewIG] = useState(null);
  const [previewTH, setPreviewTH] = useState(null);
  const [liveMonitorTab, setLiveMonitorTab] = useState('outputs');
  const [isMonitorOpen, setIsMonitorOpen] = useState(true);
  const [isGPTActive, setIsGPTActive] = useState(false);
  const [nodes, setNodes] = useState(getSavedNodes);
  const [nodeHeights, setNodeHeights] = useState({ source: NODE_HEIGHT_SOURCE, gpt: NODE_HEIGHT_GPT, gemini: NODE_HEIGHT_GEMINI, publish: NODE_HEIGHT_PUBLISH });
  const nodeRefs = useRef({ source: null, gpt: null, gemini: null, publish: null });
  const [prompts, setPrompts] = useState(INITIAL_PROMPTS);
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [mdFiles, setMdFiles] = useState({ gpt: [], gemini: [] });
  const [mdUploading, setMdUploading] = useState(false);
  const [uploadingNode, setUploadingNode] = useState(null);
  const mdFileInputRef = useRef(null);
  const sampleImgInputRef = useRef(null);
  // Dry Run state
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState(null);
  const [showDryRunModal, setShowDryRunModal] = useState(false);
  const [dryRunImgIdx, setDryRunImgIdx] = useState(0);
  const [dryRunTab, setDryRunTab] = useState('fb'); // 'fb' | 'ig'
  const [trainMode, setTrainMode] = useState(null); // null | 'image' | 'content' | 'full'
  const [showTestTonesModal, setShowTestTonesModal] = useState(false);
  const [testTonesProgress, setTestTonesProgress] = useState(null);
  const [testTonesResults, setTestTonesResults] = useState([]);
  const [activeBranch, setActiveBranch] = useState(null); // null | 1 | 2 | 3 — nhánh đang chạy
  // Sample images state
  const [sampleImages, setSampleImages] = useState([]);
  const [sampleImgUploading, setSampleImgUploading] = useState(false);
  const [skuCode, setSkuCode] = useState('');
  const [prioritySkus, setPrioritySkus] = useState('');
  const [isAiIdle, setIsAiIdle] = useState(true);
  // Canvas transform state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const terminalEndRef = useRef(null);
  const canvasRef = useRef(null);
  const dragging = useRef(null);   // { nodeId, startX, startY }
  const panning  = useRef(null);   // { startX, startY, originX, originY }
  const spaceHeld = useRef(false);

  // ─── LẤY DANH SÁCH & UPLOAD FILE .MD ───
  const fetchMdFiles = useCallback(async (nodeId) => {
    try {
      const res = await fetch(`/api/prompt-md-files/${nodeId}`);
      if (res.ok) {
        const data = await res.json();
        setMdFiles(prev => ({ ...prev, [nodeId]: data.files }));
      }
    } catch (e) {
      console.error('Lỗi lấy danh sách file:', e);
    }
  }, []);

  useEffect(() => {
    fetchMdFiles('gpt');
    fetchMdFiles('gemini');
    fetchSampleImages();
    fetch('/api/settings').then(res => res.json()).then(data => {
      if (data.prioritySkus) setPrioritySkus(data.prioritySkus);
    }).catch(e => console.error(e));
  }, [fetchMdFiles]);

  const autoSaveSettings = async (updates) => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    } catch (e) {
      console.error('Lỗi auto save:', e);
    }
  };

  const handleRunNow = async () => {
    try {
      Swal.fire({
        title: 'Đang khởi chạy',
        text: 'Đang bắt đầu tiến trình đăng bài thật...',
        icon: 'info',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000
      });
      await fetch('/api/trigger-workflow', { method: 'POST' });
    } catch (e) {
      console.error(e);
      Swal.fire('Lỗi', 'Không thể khởi chạy luồng công việc', 'error');
    }
  };

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const data = await res.json();
          setIsAiIdle(data.aiIdle);
          if (data.aiIdle) {
            setDryRunLoading(false);
            setTrainMode(null);
          }
        }
      } catch (e) {}
    };
    const timer = setInterval(checkHealth, 3000);
    checkHealth();
    return () => clearInterval(timer);
  }, []);

  // ─── QUẢN LÝ ẢNH MẬu THAM CHIỪu ───
  const fetchSampleImages = async () => {
    try {
      const res = await fetch('/api/sample-images');
      if (res.ok) { const d = await res.json(); setSampleImages(d.files || []); }
    } catch (e) { console.error('Lỗi lấy danh sách ảnh mẫu:', e); }
  };

  const handleSampleImgUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setSampleImgUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) formData.append('images', files[i]);
      const res = await fetch('/api/sample-images', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        Swal.fire({ title: '✅ Đã tải ảnh mẫu lên!', text: data.message, icon: 'success', background: 'var(--color-surface)', color: 'white', toast: true, position: 'top-end', timer: 3000, showConfirmButton: false });
        fetchSampleImages();
      } else throw new Error(data.message);
    } catch (err) {
      Swal.fire({ title: 'Lỗi upload ảnh mẫu', text: err.message, icon: 'error', background: 'var(--color-surface)', color: 'white' });
    } finally {
      setSampleImgUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteSampleImg = async (filename) => {
    try {
      const res = await fetch(`/api/sample-images/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (res.ok) fetchSampleImages();
    } catch (err) { console.error(err); }
  };

  const handleUploadClick = (nodeId) => {
    setUploadingNode(nodeId);
    mdFileInputRef.current?.click();
  };

  const handleMdFileChange = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !uploadingNode) return;
    
    setMdUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('mdFiles', files[i]);
      }
      
      const res = await fetch(`/api/upload-prompt-md/${uploadingNode}`, { 
        method: 'POST', 
        body: formData 
      });
      const data = await res.json();
      if (res.ok) {
        Swal.fire({ title: '✅ Tải lên thành công!', text: data.message, icon: 'success', background: 'var(--color-surface)', color: 'white', toast: true, position: 'top-end', timer: 3000, showConfirmButton: false });
        fetchMdFiles(uploadingNode);
      } else {
        throw new Error(data.message || 'Upload thất bại');
      }
    } catch (err) {
      Swal.fire({ title: 'Lỗi upload', text: err.message, icon: 'error', background: 'var(--color-surface)', color: 'white' });
    } finally {
      setMdUploading(false);
      setUploadingNode(null);
      e.target.value = ''; // reset
    }
  };

  const handleDeleteMdFile = async (nodeId, filename) => {
    try {
      const res = await fetch(`/api/prompt-md-files/${nodeId}/${filename}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        fetchMdFiles(nodeId);
      } else {
        Swal.fire({ title: 'Lỗi', text: data.message, icon: 'error', background: 'var(--color-surface)', color: 'white', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAutoFit = useCallback(() => {
    if (!canvasRef.current) return;
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const padding = 60;
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    Object.keys(nodes).forEach(key => {
      const node = nodes[key];
      const width = 280; // Estimated node width
      const height = nodeHeights[key] || 250;
      if (node.x < minX) minX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.x + width > maxX) maxX = node.x + width;
      if (node.y + height > maxY) maxY = node.y + height;
    });

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    if (contentWidth <= 0 || contentHeight <= 0) return;

    const scaleX = (canvasRect.width - padding * 2) / contentWidth;
    const scaleY = (canvasRect.height - padding * 2) / contentHeight;
    let newScale = Math.min(scaleX, scaleY, 1);
    newScale = Math.max(0.2, newScale);
    newScale = +(newScale.toFixed(2));

    const centerX = (canvasRect.width - contentWidth * newScale) / 2;
    const centerY = (canvasRect.height - contentHeight * newScale) / 2;

    setTransform({
      x: centerX - minX * newScale,
      y: centerY - minY * newScale,
      scale: newScale
    });
  }, [nodes, nodeHeights]);

  useEffect(() => {
    const timer = setTimeout(() => handleAutoFit(), 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const eventSource = new EventSource('/api/logs/stream');
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Khôi phục lịch sử khi kết nối lại
        if (data.type === 'history') {
           setLogs(data.logs);
           
           // Khôi phục thư viện ảnh AI (loại bỏ trùng lặp)
           const images = data.logs.filter(l => l.image).map(l => l.image);
           const uniqueImages = [...new Set(images)];
           setImageGallery(uniqueImages);
           if (uniqueImages.length > 0) setCarouselIdx(uniqueImages.length - 1);
           
           // Khôi phục nội dung Gemini
           const previewsFB = data.logs.filter(l => l.fbContent).map(l => l.fbContent);
           if (previewsFB.length > 0) setPreviewFB(previewsFB[previewsFB.length - 1]);
           
           const previewsIG = data.logs.filter(l => l.igContent).map(l => l.igContent);
           if (previewsIG.length > 0) setPreviewIG(previewsIG[previewsIG.length - 1]);
           
           const previewsTH = data.logs.filter(l => l.thContent).map(l => l.thContent);
           if (previewsTH.length > 0) setPreviewTH(previewsTH[previewsTH.length - 1]);
           
           setTimeout(() => terminalEndRef.current?.scrollIntoView({ behavior: 'auto' }), 100);
           return;
        }

        // Logic xử lý log bình thường (real-time)
        setLogs(prev => [...prev, data]);
        setTimeout(() => terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        if (data.sender === 'GPT-4 Vision' && data.type !== 'success') setIsGPTActive(true);
        else if (data.sender === 'GPT-4 Vision' && data.type === 'success') setIsGPTActive(false);
        
        // Detect nhánh đang chạy từ log
        if (data.message) {
          if (data.message.includes('[AI]') || data.message.includes('Chế độ AI')) setActiveBranch(1);
          else if (data.message.includes('[ALBUM]') || data.message.includes('Chế độ ALBUM')) setActiveBranch(2);
          else if (data.message.includes('[REELS]') || data.message.includes('Chế độ REELS')) setActiveBranch(3);
          // Reset khi luồng kết thúc
          if (data.message.includes('Hoàn tất') || data.message.includes('thất bại') || data.message.includes('Đã dừng')) setActiveBranch(null);
        }

        // Xử lý ảnh: thêm vào gallery và nhảy tới ảnh mới nhất
        if (data.image) {
          setImageGallery(prev => {
            // tránh duplicate
            if (prev.includes(data.image)) return prev;
            const next = [...prev, data.image];
            setCarouselIdx(next.length - 1); // nhảy tới ảnh mới nhất
            return next;
          });
        }
        if (data.fbContent) setPreviewFB(data.fbContent);
        if (data.igContent) setPreviewIG(data.igContent);
        if (data.thContent) setPreviewTH(data.thContent);
      } catch (e) { console.error('SSE Error:', e); }
    };
    return () => eventSource.close();
  }, []);

  // ─── DRAG NODE ───
  const onMouseDown = useCallback((e, nodeId) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    if (spaceHeld.current) return; // để pan xử lý
    e.preventDefault();
    e.stopPropagation();
    // startX/Y là vị trí chuột trong toạ độ "world" (trước scale)
    dragging.current = {
      nodeId,
      startX: (e.clientX - transform.x) / transform.scale - nodes[nodeId].x,
      startY: (e.clientY - transform.y) / transform.scale - nodes[nodeId].y,
    };
  }, [nodes, transform]);

  // ─── PAN + DRAG + ZOOM ───
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        spaceHeld.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
      }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') {
        spaceHeld.current = false;
        panning.current = null;
        if (canvasRef.current) canvasRef.current.style.cursor = '';
      }
    };

    const onMouseMove = (e) => {
      if (panning.current) {
        const dx = e.clientX - panning.current.startX;
        const dy = e.clientY - panning.current.startY;
        // Capture trước khi setTransform chạy async (tránh lỗi null ref)
        const originX = panning.current.originX;
        const originY = panning.current.originY;
        setTransform(prev => ({ ...prev, x: originX + dx, y: originY + dy }));
        return;
      }
      if (!dragging.current) return;
      const { nodeId, startX, startY } = dragging.current;
      const wx = (e.clientX - transform.x) / transform.scale - startX;
      const wy = (e.clientY - transform.y) / transform.scale - startY;
      setNodes(prev => ({ ...prev, [nodeId]: { ...prev[nodeId], x: wx, y: wy } }));
    };

    const onMouseDownGlobal = (e) => {
      if (spaceHeld.current) {
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        panning.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y };
      }
    };

    const onMouseUp = () => {
      // Lưu vị trí node khi thả chuột
      if (dragging.current) {
        setNodes(prev => {
          try { localStorage.setItem('workflow_node_positions', JSON.stringify(prev)); } catch (e) {}
          return prev;
        });
      }
      dragging.current = null;
      panning.current = null;
      if (canvasRef.current && spaceHeld.current) canvasRef.current.style.cursor = 'grab';
    };

    // Zoom bằng scroll
    const onWheel = (e) => {
      if (!canvasRef.current) return;
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left; // vị trí chuột trong canvas
      const my = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      setTransform(prev => {
        const newScale = Math.min(3, Math.max(0.2, prev.scale * delta));
        // zoom vào điểm dưới chuột
        const newX = mx - (mx - prev.x) * (newScale / prev.scale);
        const newY = my - (my - prev.y) * (newScale / prev.scale);
        return { x: newX, y: newY, scale: newScale };
      });
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDownGlobal);
    window.addEventListener('mouseup', onMouseUp);
    canvasRef.current?.addEventListener('wheel', onWheel, { passive: false });
    const ref = canvasRef.current;
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDownGlobal);
      window.removeEventListener('mouseup', onMouseUp);
      ref?.removeEventListener('wheel', onWheel);
    };
  }, [transform]);

  // ───────────────── ĐO CHIỀU CAO THỰC TẾ CỦA NODE ─────────────────
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const newHeights = {};
      for (const key of ['source', 'gpt', 'gemini', 'publish']) {
        const el = nodeRefs.current[key];
        if (el) newHeights[key] = el.offsetHeight;
      }
      if (Object.keys(newHeights).length > 0) {
        setNodeHeights(prev => ({ ...prev, ...newHeights }));
      }
    });
    for (const key of ['source', 'gpt', 'gemini', 'publish']) {
      if (nodeRefs.current[key]) observer.observe(nodeRefs.current[key]);
    }
    return () => observer.disconnect();
  }, []);

  // ───────────────── TÍNH TOÁN CÁC ĐIỂM NỐI ─────────────────
  const cubicPath = (from, to) => {
    const cx = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} C ${cx} ${from.y}, ${cx} ${to.y}, ${to.x} ${to.y}`;
  };

  const { source, gpt, gemini, publish } = nodes;
  const hS = nodeHeights.source, hG = nodeHeights.gpt, hM = nodeHeights.gemini, hP = nodeHeights.publish;

  // Tọa độ path = node.x/y + chiều cao thực * tỉ lệ port CSS
  // Source ports: 30%, 60%, 90%
  const path1_from = { x: source.x + NODE_WIDTH, y: source.y + hS * 0.30 };
  const path2_from = { x: source.x + NODE_WIDTH, y: source.y + hS * 0.60 };
  const path3_from = { x: source.x + NODE_WIDTH, y: source.y + hS * 0.90 };

  // GPT port-in: 50%, port-out: 50%
  const path1_to   = { x: gpt.x, y: gpt.y + hG * 0.50 };
  const pathGPT_from = { x: gpt.x + NODE_WIDTH, y: gpt.y + hG * 0.50 };

  // Gemini ports-in: 30%, 70%, 90% | port-out: 50%
  const pathGPT_to   = { x: gemini.x, y: gemini.y + hM * 0.30 };
  const path2_to     = { x: gemini.x, y: gemini.y + hM * 0.70 };
  const path3_to     = { x: gemini.x, y: gemini.y + hM * 0.90 };
  const pathPub_from = { x: gemini.x + NODE_WIDTH, y: gemini.y + hM * 0.50 };

  // Publish port-in: 50%
  const pathPub_to = { x: publish.x, y: publish.y + hP * 0.50 };

  const handleSavePrompt = async (key, value) => {
    setPrompts(prev => ({ ...prev, [key]: value }));
    setEditingPrompt(null);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts: { ...prompts, [key]: value } })
      });
      Swal.fire({ title: 'Đã lưu Prompt!', toast: true, position: 'top-end', icon: 'success', showConfirmButton: false, timer: 1500, background: 'var(--color-surface)', color: 'var(--color-text)' });
    } catch (e) {}
  };

  // ─── DRY RUN ───
  const handleTestTones = () => {
    setShowTestTonesModal(true);
    setTestTonesResults([]);
    setTestTonesProgress({ message: 'Đang khởi tạo thử nghiệm...' });

    const source = new EventSource('/api/publish/test-tones');
    source.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      setTestTonesProgress(`Đang sinh phong cách: ${data.tone} (${data.index}/${data.total})...`);
    });
    source.addEventListener('result', (e) => {
      const data = JSON.parse(e.data);
      setTestTonesResults(prev => [...prev, data]);
    });
    source.addEventListener('done', () => {
      setTestTonesProgress(null);
      source.close();
    });
    source.addEventListener('error', (e) => {
      console.error('SSE Error', e);
      setTestTonesProgress(null);
      source.close();
    });
  };

  const handleDryRun = async () => {
    if (dryRunLoading) return;
    setDryRunLoading(true);
    setDryRunResult(null);
    setTrainMode('full');
    try {
      const res = await fetch('/api/dry-run', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Dry Run thất bại');
      setDryRunResult(data);
      setDryRunImgIdx(0);
      setDryRunTab('fb');
      setShowDryRunModal(true);
    } catch (err) {
      Swal.fire({
        title: '⚠️ Dry Run thất bại',
        text: err.message,
        icon: 'error',
        background: 'var(--color-surface)',
        color: 'white',
      });
    } finally {
      setDryRunLoading(false);
      setTrainMode(null);
    }
  };

  // ─── TRAIN IMAGE ONLY ───
  const handleTrainImage = async () => {
    if (dryRunLoading) return;
    setDryRunLoading(true);
    setDryRunResult(null);
    setTrainMode('image');
    try {
      const res = await fetch('/api/train-image', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: skuCode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Training ảnh thất bại');
      if (data.status === 'started') {
        Swal.fire({ icon: 'success', title: 'Đã Bắt Đầu!', text: data.message, background: 'var(--color-surface)', color: 'white' });
      } else if (data.trainMode === 'image' && data.images && data.images.length === 0) {
        Swal.fire({ icon: 'success', title: 'Đã Bắt Đầu!', text: data.message, background: 'var(--color-surface)', color: 'white' });
      } else if (data.images) {
        setDryRunResult(data);
        setDryRunImgIdx(0);
        setDryRunTab('fb');
        setShowDryRunModal(true);
      } else {
        Swal.fire({ icon: 'success', title: 'Thành Công!', text: data.message || 'Tiến trình hoàn tất', background: 'var(--color-surface)', color: 'white' });
      }
    } catch (err) {
      Swal.fire({
        title: '⚠️ Training ảnh thất bại',
        text: err.message,
        icon: 'error',
        background: 'var(--color-surface)',
        color: 'white',
      });
    } finally {
      setDryRunLoading(false);
      setTrainMode(null);
    }
  };

  // ─── TRAIN CONTENT ONLY ───
  const handleTrainContent = async () => {
    if (dryRunLoading) return;
    setDryRunLoading(true);
    setDryRunResult(null);
    setTrainMode('content');
    try {
      const res = await fetch('/api/train-content', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Training content thất bại');
      setDryRunResult(data);
      setDryRunImgIdx(0);
      setDryRunTab('fb');
      setShowDryRunModal(true);
    } catch (err) {
      Swal.fire({
        title: '⚠️ Training content thất bại',
        text: err.message,
        icon: 'error',
        background: 'var(--color-surface)',
        color: 'white',
      });
    } finally {
      setDryRunLoading(false);
      setTrainMode(null);
    }
  };

  const handleRejectPrompt = async () => {
    const currentImg = dryRunResult.images[dryRunImgIdx];
    if (!currentImg || !currentImg.prompt) {
      Swal.fire({ icon: 'info', title: 'Không có prompt', text: 'Ảnh này không phải do AI tạo hoặc không có prompt đi kèm.', background: 'var(--color-surface)', color: 'white' });
      return;
    }

    const confirm = await Swal.fire({
      title: '🗑️ Xóa cảnh gốc?',
      text: 'Hệ thống sẽ xóa vĩnh viễn bối cảnh đã tạo ra ảnh này khỏi file cấu hình, đồng thời "mắng" AI để nó bỏ phong cách này đi.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Xóa Vĩnh Viễn!',
      cancelButtonText: 'Hủy',
      background: 'var(--color-surface)',
      color: 'white',
      confirmButtonColor: '#ef4444'
    });

    if (!confirm.isConfirmed) return;

    try {
      const res = await fetch('/api/delete-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptText: currentImg.prompt })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || data.error);

      Swal.fire({
        title: 'Thành công',
        text: 'Đã đào thải bối cảnh lỗi và nhắc nhở AI!',
        icon: 'success',
        background: 'var(--color-surface)',
        color: 'white'
      });

      setDryRunResult(prev => {
        const newImages = [...prev.images];
        newImages.splice(dryRunImgIdx, 1);
        return { ...prev, images: newImages, imageCount: newImages.length };
      });
      if (dryRunImgIdx >= dryRunResult.images.length - 1) {
        setDryRunImgIdx(Math.max(0, dryRunImgIdx - 1));
      }
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Lỗi', text: err.message, background: 'var(--color-surface)', color: 'white' });
    }
  };

  const handleSendFeedback = async () => {
    const currentImg = dryRunResult.images[dryRunImgIdx];
    if (!currentImg || !currentImg.prompt) {
      Swal.fire({ icon: 'info', title: 'Không có prompt', text: 'Ảnh này không có bối cảnh gốc để nhận xét.', background: 'var(--color-surface)', color: 'white' });
      return;
    }

    const { value: formValues } = await Swal.fire({
      title: '💬 Nhận xét cho AI',
      html: `
        <div style="text-align:left;">
          <label style="font-size:12px; color:#aaa; display:block; margin-bottom:6px;">Bạn muốn AI sửa đổi gì cho bối cảnh này?</label>
          <textarea id="swal-feedback-text" rows="3" placeholder="Ví dụ: Đổ bóng quá đậm, thiếu ánh sáng vàng..." style="width:100%; background:#1e1e1e; color:white; border:1px solid #444; border-radius:6px; padding:8px; font-size:13px; resize:vertical; outline:none; box-sizing:border-box; font-family:inherit;"></textarea>
          <label style="font-size:12px; color:#aaa; display:block; margin-top:12px; margin-bottom:6px;">📎 Upload ảnh mẫu để AI học theo (tùy chọn)</label>
          <div id="swal-upload-area" style="border:2px dashed rgba(168,85,247,0.4); border-radius:8px; padding:12px; text-align:center; cursor:pointer; transition:all 0.2s; background:rgba(168,85,247,0.05);">
            <input type="file" id="swal-feedback-file" accept="image/*" style="display:none;" />
            <div id="swal-upload-label" style="color:#c084fc; font-size:12px;">🖼️ Click hoặc kéo thả ảnh mẫu vào đây</div>
            <img id="swal-preview-img" style="display:none; max-height:120px; max-width:100%; margin-top:8px; border-radius:6px; border:1px solid rgba(168,85,247,0.3);" />
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Gửi Góp Ý',
      cancelButtonText: 'Hủy',
      background: 'var(--color-surface)',
      color: 'white',
      width: 480,
      focusConfirm: false,
      didOpen: () => {
        const textArea = document.getElementById('swal-feedback-text');
        const fileInput = document.getElementById('swal-feedback-file');
        const uploadArea = document.getElementById('swal-upload-area');
        const previewImg = document.getElementById('swal-preview-img');
        const uploadLabel = document.getElementById('swal-upload-label');

        textArea.focus();
        textArea.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            Swal.clickConfirm();
          }
        });

        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = '#a855f7'; uploadArea.style.background = 'rgba(168,85,247,0.12)'; });
        uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = 'rgba(168,85,247,0.4)'; uploadArea.style.background = 'rgba(168,85,247,0.05)'; });
        uploadArea.addEventListener('drop', (e) => {
          e.preventDefault();
          uploadArea.style.borderColor = 'rgba(168,85,247,0.4)';
          uploadArea.style.background = 'rgba(168,85,247,0.05)';
          if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            fileInput.dispatchEvent(new Event('change'));
          }
        });

        fileInput.addEventListener('change', () => {
          if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = (ev) => {
              previewImg.src = ev.target.result;
              previewImg.style.display = 'block';
              uploadLabel.innerHTML = `✅ ${file.name} (${(file.size / 1024).toFixed(0)}KB)`;
            };
            reader.readAsDataURL(file);
          }
        });
      },
      preConfirm: () => {
        const text = document.getElementById('swal-feedback-text').value;
        const file = document.getElementById('swal-feedback-file').files[0] || null;
        if (!text && !file) {
          Swal.showValidationMessage('Vui lòng nhập nhận xét hoặc upload ảnh mẫu!');
          return false;
        }
        return { text, file };
      }
    });

    if (!formValues) return;

    Swal.fire({
      title: 'Đang xử lý...',
      text: 'AI đang vẽ lại ảnh theo ý bạn. Vui lòng đợi khoảng 20-30s...',
      allowOutsideClick: false,
      background: 'var(--color-surface)',
      color: 'white',
      didOpen: () => {
        Swal.showLoading();
      }
    });

    try {
      const formData = new FormData();
      formData.append('promptText', currentImg.prompt);
      formData.append('feedbackText', formValues.text || '');
      formData.append('action', 'feedback');
      if (formValues.file) {
        formData.append('referenceImage', formValues.file);
      }

      const res = await fetch('/api/feedback-prompt', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      if (data.newImageUrl) {
        setDryRunResult(prev => {
          const newImages = [...prev.images];
          // Replace current image with the new generated image
          newImages[dryRunImgIdx] = { url: data.newImageUrl, prompt: currentImg.prompt };
          return { ...prev, images: newImages };
        });
      }

      Swal.fire({
        title: 'Thành công',
        text: 'AI đã tiếp thu và sinh lại ảnh mới!',
        icon: 'success',
        background: 'var(--color-surface)',
        color: 'white'
      });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Lỗi', text: err.message, background: 'var(--color-surface)', color: 'white' });
    }
  };

  return (
    <div className="workflow-page">
      <div className="workflow-content">
        <div className="canvas-area" ref={canvasRef}>

          {/* ── ZOOM CONTROLS ── */}
          <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 100, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={() => setTransform(p => ({ ...p, scale: Math.min(3, +(p.scale * 1.2).toFixed(2)) }))} style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(30,30,30,0.9)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Phóng to">+</button>
            <button onClick={() => setTransform(p => ({ ...p, scale: Math.max(0.2, +(p.scale * 0.8).toFixed(2)) }))} style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(30,30,30,0.9)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }} title="Thu nhỏ">−</button>
            <button onClick={() => setTransform({ x: 0, y: 0, scale: 1 })} style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,77,141,0.18)', border: '1px solid rgba(255,77,141,0.35)', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Đặt lại">1:1</button>
            <button onClick={handleAutoFit} style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(52,211,153,0.18)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Tự động vừa màn hình"><Maximize size={14}/></button>
          </div>

          {/* ── ZOOM LEVEL INDICATOR ── */}
          <div style={{ position: 'absolute', bottom: 16, left: 58, zIndex: 100, fontSize: '11px', color: 'var(--color-text-dim)', background: 'rgba(0,0,0,0.4)', padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)' }}>
            {Math.round(transform.scale * 100)}%
          </div>

          {/* ── SINGLE CANVAS CONTAINER (SVG + Nodes) ── */}
          <div style={{
            position: 'absolute', top: 0, left: 0,
            width: '4000px', height: '4000px',
            transformOrigin: '0 0',
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}>
            {/* SVG đường nối */}
            <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
              {/* Nhánh 1: Source → GPT */}
              <path d={cubicPath(path1_from, path1_to)} className={`path-line ${activeBranch === 1 ? 'active-path' : 'dim-path'}`} />
              <circle cx={path1_to.x} cy={path1_to.y} r={activeBranch === 1 ? 4 : 3} fill={activeBranch === 1 ? 'var(--color-primary)' : 'rgba(160,160,180,0.5)'} />

              {/* Nhánh 2: Source → Gemini (ảnh gốc) */}
              <path d={cubicPath(path2_from, path2_to)} className={`path-line ${activeBranch === 2 ? 'active-path' : 'dim-path'}`} />
              <circle cx={path2_to.x} cy={path2_to.y} r={activeBranch === 2 ? 4 : 3} fill={activeBranch === 2 ? 'var(--color-primary)' : 'rgba(160,160,180,0.5)'} />

              {/* Nhánh 3: Source → Gemini (video) */}
              <path d={cubicPath(path3_from, path3_to)} className={`path-line ${activeBranch === 3 ? 'active-path' : 'faint-path'}`} />
              <circle cx={path3_to.x} cy={path3_to.y} r={activeBranch === 3 ? 4 : 3} fill={activeBranch === 3 ? 'var(--color-primary)' : 'rgba(120,120,140,0.35)'} />

              {/* GPT → Gemini */}
              <path d={cubicPath(pathGPT_from, pathGPT_to)} className={`path-line ${activeBranch === 1 ? 'active-path' : 'dim-path'}`} />
              <circle cx={pathGPT_to.x} cy={pathGPT_to.y} r={activeBranch === 1 ? 4 : 3} fill={activeBranch === 1 ? 'var(--color-primary)' : 'rgba(160,160,180,0.5)'} />

              {/* Gemini → Publish */}
              <path d={cubicPath(pathPub_from, pathPub_to)} className={`path-line ${activeBranch ? 'active-path' : 'dim-path'}`} />
              <circle cx={pathPub_to.x} cy={pathPub_to.y} r={activeBranch ? 4 : 3} fill={activeBranch ? 'var(--color-primary)' : 'rgba(160,160,180,0.5)'} />
            </svg>

            {/* Nối node cards */}
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <div
                ref={el => nodeRefs.current.source = el}
                className="node-card drive-node"
                style={{ top: source.y, left: source.x, cursor: 'grab' }}
                onMouseDown={e => onMouseDown(e, 'source')}
              >
              <div className="node-header"><Cloud size={14} className="blue" /> Nguồn Dữ Liệu<div className="toggle active"></div></div>
              <div className="node-body">
                <div className="field">
                  <label>Nguồn</label>
                  <div className="value">Google Sheet + Google Drive</div>
                </div>
                <div className="field mt-2">
                  <label>Phân nhánh Thư mục</label>
              <div className="condition-pill" style={{borderLeft: `2px solid ${activeBranch === 1 ? 'var(--color-primary)' : '#555'}`, opacity: activeBranch === 1 ? 1 : 0.5}}>① Anh_AVT → Sinh 4-6 ảnh (GPT)</div>
                  <div className="condition-pill" style={{borderLeft: `2px solid ${activeBranch === 2 ? 'var(--color-primary)' : '#555'}`, opacity: activeBranch === 2 ? 1 : 0.5}}>② Anh_Hang/Tu_Chup → Random 4-8 ảnh</div>
                  <div className="condition-pill" style={{borderLeft: `2px solid ${activeBranch === 3 ? 'var(--color-primary)' : '#555'}`, opacity: activeBranch === 3 ? 1 : 0.4}}>③ Video_Doc → 1 ảnh → Kịch bản</div>
                </div>
              </div>
              <div className="port" style={{top:'30%', right:'-5px', background: activeBranch === 1 ? 'var(--color-primary)' : 'rgba(160,160,180,0.5)'}} title="Nhánh 1 AVT"></div>
              <div className="port" style={{top:'60%', right:'-5px', background: activeBranch === 2 ? 'var(--color-primary)' : undefined}} title="Nhánh 2 Ảnh Thật"></div>
              <div className="port" style={{top:'90%', right:'-5px', opacity: activeBranch === 3 ? 1 : 0.5, background: activeBranch === 3 ? 'var(--color-primary)' : undefined}} title="Nhánh 3 Video"></div>
            </div>{/* end node source */}

              {/* ───── NODE 2: GPT-4 VISION ───── */}
            <div
              ref={el => nodeRefs.current.gpt = el}
              className={`node-card gpt-node ${isGPTActive ? 'active-glow' : ''}`}
              style={{ top: gpt.y, left: gpt.x, cursor: 'grab' }}
              onMouseDown={e => onMouseDown(e, 'gpt')}
            >
              <div className="port" style={{top:'50%', left:'-5px'}} title="Input từ Nhánh 1"></div>
              <div className="node-header"><BrainCircuit size={14} className="pink" /> GPT-5.5 Version (Sinh Ảnh)</div>
              <div className="node-body">
                <div className="field" style={{marginBottom: '12px'}}>
                  <label>Mã SKU Sản phẩm</label>
                  <input
                    type="text"
                    placeholder="Nhập mã SKU (vd: SP01)..."
                    value={skuCode}
                    onChange={(e) => setSkuCode(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    style={{
                      width: '100%',
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(255,255,255,0.05)',
                      color: '#fff',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      outline: 'none',
                      marginTop: '4px',
                      transition: 'border-color 0.2s'
                    }}
                    onFocus={(e) => e.target.style.borderColor = 'var(--color-primary)'}
                    onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.05)'}
                  />
                </div>
                <div className="field">
                  <label>Trạng thái Prompt</label>
                  <div className="value prompt-preview" style={{ color: '#ffcc00', border: '1px dashed rgba(255, 204, 0, 0.3)', background: 'rgba(255, 204, 0, 0.05)', cursor: 'default' }}>
                    ⚠️ Bắt buộc: GPT sẽ tự động đọc cấu hình theo mã SKU từ file <b>.md</b> được tải lên bên dưới.
                  </div>
                </div>
                <div className="field">
                  <label>File Prompt hướng dẫn AI (.md)</label>
                  <input ref={mdFileInputRef} type="file" multiple accept=".md" style={{display:'none'}} onChange={handleMdFileChange} />
                  <div style={{display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px'}}>
                    {mdFiles.gpt.map(f => (
                      <div key={f.name} style={{fontSize:'10px', display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(255,255,255,0.05)', padding:'4px 6px', borderRadius:'4px', border: '1px solid rgba(255,255,255,0.05)'}}>
                        <span style={{color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '4px'}}><FileText size={10} /> {f.name}</span>
                        {!['gpt_image_prompt.md', 'gemini-prompt-template.md'].includes(f.name) && (
                          <Trash2 size={12} style={{cursor:'pointer', color:'#ff4d4d', opacity: 0.7}} onClick={() => handleDeleteMdFile('gpt', f.name)} title="Xóa" />
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn-upload-md"
                    onClick={() => handleUploadClick('gpt')}
                    disabled={mdUploading && uploadingNode === 'gpt'}
                    title="Thêm file .md cho node này"
                  >
                    <UploadCloud size={12} />
                    {mdUploading && uploadingNode === 'gpt' ? ' Đang tải...' : ' Tải lên file .md'}
                  </button>
                </div>

                {/* ── Ảnh mẫu tham chiếu ── */}
                <div className="field" style={{marginTop:'8px'}}>
                  <label style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                    <span>🖼️ Ảnh mẫu tham chiếu</span>
                    <span style={{
                      fontSize:'9px', padding:'1px 5px', borderRadius:'4px',
                      background: sampleImages.length > 0 ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.08)',
                      color: sampleImages.length > 0 ? '#34d399' : 'var(--color-text-dim)'
                    }}>
                      {sampleImages.length > 0 ? `${sampleImages.length} ảnh` : 'Chưa có'}
                    </span>
                  </label>

                  {/* Danh sách ảnh mẫu hiện có */}
                  {sampleImages.length > 0 && (
                    <div style={{
                      maxHeight: '90px', overflowY: 'auto', marginBottom: '6px',
                      background: 'rgba(0,0,0,0.2)', borderRadius: '4px', padding: '4px'
                    }}>
                      {sampleImages.map(f => (
                        <div key={f.name} style={{
                          display:'flex', alignItems:'center', justifyContent:'space-between',
                          padding:'2px 4px', borderRadius:'3px', marginBottom:'2px',
                          background:'rgba(255,255,255,0.04)', fontSize:'10px'
                        }}>
                          <span style={{color:'#d4d4d4', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1}} title={f.name}>
                            📷 {f.name}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteSampleImg(f.name); }}
                            onMouseDown={e => e.stopPropagation()}
                            style={{
                              background:'none', border:'none', color:'rgba(239,68,68,0.7)',
                              cursor:'pointer', padding:'0 2px', marginLeft:'4px', fontSize:'10px',
                              lineHeight:1, flexShrink:0
                            }}
                            title="Xóa ảnh mẫu này"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Nút upload và xóa ảnh mẫu */}
                  <div style={{display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px'}}>
                    <button
                      className="btn-upload-md"
                      style={{borderColor: 'rgba(52,211,153,0.3)', color:'#34d399', width: '100%'}}
                      onClick={(e) => { e.stopPropagation(); sampleImgInputRef.current?.click(); }}
                      onMouseDown={e => e.stopPropagation()}
                      disabled={sampleImgUploading}
                      title="Upload ảnh chụp thật (tay đeo đồng hồ, cảnh luxury...) để GPT dùng làm tham chiếu"
                    >
                      <ImageIcon size={12} />
                      {sampleImgUploading ? ' Đang tải...' : ' Thêm ảnh mẫu (JPG/PNG)'}
                    </button>
                    {sampleImages.length > 0 && (
                      <button
                        className="btn-upload-md"
                        style={{borderColor: 'rgba(239,68,68,0.3)', color:'#ef4444', width: '100%'}}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const confirm = await Swal.fire({
                            title: 'Xóa toàn bộ?',
                            text: 'Bạn có chắc chắn muốn xóa TẤT CẢ ảnh mẫu không?',
                            icon: 'warning',
                            showCancelButton: true,
                            confirmButtonText: 'Xóa Hết',
                            cancelButtonText: 'Hủy',
                            background: 'var(--color-surface)',
                            color: 'white',
                            confirmButtonColor: '#ef4444'
                          });
                          if(confirm.isConfirmed) {
                            for (let img of sampleImages) {
                              await handleDeleteSampleImg(img.name);
                            }
                            Swal.fire({ title: 'Đã xóa!', text: 'Đã xóa toàn bộ ảnh mẫu.', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000, background: 'var(--color-surface)', color: 'white' });
                          }
                        }}
                        onMouseDown={e => e.stopPropagation()}
                        title="Xóa toàn bộ ảnh mẫu hiện tại"
                      >
                        <Trash2 size={12} /> Xóa hết
                      </button>
                    )}
                  </div>
                  <input
                    ref={sampleImgInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    style={{display:'none'}}
                    onChange={handleSampleImgUpload}
                  />
                </div>
              </div>
              <div className="port" style={{top:'50%', right:'-5px'}} title="Output → Gemini"></div>
            </div>

            {/* ───── NODE 3: GEMINI 1.5 PRO ───── */}
            <div
              ref={el => nodeRefs.current.gemini = el}
              className="node-card gemini-node"
              style={{ top: gemini.y, left: gemini.x, cursor: 'grab' }}
              onMouseDown={e => onMouseDown(e, 'gemini')}
            >
              <div className="port" style={{top:'30%', left:'-5px', background:'var(--color-primary)'}} title="Input từ GPT"></div>
              <div className="port" style={{top:'70%', left:'-5px'}} title="Input từ Nhánh 2 (Ảnh gốc)"></div>
              <div className="port" style={{top:'90%', left:'-5px', opacity:0.5}} title="Input từ Nhánh 3 (Video)"></div>
              <div className="node-header"><Settings size={14} className="blue" /> GPT-5.5 Version (Sinh Content)</div>
              <div className="node-body">
                <div className="field">
                  <label>Trạng thái Cấu hình AI</label>
                  <div className="value prompt-preview" style={{ color: '#ffcc00', border: '1px dashed rgba(255, 204, 0, 0.3)', background: 'rgba(255, 204, 0, 0.05)', cursor: 'default' }}>
                    ⚠️ Chế độ tự động nâng cao: Phân luồng FB/IG, áp dụng luật marketing và đọc chân dung khách hàng từ các file <b>.md</b>.
                  </div>
                </div>
                <div className="field mt-2">
                  <label>File Hướng dẫn & Dữ liệu (.md)</label>
                  <div style={{display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px'}}>
                    {mdFiles.gemini.map(f => (
                      <div key={f.name} style={{fontSize:'10px', display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(255,255,255,0.05)', padding:'4px 6px', borderRadius:'4px', border: '1px solid rgba(255,255,255,0.05)'}}>
                        <span style={{color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '4px'}}><FileText size={10} /> {f.name}</span>
                        {!['gpt_image_prompt.md', 'gemini-prompt-template.md'].includes(f.name) && (
                          <Trash2 size={12} style={{cursor:'pointer', color:'#ff4d4d', opacity: 0.7}} onClick={() => handleDeleteMdFile('gemini', f.name)} title="Xóa" />
                        )}
                      </div>
                    ))}
                  </div>
            <div className="flex gap-1.5 mt-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-400">FB</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-pink-500/20 text-pink-400">IG</span>
              {/* <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white/20 text-white">TH</span> */}
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#E1306C]/20 text-[#E1306C]">IG</span>
            </div>
                  <button
                    className="btn-upload-md"
                    onClick={() => handleUploadClick('gemini')}
                    disabled={mdUploading && uploadingNode === 'gemini'}
                    title="Thêm file .md cho node này"
                  >
                    <UploadCloud size={12} />
                    {mdUploading && uploadingNode === 'gemini' ? ' Đang tải...' : ' Tải lên file .md'}
                  </button>
                </div>
              </div>
              <div className="port" style={{top:'50%', right:'-5px'}} title="Output → Publisher"></div>
            </div>

            {/* ───── NODE 4: PUBLISH ───── */}
            <div
              ref={el => nodeRefs.current.publish = el}
              className="node-card publish-node"
              style={{ top: publish.y, left: publish.x, cursor: 'grab', minHeight: NODE_HEIGHT_PUBLISH + 70 }}
              onMouseDown={e => onMouseDown(e, 'publish')}
            >
              <div className="port" style={{top:'50%', left:'-5px'}} title="Input từ Gemini"></div>
              <div className="node-header"><Share2 size={14} className="green" /> Đăng bài Đa kênh</div>
              <div className="node-body">
                <div className="field">
                  <label>Kênh đích</label>
                  <div className="tags">
                    <span className="tag fb">FB</span>
                    <span className="tag ig">IG</span>
                  </div>
                </div>
                <div className="field" style={{marginTop: '10px'}}>
                  <label>Mã SKU ưu tiên (Cách nhau bằng dấu phẩy)</label>
                  <input
                    type="text"
                    value={prioritySkus}
                    onChange={(e) => setPrioritySkus(e.target.value)}
                    onBlur={() => autoSaveSettings({ prioritySkus })}
                    style={{ width: '100%', padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', fontSize: '12px', marginTop: '4px' }}
                    placeholder="VD: CADISEN-123, BINGO-456"
                    onMouseDown={e => e.stopPropagation()}
                  />
                </div>
                <div className="field" style={{marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
                  <button
                    className="btn-dry-run"
                    onClick={(e) => { e.stopPropagation(); handleRunNow(); }}
                    onMouseDown={e => e.stopPropagation()}
                    disabled={!isAiIdle}
                    title={!isAiIdle ? "AI đang bận..." : "Chạy đăng bài thật NGAY LẬP TỨC"}
                    style={{flex: '1 1 100%', background: 'linear-gradient(to right, #10b981, #059669)', color: 'white', borderColor: '#059669', marginBottom: '6px'}}
                  >
                    <><Share2 size={13} /> Chạy Thật Ngay!</>
                  </button>
                  <button
                    id="btn-dry-run"
                    className="btn-dry-run"
                    onClick={(e) => { e.stopPropagation(); handleDryRun(); }}
                    onMouseDown={e => e.stopPropagation()}
                    disabled={dryRunLoading || !isAiIdle}
                    title={!isAiIdle ? "AI đang bận..." : "Chạy thử toàn bộ luồng AI nhưng KHÔNG đăng lên MXH"}
                    style={{flex: '1 1 100%'}}
                  >
                    {dryRunLoading && trainMode === 'full' ? (
                      <><span className="spin-icon">⟳</span> Đang chạy thử...</>
                    ) : (
                      <><FlaskConical size={13} /> Chạy Thử (Dry Run)</>
                    )}
                  </button>
                  <button
                    className="btn-dry-run btn-train-image"
                    onClick={(e) => { e.stopPropagation(); handleTrainImage(); }}
                    onMouseDown={e => e.stopPropagation()}
                    disabled={dryRunLoading || !isAiIdle}
                    title={!isAiIdle ? "AI đang bận..." : "Chỉ tạo ảnh GPT để training AI"}
                    style={{flex: '1 1 45%'}}
                  >
                    {dryRunLoading && trainMode === 'image' ? (
                      <><span className="spin-icon">⟳</span> Đang tạo ảnh...</>
                    ) : (
                      <><Palette size={13} /> Train Ảnh GPT</>
                    )}
                  </button>
                  <button
                    className="btn-dry-run btn-train-content"
                    onClick={(e) => { e.stopPropagation(); handleTrainContent(); }}
                    onMouseDown={e => e.stopPropagation()}
                    disabled={dryRunLoading || !isAiIdle}
                    title={!isAiIdle ? "AI đang bận..." : "Chỉ tạo content để training AI"}
                    style={{flex: '1 1 45%'}}
                  >
                    {dryRunLoading && trainMode === 'content' ? (
                      <><span className="spin-icon">⟳</span> Đang viết bài...</>
                    ) : (
                      <><PenTool size={13} /> Train Content</>
                    )}
                  </button>
                  <button
                    className="btn-dry-run btn-train-content"
                    onClick={(e) => { e.stopPropagation(); handleTestTones(); }}
                    onMouseDown={e => e.stopPropagation()}
                    disabled={showTestTonesModal || !isAiIdle}
                    title={!isAiIdle ? "AI đang bận..." : "Test 6 phong cách hành văn AI"}
                    style={{flex: '1 1 100%', marginTop: '6px', background: 'rgba(234, 179, 8, 0.1)', color: '#eab308', borderColor: 'rgba(234, 179, 8, 0.3)'}}
                  >
                    <><Zap size={13} /> Test Hành Văn AI</>
                  </button>
                </div>
              </div>
            </div>{/* end node publish */}
            </div>{/* end nodes relative wrapper */}
          </div>{/* end single canvas container */}
        </div>{/* end canvas-area */}

        {!isMonitorOpen && (
          <button 
            className="monitor-open-btn"
            onClick={() => setIsMonitorOpen(true)}
            title="Mở Live Monitor"
          >
             <ChevronLeft size={16} /> Live Monitor
          </button>
        )}

        {/* ───── LIVE MONITOR SIDEBAR ───── */}
        <div className={`live-monitor-sidebar glass ${!isMonitorOpen ? 'collapsed' : ''}`}>
          <div className="monitor-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <button 
                className="btn-icon-square" 
                title="Ẩn Live Monitor" 
                onClick={() => setIsMonitorOpen(false)}
                style={{ background: 'transparent', border: 'none', padding: 0 }}
              >
                <ChevronRight size={18} />
              </button>
              Live Monitor
            </h3>
            <div className="monitor-actions">
              <button className="btn-icon-square" title="Xoá log" onClick={() => { setLogs([]); setImageGallery([]); setCarouselIdx(0); setPreviewFB(null); setPreviewIG(null); setPreviewTH(null); }}>
                <Trash2 size={14} />
              </button>
              <button className="btn-icon-square" title="Kết nối lại SSE" onClick={() => {
                setLogs([{ time: new Date().toLocaleTimeString(), sender: 'System', message: 'Đã làm mới kết nối Live Monitor.', type: 'info' }]);
              }}>
                <RotateCcw size={14} />
              </button>
            </div>
          </div>

          <div className="monitor-tabs">
            <button className={`monitor-tab-btn ${liveMonitorTab === 'outputs' ? 'active' : ''}`} onClick={() => setLiveMonitorTab('outputs')}>
              <ImageIcon size={14} /> Content Outputs
              <span className="tab-badge">{previewFB || previewIG || previewTH ? '3' : '0'}</span>
            </button>
            <button className={`monitor-tab-btn ${liveMonitorTab === 'logs' ? 'active' : ''}`} onClick={() => setLiveMonitorTab('logs')}>
              <Terminal size={14} /> Execution Logs
            </button>
          </div>

          <div className="monitor-content">
            {liveMonitorTab === 'logs' && (
              <div className="terminal-box">
                <div className="terminal-body">
                  {logs.length === 0 && <p className="text-muted">Chưa có luồng dữ liệu nào chạy.</p>}
                  {logs.map((log, idx) => (
                    <p key={idx} className={log.type}>
                      <span>{log.time}</span>
                      <strong>[{log.sender}]</strong> {log.message}
                      {log.type === 'typing' && <span className="dot-anim">...</span>}
                    </p>
                  ))}
                  <div ref={terminalEndRef} />
                </div>
              </div>
            )}

            {liveMonitorTab === 'outputs' && (
              <>
                <div className="img-carousel">
                  {imageGallery.length > 0 ? (
                    <>
                      <img
                        src={imageGallery[carouselIdx]}
                        alt={`Ảnh ${carouselIdx + 1}`}
                        className="img-placeholder"
                        style={{ objectFit: 'cover', border: 'none' }}
                        key={imageGallery[carouselIdx]}
                      />
                      {imageGallery.length > 1 && (
                        <>
                          <button className="carousel-btn carousel-prev" onClick={() => setCarouselIdx(i => Math.max(0, i - 1))} disabled={carouselIdx === 0} title="Ảnh trước"><ChevronLeft size={18} /></button>
                          <button className="carousel-btn carousel-next" onClick={() => setCarouselIdx(i => Math.min(imageGallery.length - 1, i + 1))} disabled={carouselIdx === imageGallery.length - 1} title="Ảnh tiếp theo"><ChevronRight size={18} /></button>
                          <div className="carousel-dots">
                            {imageGallery.map((_, di) => (
                              <button key={di} className={`carousel-dot ${di === carouselIdx ? 'active' : ''}`} onClick={() => setCarouselIdx(di)} title={`Ảnh ${di + 1}`} />
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <div style={{ height: '160px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '8px', gap: '12px' }}>
                      <ImageIcon size={28} style={{ color: 'var(--color-text-dim)', opacity: 0.4 }} />
                      <span style={{ fontSize: '12px', color: 'var(--color-text-dim)', fontWeight: '500', letterSpacing: '0.5px' }}>Đang chờ dữ liệu hình ảnh...</span>
                    </div>
                  )}
                </div>

                <div className="social-card fb-card">
                  <div className="social-card-header">
                    <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                      <div style={{ background:'#1877F2', padding:'4px', borderRadius:'4px', display:'flex' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>
                      </div> 
                      Facebook Content
                    </div>
                  </div>
                  <div className="social-card-body">
                    {previewFB ? previewFB : <div style={{ color: 'var(--color-text-dim)', fontStyle: 'italic' }}>Đang đợi AI sinh nội dung Facebook...</div>}
                  </div>
                </div>

                <div className="social-card ig-card">
                  <div className="social-card-header">
                    <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                      <div style={{ background:'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)', padding:'4px', borderRadius:'4px', display:'flex' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
                      </div> 
                      Instagram Content
                    </div>
                  </div>
                  <div className="social-card-body">
                    {previewIG ? previewIG : <div style={{ color: 'var(--color-text-dim)', fontStyle: 'italic' }}>Đang đợi AI sinh caption Instagram...</div>}
                  </div>
                </div>

              </>
            )}
          </div>
        </div>
      </div>

      {/* ───── DRY RUN RESULT MODAL ───── */}
      {showDryRunModal && dryRunResult && (
        <div className="dry-run-overlay" onClick={() => setShowDryRunModal(false)}>
          <div className="dry-run-modal" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="dry-run-modal-header">
              <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                <CheckCircle size={20} color="#4ade80" />
                <div>
                  <h2 style={{margin:0, fontSize:'16px', color:'white'}}>
                    {dryRunResult.trainMode === 'image' ? 'Training Ảnh GPT' : dryRunResult.trainMode === 'content' ? 'Training Content' : 'Kết quả Dry Run'}
                  </h2>
                  <p style={{margin:0, fontSize:'11px', color:'var(--color-text-dim)'}}>
                    SKU: <strong style={{color:'var(--color-primary)'}}>{dryRunResult.sku}</strong>
                    &nbsp;·&nbsp; Chế độ: <strong style={{color:'#60a5fa'}}>{dryRunResult.trainMode === 'image' ? '🎨 Chỉ Ảnh' : dryRunResult.trainMode === 'content' ? '📝 Chỉ Content' : dryRunResult.postMode}</strong>
                    {dryRunResult.imageCount > 0 && <>&nbsp;·&nbsp; {dryRunResult.imageCount} ảnh</>}
                  </p>
                </div>
              </div>
              <button className="dry-run-close" onClick={() => setShowDryRunModal(false)} title="Đóng">
                <X size={18} />
              </button>
            </div>

            <div className="dry-run-modal-body">
              {/* Cột trái: Ảnh (ẩn khi chỉ train content) */}
              {dryRunResult.trainMode !== 'content' && (
              <div className="dry-run-img-col" style={dryRunResult.trainMode === 'image' ? {width: '100%', borderRight: 'none'} : {}}>
                <div className="dry-run-img-label">
                  <ImageIcon size={12} style={{marginRight:'6px', color:'var(--color-primary)'}} />
                  Ảnh Output ({dryRunImgIdx + 1}/{dryRunResult.images.length})
                </div>
                <div className="dry-run-img-wrap">
                  {dryRunResult.images.length > 0 ? (
                    <>
                      <img
                        src={dryRunResult.images[dryRunImgIdx]?.url || dryRunResult.images[dryRunImgIdx]}
                        alt={`Ảnh ${dryRunImgIdx + 1}`}
                        className="dry-run-img"
                      />
                      {dryRunResult.images.length > 1 && (
                        <>
                          <button
                            className="carousel-btn carousel-prev"
                            onClick={() => setDryRunImgIdx(i => Math.max(0, i - 1))}
                            disabled={dryRunImgIdx === 0}
                          ><ChevronLeft size={18} /></button>
                          <button
                            className="carousel-btn carousel-next"
                            onClick={() => setDryRunImgIdx(i => Math.min(dryRunResult.images.length - 1, i + 1))}
                            disabled={dryRunImgIdx === dryRunResult.images.length - 1}
                          ><ChevronRight size={18} /></button>
                          <div className="carousel-dots">
                            {dryRunResult.images.map((_, di) => (
                              <button key={di} className={`carousel-dot ${di === dryRunImgIdx ? 'active' : ''}`} onClick={() => setDryRunImgIdx(di)} />
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <div style={{color:'var(--color-text-dim)', fontSize:'12px', textAlign:'center', padding:'20px'}}>
                      {dryRunResult.postMode === 'REELS' ? '🎬 Chế độ Video — Không có ảnh tĩnh để preview' : '⚠️ Không có ảnh'}
                    </div>
                  )}
                </div>

                {dryRunResult.images[dryRunImgIdx]?.prompt && (
                  <div style={{ display: 'flex', gap: '10px', marginTop: '16px', width: '100%' }}>
                    <button 
                      onClick={() => {
                        Swal.fire({ title: 'Đã Duyệt!', text: 'Bối cảnh này rất tốt, hệ thống sẽ tiếp tục phát huy.', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500, background: 'var(--color-surface)', color: 'white' });
                        if (dryRunImgIdx < dryRunResult.images.length - 1) setDryRunImgIdx(i => i + 1);
                      }}
                      style={{ flex: 1, background: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.3)', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'all 0.2s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34, 197, 94, 0.2)'; e.currentTarget.style.borderColor = '#22c55e'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(34, 197, 94, 0.1)'; e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.3)'; }}
                    >
                      ✅ 10/10 (Duyệt)
                    </button>
                    <button 
                      onClick={handleSendFeedback}
                      style={{ flex: 1, background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'all 0.2s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)'; e.currentTarget.style.borderColor = '#3b82f6'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'; e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)'; }}
                    >
                      💬 Nhận xét sửa lỗi
                    </button>
                    <button 
                      onClick={handleRejectPrompt}
                      style={{ flex: 1, background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'all 0.2s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'; e.currentTarget.style.borderColor = '#ef4444'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)'; }}
                    >
                      🗑️ Xóa luôn cảnh này
                    </button>
                  </div>
                )}
              </div>
              )}
              {/* Cột phải: Content (ẩn khi chỉ train image) */}
              {dryRunResult.trainMode !== 'image' && (
              <div className="dry-run-content-col" style={dryRunResult.trainMode === 'content' ? {width: '100%'} : {}}>
                <div className="dry-run-tab-bar">
                  <button
                    className={`dry-run-tab ${dryRunTab === 'fb' ? 'active' : ''}`}
                    onClick={() => setDryRunTab('fb')}
                  >
                    <MessageSquare size={13} /> Bài Facebook
                  </button>
                  <button
                    className={`dry-run-tab ${dryRunTab === 'ig' ? 'active' : ''}`}
                    onClick={() => setDryRunTab('ig')}
                  >
                    <Camera size={13} /> Caption Instagram
                  </button>
                </div>
                <div className="dry-run-content-box">
                  <pre className="dry-run-content-text">
                    {dryRunTab === 'fb' ? dryRunResult.fbContent : dryRunResult.igContent}
                  </pre>
                </div>
                <div style={{fontSize:'10px', color:'var(--color-text-dim)', marginTop:'8px'}}>
                  {dryRunTab === 'fb'
                    ? `${dryRunResult.fbContent?.length || 0} ký tự — Facebook`
                    : `${dryRunResult.igContent?.length || 0} ký tự — Instagram`
                  }
                </div>
              </div>
              )}
            </div>

            <div className="dry-run-modal-footer">
              <span style={{fontSize:'11px', color:'rgba(74,222,128,0.8)', display:'flex', alignItems:'center', gap:'6px'}}>
                <Zap size={12} /> Kết quả AI thuần — Chưa đăng lên MXH nào.
              </span>
              <button className="btn-dry-run" style={{padding:'8px 20px'}} onClick={() => setShowDryRunModal(false)}>
                Đóng Preview
              </button>
            </div>
          </div>
        </div>
      )}

        {showTestTonesModal && (
          <div className="dry-run-overlay" onClick={() => !testTonesProgress && setShowTestTonesModal(false)}>
            <div className="dry-run-modal" style={{ width: '80%', maxWidth: '1000px', height: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
              <div className="dry-run-modal-header" style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Zap size={20} color="#eab308" />
                  <div>
                    <h2 style={{ margin: 0, fontSize: '16px', color: 'white' }}>Thử Nghiệm Hành Văn AI</h2>
                    {testTonesProgress && (
                      <p style={{ margin: 0, fontSize: '12px', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <span className="spin-icon">⟳</span> {typeof testTonesProgress === 'string' ? testTonesProgress : testTonesProgress.message}
                      </p>
                    )}
                  </div>
                </div>
                <button className="dry-run-close" onClick={() => !testTonesProgress && setShowTestTonesModal(false)} disabled={!!testTonesProgress}>
                  <X size={18} />
                </button>
              </div>
              <div className="dry-run-modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px', background: 'var(--color-bg)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  {testTonesResults.map((res, i) => (
                    <div key={i} style={{ background: 'var(--color-surface)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--color-primary)' }}>{res.index}. {res.tone}</h3>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-dim)', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px' }}>CTA: {res.cta}</span>
                      </div>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordWrap: 'break-word', fontSize: '12px', color: 'var(--color-text)', lineHeight: 1.6, fontFamily: 'inherit' }}>
                        {res.content}
                      </pre>
                    </div>
                  ))}
                </div>
                {testTonesResults.length === 0 && !testTonesProgress && (
                  <div style={{ textAlign: 'center', color: 'var(--color-text-dim)', padding: '40px' }}>Chưa có kết quả.</div>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

// ───────────────── PROMPT EDITOR COMPONENT ─────────────────
const PromptEditor = ({ value, onSave, onCancel }) => {
  const [text, setText] = useState(value);
  return (
    <div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={4}
        style={{
          width: '100%', background: 'var(--color-canvas)', border: '1px solid var(--color-primary)',
          color: 'white', borderRadius: '4px', padding: '6px 8px', fontSize: '11px',
          resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: '1.5',
          boxSizing: 'border-box'
        }}
        autoFocus
        onMouseDown={e => e.stopPropagation()}
      />
      <div style={{display:'flex', gap:'6px', marginTop:'6px'}}>
        <button style={{flex:1, background:'var(--color-primary)', color:'white', border:'none', borderRadius:'4px', padding:'4px 0', fontSize:'11px', cursor:'pointer'}} onClick={() => onSave(text)}>💾 Lưu</button>
        <button style={{flex:1, background:'rgba(255,255,255,0.05)', color:'white', border:'1px solid var(--border-light)', borderRadius:'4px', padding:'4px 0', fontSize:'11px', cursor:'pointer'}} onClick={onCancel}>Hủy</button>
      </div>
    </div>
  );
};

export default Workflow;
