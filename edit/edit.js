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
            `;
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

    waitForMap();
})();