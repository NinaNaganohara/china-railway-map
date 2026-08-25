(() => {
    // 等待地图对象就绪（map.js 加载完成后会设置 window.map）
    function waitForMap() {
        if (window.map) {
            initEditMode();
        } else {
            setTimeout(waitForMap, 100);
        }
    }

    let editMode = false;
    let editingFeature = null;

    function ensureElement(id, tagName, styles, parent = document.body) {
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement(tagName);
            el.id = id;
            if (styles) el.style.cssText = styles;
            parent.appendChild(el);
        }
        return el;
    }

    function initEditMode() {
        // 确保编辑按钮存在
        const toggleBtn = ensureElement('toggle-edit-mode', 'button',
            'position:absolute;top:10px;right:10px;z-index:1100;padding:8px 14px;background:#fff;border:1px solid #ccc;border-radius:20px;cursor:pointer;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,0.1);'
        );
        toggleBtn.textContent = '✏️ 编辑模式';

        // 确保编辑面板存在
        const panel = ensureElement('edit-panel', 'div',
            'display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:400px;background:white;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:16px;z-index:1200;font-family:Noto Sans,sans-serif;'
        );
        // 面板内容
        panel.innerHTML = `
            <h3 id="edit-panel-title" style="margin-top:0;">编辑</h3>
            <form id="edit-form">
                <div id="edit-fields"></div>
                <div style="margin-top:12px;text-align:right;">
                    <button type="button" id="delete-feature" style="padding:6px 12px; margin-right:8px; background:#d9534f; color:white; border:none; border-radius:4px;">删除</button>
                    <button type="button" id="cancel-edit" style="padding:6px 12px;margin-right:8px;">取消</button>
                    <button type="submit" style="padding:6px 12px;background:#175e9c;color:#fff;border:none;border-radius:4px;">保存</button>
                </div>
            </form>
        `;

        // 绑定事件
        toggleBtn.addEventListener('click', () => {
            editMode = !editMode;
            if (editMode) {
                toggleBtn.textContent = '✅ 编辑模式 (开)';
                toggleBtn.style.background = '#cce5ff';
            } else {
                toggleBtn.textContent = '✏️ 编辑模式';
                toggleBtn.style.background = '#fff';
                closeEditPanel();
            }
        });

        document.getElementById('cancel-edit').addEventListener('click', closeEditPanel);
        document.getElementById('edit-form').addEventListener('submit', handleEditSubmit);
        document.getElementById('delete-feature').addEventListener('click', handleDelete);

        // 点击钩子：map.js 的 click 事件会优先调用它
        window.onMapClick = function(e) {
            if (!editMode) return false;
            const map = window.map;
            const lineFeats = map.queryRenderedFeatures(e.point, { layers: ['railway-line'] });
            const stationFeats = map.queryRenderedFeatures(e.point, {
                layers: ['railway-stations-circle', 'railway-stations-icon', 'railway-stations-label']
            });
            if (lineFeats.length > 0) {
                openEditPanel(lineFeats[0], 'line');
                return true;
            }
            if (stationFeats.length > 0) {
                openEditPanel(stationFeats[0], 'station');
                return true;
            }
            closeEditPanel();
            return false;
        };
    }

    function openEditPanel(feature, type) {
        editingFeature = { type, feature };
        const props = feature.properties;
        document.getElementById('edit-panel').style.display = 'block';
        document.getElementById('edit-panel-title').textContent = type === 'line' ? '编辑线路' : '编辑车站';

        let html = '';
        if (type === 'line') {
            html = `
                <label>ID: <input type="text" value="${feature.id || props.id}" disabled></label><br>
                <label>名称: <input name="name" value="${props.name || ''}"></label><br>
                <label>路网: <input name="network" value="${props.network || ''}"></label><br>
                <label>颜色: <input name="colour" value="${props.colour || ''}"></label><br>
                <label>缩写: <input name="abbreviation" value="${props.abbreviation || ''}"></label><br>
                <label>编号: <input name="ref" value="${props.ref || ''}"></label><br>
                <label>运营商: <input name="operator" value="${props.operator || ''}"></label><br>
                <label>铁路等级：
                    <select name="classification">
                        <option value=0 ${props.classification === 0}>高速铁路</option>
                        <option value=1 ${props.classification === 1}>城际铁路</option>
                        <option value=2 ${props.classification === 2}>国铁Ⅰ级</option>
                        <option value=3 ${props.classification === 3}>国铁Ⅱ级</option>
                        <option value=4 ${props.classification === 4}>国铁Ⅲ级</option>
                        <option value=5 ${props.classification === 5}>国铁Ⅳ级</option>
                        <option value=6 ${props.classification === 6}>地铁Ⅰ级</option>
                        <option value=7 ${props.classification === 7}>地铁Ⅱ级</option>
                    </select>
                </label><br>
                <label>设计时速：<input name="design_speed" value=${props.design_speed || ''}></label><br>
                <label>货运专线:
                    <select name="is_only_freight">
                        <option value="t" ${props.is_only_freight === 't' ? 'selected' : ''}>是</option>
                        <option value="f" ${props.is_only_freight === 'f' || !props.is_only_freight ? 'selected' : ''}>否</option>
                    </select>
                </label>
                <label>高铁/高速:
                    <select name="is_high_speed">
                        <option value="t" ${props.is_high_speed === true || props.is_high_speed === 't' ? 'selected' : ''}>是</option>
                        <option value="f" ${!props.is_high_speed || props.is_high_speed === 'f' ? 'selected' : ''}>否</option>
                    </select>
                </label>
                <label>废弃:
                    <select name="is_abandoned">
                        <option value="t" ${props.is_abandoned === true || props.is_abandoned === 't' ? 'selected' : ''}>是</option>
                        <option value="f" ${!props.is_abandoned || props.is_abandoned === 'f' ? 'selected' : ''}>否</option>
                    </select>
                </label>
                <label>开通:
                    <select name="is_open">
                        <option value="t" ${props.is_open === true || props.is_open === 't' ? 'selected' : ''}>是</option>
                        <option value="f" ${!props.is_open || props.is_open === 'f' ? 'selected' : ''}>否</option>
                    </select>
                </label>
            `;
            // 车站顺序按钮（编辑线路时展示）
            const lineId = feature.id || props.id;
            html += `
                <div style="margin-top:12px; text-align:center;">
                    <button type="button" id="open-order-panel-btn" style="padding:6px 14px;background:#175e9c;color:#fff;border:none;border-radius:4px;cursor:pointer;">🚉 编辑车站顺序</button>
                </div>
            `;
            setTimeout(() => {
                const btn = document.getElementById('open-order-panel-btn');
                if (btn) btn.addEventListener('click', () => openOrderPanel(lineId));
            }, 0);
        } else {
            html = `
                <label>ID: <input type="text" value="${feature.id || props.id}" disabled></label><br>
                <label>名称: <input name="name" value="${props.name || ''}"></label><br>
                <label>路网: <input name="network" value="${props.network || ''}"></label><br>
            `;
        }
        document.getElementById('edit-fields').innerHTML = html;
    }

    function closeEditPanel() {
        document.getElementById('edit-panel').style.display = 'none';
        editingFeature = null;
    }

    async function handleEditSubmit(e) {
        e.preventDefault();
        if (!editingFeature) return;

        const formData = new FormData(e.target);
        const payload = { id: editingFeature.feature.id || editingFeature.feature.properties.id };
        for (let [key, value] of formData.entries()) {
            if (key !== 'id') payload[key] = value;
        }

        const endpoint = editingFeature.type === 'line' ? '/api/update_line' : '/api/update_station';
        try {
            const res = await fetch(`${window.API_BASE}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            if (result.success) {
                alert('更新成功');
                closeEditPanel();
                // 刷新数据
                if (editingFeature.type === 'line') {
                    const linesRes = await fetch(`${window.API_BASE}/api/lines?source_type=railway`);
                    const linesData = await linesRes.json();
                    window.map.getSource('railway-lines').setData(linesData);
                } else {
                    const stationsRes = await fetch(`${window.API_BASE}/api/stations`);
                    const stationsData = await stationsRes.json();
                    window.map.getSource('railway-stations').setData(stationsData);
                }
            } else {
                alert('更新失败：' + result.message);
            }
        } catch (err) {
            console.error(err);
            alert('网络错误');
        }
    }

    async function handleDelete() {
        if (!editingFeature) return;
        const confirmDelete = confirm('确定要删除此' + (editingFeature.type === 'line' ? '线路' : '车站') + '吗？');
        if (!confirmDelete) return;

        const id = editingFeature.feature.id || editingFeature.feature.properties.id;
        const endpoint = editingFeature.type === 'line' ? '/api/delete_line' : '/api/delete_station';
        try {
            const res = await fetch(`${window.API_BASE}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
            });
            const result = await res.json();
            if (result.success) {
                alert('删除成功');
                closeEditPanel();
                // 刷新数据
                if (editingFeature.type === 'line') {
                    const linesRes = await fetch(`${window.API_BASE}/api/lines?source_type=railway`);
                    const linesData = await linesRes.json();
                    window.map.getSource('railway-lines').setData(linesData);
                } else {
                    const stationsRes = await fetch(`${window.API_BASE}/api/stations`);
                    const stationsData = await stationsRes.json();
                    window.map.getSource('railway-stations').setData(stationsData);
                }
            } else {
                alert('删除失败：' + result.message);
            }
        } catch (err) {
            console.error(err);
            alert('网络错误');
        }
    }

    // ========== 车站顺序排序面板 ==========
    let orderPanel = null;
    let currentOrderLineId = null;
    let currentOrderStations = [];   // 当前顺序的 [{id, name}]

    function buildOrderPanel() {
        if (orderPanel) return orderPanel;
        const el = ensureElement('order-panel', 'div',
            'display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:420px;max-height:75vh;display:flex;flex-direction:column;background:white;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:16px;z-index:1300;font-family:Noto Sans,sans-serif;'
        );
        // 注意 ensureElement 会内联 style，上面的 display:none 与 display:flex 冲突，手动处理
        el.style.display = 'none';
        el.innerHTML = `
            <h3 style="margin-top:0;">编辑车站顺序</h3>
            <div style="font-size:12px;color:#777;margin-bottom:8px;">拖拽车站调整途经顺序（已按地理走向预排序）</div>
            <div id="order-list" style="flex:1;overflow-y:auto;max-height:52vh;border:1px solid #eee;border-radius:8px;padding:4px;">
                <div style="padding:12px;text-align:center;color:#999;">加载中...</div>
            </div>
            <div style="margin-top:12px;text-align:right;">
                <button type="button" id="order-cancel" style="padding:6px 12px;margin-right:8px;">取消</button>
                <button type="button" id="order-save" style="padding:6px 14px;background:#175e9c;color:#fff;border:none;border-radius:4px;">保存顺序</button>
            </div>
        `;
        orderPanel = el;
        document.getElementById('order-cancel').addEventListener('click', closeOrderPanel);
        document.getElementById('order-save').addEventListener('click', saveOrder);
        return orderPanel;
    }

    function openOrderPanel(lineId) {
        buildOrderPanel();
        currentOrderLineId = lineId;
        orderPanel.style.display = 'flex';
        const listEl = document.getElementById('order-list');
        listEl.innerHTML = '<div style="padding:12px;text-align:center;color:#999;">加载中...</div>';
        fetch(`${window.API_BASE}/api/line_station_order?line_id=${lineId}`)
            .then(res => res.json())
            .then(data => {
                if (!data.success) { listEl.innerHTML = `<div style="padding:12px;color:#c00;">加载失败：${data.message}</div>`; return; }
                currentOrderStations = (data.stations || []).map(s => ({ id: s.id, name: s.name }));
                renderOrderList();
            })
            .catch(() => { listEl.innerHTML = '<div style="padding:12px;color:#c00;">网络错误</div>'; });
    }

    function closeOrderPanel() {
        if (orderPanel) orderPanel.style.display = 'none';
        currentOrderLineId = null;
    }

    function renderOrderList() {
        const listEl = document.getElementById('order-list');
        listEl.innerHTML = '';
        if (currentOrderStations.length === 0) {
            listEl.innerHTML = '<div style="padding:12px;text-align:center;color:#999;">该线路暂无关联车站</div>';
            return;
        }
        currentOrderStations.forEach((st, idx) => {
            const item = document.createElement('div');
            item.setAttribute('draggable', 'true');
            item.dataset.index = String(idx);
            item.style.cssText = 'display:flex;align-items:center;padding:6px 8px;margin:2px 0;background:#f7f7f7;border-radius:6px;cursor:grab;';
            item.innerHTML = `
                <span style="width:24px;color:#999;font-size:12px;">${idx + 1}</span>
                <span style="flex:1;font-size:14px;">${st.name}</span>
                <span style="color:#bbb;font-size:16px;">⠿</span>
            `;
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(idx));
                item.style.opacity = '0.4';
            });
            item.addEventListener('dragend', () => { item.style.opacity = '1'; });
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                const to = parseInt(item.dataset.index, 10);
                if (from === to || isNaN(from)) return;
                const moved = currentOrderStations.splice(from, 1)[0];
                currentOrderStations.splice(to, 0, moved);
                renderOrderList();
            });
            listEl.appendChild(item);
        });
    }

    async function saveOrder() {
        if (!currentOrderLineId) return;
        const station_ids = currentOrderStations.map(s => s.id);
        try {
            const res = await fetch(`${window.API_BASE}/api/save_line_station_order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ line_id: currentOrderLineId, station_ids })
            });
            const result = await res.json();
            if (result.success) {
                alert('顺序已保存');
                closeOrderPanel();
            } else {
                alert('保存失败：' + result.message);
            }
        } catch (err) {
            console.error(err);
            alert('网络错误');
        }
    }

    waitForMap();
})();