import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Cloud, Settings, Share2, Search, Pause, Terminal, Image as ImageIcon, BrainCircuit, FileText, UploadCloud, RotateCcw, Trash2, FlaskConical, X, MessageSquare, Camera, Zap, CheckCircle, Palette, PenTool } from 'lucide-react';
import Swal from 'sweetalert2';
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

const Workflow = () => {
  const [logs, setLogs] = useState([]);
  const [imageGallery, setImageGallery] = useState([]);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [previewText, setPreviewText] = useState(null);
  const [isGPTActive, setIsGPTActive] = useState(false);
  const [nodes, setNodes] = useState(INITIAL_NODES);
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
  // Sample images state
  const [sampleImages, setSampleImages] = useState([]);
  const [sampleImgUploading, setSampleImgUploading] = useState(false);
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
      const res = await fetch(`http://localhost:3000/api/prompt-md-files/${nodeId}`);
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
  }, [fetchMdFiles]);

  // ─── QUẢN LÝ ẢNH MẬu THAM CHIỪu ───
  const fetchSampleImages = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/sample-images');
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
      const res = await fetch('http://localhost:3000/api/sample-images', { method: 'POST', body: formData });
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
      const res = await fetch(`http://localhost:3000/api/sample-images/${encodeURIComponent(filename)}`, { method: 'DELETE' });
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
      
      const res = await fetch(`http://localhost:3000/api/upload-prompt-md/${uploadingNode}`, { 
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
      const res = await fetch(`http://localhost:3000/api/prompt-md-files/${nodeId}/${filename}`, { method: 'DELETE' });
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

  useEffect(() => {
    const eventSource = new EventSource('http://localhost:3000/api/logs/stream');
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
           const previews = data.logs.filter(l => l.textPreview).map(l => l.textPreview);
           if (previews.length > 0) setPreviewText(previews[previews.length - 1]);
           
           setTimeout(() => terminalEndRef.current?.scrollIntoView({ behavior: 'auto' }), 100);
           return;
        }

        // Logic xử lý log bình thường (real-time)
        setLogs(prev => [...prev, data]);
        setTimeout(() => terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        if (data.sender === 'GPT-4 Vision' && data.type !== 'success') setIsGPTActive(true);
        else if (data.sender === 'GPT-4 Vision' && data.type === 'success') setIsGPTActive(false);
        
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
        if (data.textPreview) setPreviewText(data.textPreview);
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
      setNodes(prev => ({ ...prev, [nodeId]: { ...prev[nodeId], x: Math.max(0, wx), y: Math.max(0, wy) } }));
    };

    const onMouseDownGlobal = (e) => {
      if (spaceHeld.current) {
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        panning.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y };
      }
    };

    const onMouseUp = () => {
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

  // ───────────────── TÍNH TOÁN CÁC ĐIỂM NỐI ─────────────────
  // Port xuất phải của Node (right-center)
  const portOut = (node, heightFraction = 0.5) => ({
    x: node.x + NODE_WIDTH,
    y: node.y + (typeof heightFraction === 'number' ? heightFraction : 0.5) * 100,
  });

  // Port nhập trái của Node (left-center)
  const portIn = (node, heightFraction = 0.5) => ({
    x: node.x,
    y: node.y + (typeof heightFraction === 'number' ? heightFraction : 0.5) * 100,
  });

  const cubicPath = (from, to) => {
    const cx = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} C ${cx} ${from.y}, ${cx} ${to.y}, ${to.x} ${to.y}`;
  };

  const { source, gpt, gemini, publish } = nodes;

  // Nhánh 1: source port-out-1 (30% height ~57px) → gpt port-in (center ~85px)
  const path1_from = { x: source.x + NODE_WIDTH, y: source.y + 57 };
  const path1_to   = { x: gpt.x, y: gpt.y + 85 };

  // Nhánh 2: source port-out-2 (60% height ~114px) → gemini port-in-2 (70% ~154px)
  const path2_from = { x: source.x + NODE_WIDTH, y: source.y + 114 };
  const path2_to   = { x: gemini.x, y: gemini.y + 154 };

  // Nhánh 3: source port-out-3 (90% height ~171px) → gemini port-in-3 (bottom ~198px)
  const path3_from = { x: source.x + NODE_WIDTH, y: source.y + 171 };
  const path3_to   = { x: gemini.x, y: gemini.y + 198 };

  // GPT → Gemini port-in-1 (30% ~66px)
  const pathGPT_from = { x: gpt.x + NODE_WIDTH, y: gpt.y + 85 };
  const pathGPT_to   = { x: gemini.x, y: gemini.y + 66 };

  // Gemini → Publish
  const pathPub_from = { x: gemini.x + NODE_WIDTH, y: gemini.y + 110 };
  const pathPub_to   = { x: publish.x, y: publish.y + 55 };

  const handleSavePrompt = async (key, value) => {
    setPrompts(prev => ({ ...prev, [key]: value }));
    setEditingPrompt(null);
    try {
      await fetch('http://localhost:3000/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts: { ...prompts, [key]: value } })
      });
      Swal.fire({ title: 'Đã lưu Prompt!', toast: true, position: 'top-end', icon: 'success', showConfirmButton: false, timer: 1500, background: 'var(--color-surface)', color: 'var(--color-text)' });
    } catch (e) {}
  };

  // ─── DRY RUN ───
  const handleDryRun = async () => {
    if (dryRunLoading) return;
    setDryRunLoading(true);
    setDryRunResult(null);
    setTrainMode('full');
    try {
      const res = await fetch('http://localhost:3000/api/dry-run', { method: 'POST' });
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
      const res = await fetch('http://localhost:3000/api/train-image', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Training ảnh thất bại');
      if (data.trainMode === 'image' && data.images.length === 0) {
        Swal.fire({ icon: 'success', title: 'Đã Bắt Đầu!', text: data.message, background: 'var(--color-surface)', color: 'white' });
      } else {
        setDryRunResult(data);
        setDryRunImgIdx(0);
        setDryRunTab('fb');
        setShowDryRunModal(true);
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
      const res = await fetch('http://localhost:3000/api/train-content', { method: 'POST' });
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
      const res = await fetch('http://localhost:3000/api/delete-prompt', {
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

      const res = await fetch('http://localhost:3000/api/feedback-prompt', {
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
      <div className="workflow-header-bar">
        <div className="search-box">
          <Search size={14} className="text-muted" />
          <input type="text" placeholder="Tìm kiếm luồng, node..." />
          <span className="shortcut">⌘K</span>
        </div>
        <span style={{ fontSize: '11px', color: 'var(--color-text-dim)', marginLeft: '12px' }}>
          💡 Giữ <kbd style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', padding: '1px 5px', fontSize: '10px' }}>Space</kbd> + kéo • Scroll để zoom
        </span>
      </div>

      <div className="workflow-content">
        <div className="canvas-area" ref={canvasRef}>

          {/* ── ZOOM CONTROLS ── */}
          <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 100, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={() => setTransform(p => ({ ...p, scale: Math.min(3, +(p.scale * 1.2).toFixed(2)) }))} style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(30,30,30,0.9)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Phóng to">+</button>
            <button onClick={() => setTransform(p => ({ ...p, scale: Math.max(0.2, +(p.scale * 0.8).toFixed(2)) }))} style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(30,30,30,0.9)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }} title="Thu nhỏ">−</button>
            <button onClick={() => setTransform({ x: 0, y: 0, scale: 1 })} style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,77,141,0.18)', border: '1px solid rgba(255,77,141,0.35)', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Đặt lại">1:1</button>
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
              {/* Nhánh 1: Source → GPT (active) */}
              <path d={cubicPath(path1_from, path1_to)} className="path-line active-path" />
              <circle cx={path1_to.x} cy={path1_to.y} r="4" fill="var(--color-primary)" />

              {/* Nhánh 2: Source → Gemini (ảnh gốc - dim) */}
              <path d={cubicPath(path2_from, path2_to)} className="path-line dim-path" />
              <circle cx={path2_to.x} cy={path2_to.y} r="3" fill="rgba(160,160,180,0.5)" />

              {/* Nhánh 3: Source → Gemini (video - faint) */}
              <path d={cubicPath(path3_from, path3_to)} className="path-line faint-path" />
              <circle cx={path3_to.x} cy={path3_to.y} r="3" fill="rgba(120,120,140,0.35)" />

              {/* GPT → Gemini */}
              <path d={cubicPath(pathGPT_from, pathGPT_to)} className="path-line active-path" />
              <circle cx={pathGPT_to.x} cy={pathGPT_to.y} r="4" fill="var(--color-primary)" />

              {/* Gemini → Publish */}
              <path d={cubicPath(pathPub_from, pathPub_to)} className="path-line dim-path" />
              <circle cx={pathPub_to.x} cy={pathPub_to.y} r="3" fill="rgba(160,160,180,0.5)" />
            </svg>

            {/* Nối node cards */}
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <div
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
                  <div className="condition-pill" style={{borderLeft:'2px solid var(--color-primary)'}}>① Anh_AVT → Sinh 4-6 ảnh (GPT)</div>
                  <div className="condition-pill" style={{borderLeft:'2px solid #888'}}>② Anh_Hang/Tu_Chup → Random 4-8 ảnh</div>
                  <div className="condition-pill" style={{borderLeft:'2px solid #555', opacity: 0.7}}>③ Video_Doc → 1 ảnh → Kịch bản</div>
                </div>
              </div>
              <div className="port" style={{top:'30%', right:'-5px', background:'var(--color-primary)'}} title="Nhánh 1 AVT"></div>
              <div className="port" style={{top:'60%', right:'-5px'}} title="Nhánh 2 Ảnh Thật"></div>
              <div className="port" style={{top:'90%', right:'-5px', opacity:0.5}} title="Nhánh 3 Video"></div>
            </div>{/* end node source */}

              {/* ───── NODE 2: GPT-4 VISION ───── */}
            <div
              className={`node-card gpt-node ${isGPTActive ? 'active-glow' : ''}`}
              style={{ top: gpt.y, left: gpt.x, cursor: 'grab' }}
              onMouseDown={e => onMouseDown(e, 'gpt')}
            >
              <div className="port" style={{top:'50%', left:'-5px'}} title="Input từ Nhánh 1"></div>
              <div className="node-header"><BrainCircuit size={14} className="pink" /> GPT-4 Vision (Sinh Ảnh)</div>
              <div className="node-body">
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
              className="node-card gemini-node"
              style={{ top: gemini.y, left: gemini.x, cursor: 'grab' }}
              onMouseDown={e => onMouseDown(e, 'gemini')}
            >
              <div className="port" style={{top:'30%', left:'-5px', background:'var(--color-primary)'}} title="Input từ GPT"></div>
              <div className="port" style={{top:'70%', left:'-5px'}} title="Input từ Nhánh 2 (Ảnh gốc)"></div>
              <div className="port" style={{top:'90%', left:'-5px', opacity:0.5}} title="Input từ Nhánh 3 (Video)"></div>
              <div className="node-header"><Settings size={14} className="blue" /> Gemini 1.5 Pro</div>
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
                <div className="field" style={{marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
                  <button
                    id="btn-dry-run"
                    className="btn-dry-run"
                    onClick={(e) => { e.stopPropagation(); handleDryRun(); }}
                    onMouseDown={e => e.stopPropagation()}
                    disabled={dryRunLoading}
                    title="Chạy thử toàn bộ luồng AI nhưng KHÔNG đăng lên MXH"
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
                    disabled={dryRunLoading}
                    title="Chỉ tạo ảnh GPT để training AI"
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
                    disabled={dryRunLoading}
                    title="Chỉ tạo content để training AI"
                    style={{flex: '1 1 45%'}}
                  >
                    {dryRunLoading && trainMode === 'content' ? (
                      <><span className="spin-icon">⟳</span> Đang viết bài...</>
                    ) : (
                      <><PenTool size={13} /> Train Content</>
                    )}
                  </button>
                </div>
              </div>
            </div>{/* end node publish */}
            </div>{/* end nodes relative wrapper */}
          </div>{/* end single canvas container */}
        </div>{/* end canvas-area */}

        {/* ───── LIVE MONITOR SIDEBAR ───── */}
        <div className="live-monitor-sidebar glass">
          <div className="monitor-header">
            <h3><Terminal size={16} style={{marginRight:'8px', color:'var(--color-primary)'}}/> Live Monitor</h3>
            <div className="monitor-actions">
              <button className="btn-icon-square" title="Xoá log" onClick={() => { setLogs([]); setImageGallery([]); setCarouselIdx(0); setPreviewText(null); }}>
                <Trash2 size={14} />
              </button>
              <button className="btn-icon-square" title="Kết nối lại SSE" onClick={() => {
                setLogs([{ time: new Date().toLocaleTimeString(), sender: 'System', message: 'Đã làm mới kết nối Live Monitor.', type: 'info' }]);
              }}>
                <RotateCcw size={14} />
              </button>
              <button className="btn-icon-square" onClick={() => Swal.fire({ title: 'Tạm ngưng', text: 'Đã gửi tín hiệu Pause (Đang phát triển).', icon: 'warning', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000, background: 'var(--color-surface)', color: 'var(--color-text)' })}><Pause size={14} /></button>
              <button className="btn-icon-square" onClick={() => Swal.fire('Cấu hình', 'Trang cài đặt đang được xây dựng.', 'info')}><Settings size={14} /></button>
            </div>
          </div>

          <div className="monitor-content">
            <div className="terminal-box">
              <div className="terminal-header"><Terminal size={12} /> Execution Logs</div>
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

            <div className="preview-box">
              <div className="preview-header">
                <ImageIcon size={12} className="pink" /> Kết quả Output (Real-time)
                {imageGallery.length > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--color-text-dim)' }}>
                    {carouselIdx + 1} / {imageGallery.length}
                  </span>
                )}
              </div>
              <div className="preview-body">
                {/* CAROUSEL ẢNH */}
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
                      {/* Nút ← → */}
                      {imageGallery.length > 1 && (
                        <>
                          <button
                            className="carousel-btn carousel-prev"
                            onClick={() => setCarouselIdx(i => Math.max(0, i - 1))}
                            disabled={carouselIdx === 0}
                            title="Ảnh trước"
                          >
                            <ChevronLeft size={18} />
                          </button>
                          <button
                            className="carousel-btn carousel-next"
                            onClick={() => setCarouselIdx(i => Math.min(imageGallery.length - 1, i + 1))}
                            disabled={carouselIdx === imageGallery.length - 1}
                            title="Ảnh tiếp theo"
                          >
                            <ChevronRight size={18} />
                          </button>
                          {/* Dot indicators */}
                          <div className="carousel-dots">
                            {imageGallery.map((_, di) => (
                              <button
                                key={di}
                                className={`carousel-dot ${di === carouselIdx ? 'active' : ''}`}
                                onClick={() => setCarouselIdx(di)}
                                title={`Ảnh ${di + 1}`}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="img-placeholder skeleton-loading"><span>Đang chờ Ảnh...</span></div>
                  )}
                </div>

                <div className="text-preview">
                  <div className="preview-label">Gemini Content: {!previewText && <span className="text-muted">(Đang đợi nội dung)</span>}</div>
                  {previewText ? (
                    <div style={{ fontSize: '11px', color: '#ccc', whiteSpace: 'pre-wrap' }}>{previewText}</div>
                  ) : (
                    <>
                      <div className="skeleton-line" style={{width:'90%'}}></div>
                      <div className="skeleton-line" style={{width:'70%'}}></div>
                      <div className="skeleton-line" style={{width:'80%'}}></div>
                    </>
                  )}
                </div>
              </div>
            </div>
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
