import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Cloud, Settings, Share2, Search, Pause, Terminal, Image as ImageIcon, BrainCircuit, FileText, UploadCloud, RotateCcw, Trash2 } from 'lucide-react';
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
  const [mdFileName, setMdFileName] = useState(null);      // tên file .md đã upload
  const [mdUploading, setMdUploading] = useState(false);   // đang upload
  const mdFileInputRef = useRef(null);                      // hidden file input
  // Canvas transform state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const terminalEndRef = useRef(null);
  const canvasRef = useRef(null);
  const dragging = useRef(null);   // { nodeId, startX, startY }
  const panning  = useRef(null);   // { startX, startY, originX, originY }
  const spaceHeld = useRef(false);

  // ─── UPLOAD FILE .MD ───
  const handleMdFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.md')) {
      Swal.fire({ title: 'Sai định dạng', text: 'Vui lòng chọn file có đuôi .md', icon: 'warning', background: 'var(--color-surface)', color: 'white' });
      return;
    }
    setMdUploading(true);
    try {
      const formData = new FormData();
      formData.append('mdFile', file);
      const res = await fetch('http://localhost:3000/api/upload-prompt-md', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setMdFileName(file.name);
        Swal.fire({ title: '✅ Tải lên thành công!', text: `File "${file.name}" đã được cập nhật. Tool sẽ dùng prompt từ file này.`, icon: 'success', background: 'var(--color-surface)', color: 'white', timer: 3000, showConfirmButton: false });
      } else {
        throw new Error(data.message || 'Upload thất bại');
      }
    } catch (err) {
      Swal.fire({ title: 'Lỗi upload', text: err.message, icon: 'error', background: 'var(--color-surface)', color: 'white' });
    } finally {
      setMdUploading(false);
      e.target.value = ''; // reset để chọn lại cùng file vẫn trigger
    }
  };

  useEffect(() => {
    const eventSource = new EventSource('http://localhost:3000/api/logs/stream');
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
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
                  <label style={{display:'flex', justifyContent:'space-between'}}>
                    Prompt sinh ảnh
                    <button style={{fontSize:'10px', color:'var(--color-primary)', background:'none', border:'none', cursor:'pointer', padding:0}} onClick={() => setEditingPrompt('gpt')}>✏️ Sửa</button>
                  </label>
                  {editingPrompt === 'gpt' ? (
                    <PromptEditor value={prompts.gpt} onSave={val => handleSavePrompt('gpt', val)} onCancel={() => setEditingPrompt(null)} />
                  ) : (
                    <div className="value prompt-preview" onClick={() => setEditingPrompt('gpt')}>{prompts.gpt}</div>
                  )}
                </div>
                <div className="field">
                  <label>File Prompt hướng dẫn AI (.md)</label>
                  <input ref={mdFileInputRef} type="file" accept=".md" style={{display:'none'}} onChange={handleMdFileChange} />
                  <button
                    className="btn-upload-md"
                    onClick={() => mdFileInputRef.current?.click()}
                    disabled={mdUploading}
                    title="Chọn file .md để cập nhật prompt hướng dẫn AI tạo ảnh"
                  >
                    <UploadCloud size={12} />
                    {mdUploading ? ' Đang tải...' : mdFileName ? ` ${mdFileName}` : ' Chọn file .md'}
                  </button>
                  {mdFileName && (
                    <div style={{fontSize:'10px', color:'var(--color-primary)', marginTop:4, display:'flex', alignItems:'center', gap:4}}>
                      ✅ Đang dùng: <span style={{color:'var(--color-text-dim)'}}>{mdFileName}</span>
                    </div>
                  )}
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
                  <label style={{display:'flex', justifyContent:'space-between'}}>
                    Prompt viết bài
                    <button style={{fontSize:'10px', color:'var(--color-primary)', background:'none', border:'none', cursor:'pointer', padding:0}} onClick={() => setEditingPrompt('gemini_post')}>✏️ Sửa</button>
                  </label>
                  {editingPrompt === 'gemini_post' ? (
                    <PromptEditor value={prompts.gemini_post} onSave={val => handleSavePrompt('gemini_post', val)} onCancel={() => setEditingPrompt(null)} />
                  ) : (
                    <div className="value prompt-preview" onClick={() => setEditingPrompt('gemini_post')}>{prompts.gemini_post}</div>
                  )}
                </div>
                <div className="field mt-2">
                  <label style={{display:'flex', justifyContent:'space-between'}}>
                    Prompt viết kịch bản (Video)
                    <button style={{fontSize:'10px', color:'var(--color-primary)', background:'none', border:'none', cursor:'pointer', padding:0}} onClick={() => setEditingPrompt('gemini_video')}>✏️ Sửa</button>
                  </label>
                  {editingPrompt === 'gemini_video' ? (
                    <PromptEditor value={prompts.gemini_video} onSave={val => handleSavePrompt('gemini_video', val)} onCancel={() => setEditingPrompt(null)} />
                  ) : (
                    <div className="value prompt-preview" onClick={() => setEditingPrompt('gemini_video')}>{prompts.gemini_video}</div>
                  )}
                </div>
                <div className="field mt-2">
                  <label>File Prompt hướng dẫn AI (.md)</label>
                  <button
                    className="btn-upload-md"
                    onClick={() => mdFileInputRef.current?.click()}
                    disabled={mdUploading}
                    title="Chọn file .md để cập nhật prompt hướng dẫn AI"
                  >
                    <UploadCloud size={12} />
                    {mdUploading ? ' Đang tải...' : mdFileName ? ` ${mdFileName}` : ' Chọn file .md'}
                  </button>
                  {mdFileName && (
                    <div style={{fontSize:'10px', color:'var(--color-primary)', marginTop:4}}>
                      ✅ <span style={{color:'var(--color-text-dim)'}}>{mdFileName}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="port" style={{top:'50%', right:'-5px'}} title="Output → Publisher"></div>
            </div>

            {/* ───── NODE 4: PUBLISH ───── */}
            <div
              className="node-card publish-node"
              style={{ top: publish.y, left: publish.x, cursor: 'grab' }}
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
