(() => {
    const API_BASE = '';

    const corporationCodeMap = {
        'A00': '新广铁',
        'B00': '中国铁路哈尔滨局集团有限公司',
        'C00': '中国铁路呼和浩特局集团有限公司',
        'D00': '锦局',
        'E00': '新成局',
        'F00': '中国铁路郑州局集团有限公司',
        'G00': '中国铁路南昌局集团有限公司',
        'H00': '中国铁路上海局集团有限公司',
        'I00': '中国铁路济南局集团有限公司',
        'J00': '中国铁路兰州局集团有限公司',
        'K00': '中国铁路济南局集团有限公司',
        'L00': '吉局',
        'M00': '中国铁路昆明局集团有限公司',
        'N00': '中国铁路武汉局集团有限公司',
        'O00': '中国铁路青藏集团有限公司',
        'P00': '中国铁路北京局集团有限公司',
        'Q00': '中国铁路广州局集团有限公司',
        'R00': '中国铁路乌鲁木齐局集团有限公司',
        'S00': '福局',
        'T00': '中国铁路沈阳局集团有限公司',
        'U00': '新上局',
        'V00': '中国铁路太原局集团有限公司',
        'W00': '中国铁路成都局集团有限公司',
        'X00': '境外',
        'Y00': '中国铁路西安局集团有限公司',
        'Z00': '中国铁路南宁局集团有限公司'
    };

    function getCorporationName(code) {
        return corporationCodeMap[code] || code;
    }

    const map = new maplibregl.Map({
        container: 'map',
        style: '/style.json',   // 本地样式文件
        center: [116.3972, 39.9075],
        zoom: 5,
        pitch: 0,
        bearing: 0
    });

    map.addControl(new maplibregl.NavigationControl());

    function parseJSON(str) {
        if (typeof str === 'string') {
            try {
                str = JSON.parse(str);
            } catch (e) {
                str = str.split(',').map(s => s.trim());
            }
        }
        return str;
    }

    function collectCoords(geometry, acc) {
        if (!geometry) return;
        const type = geometry.type;
        if (type === 'Point') acc.push(geometry.coordinates);
        else if (type === 'MultiPoint' || type === 'LineString') geometry.coordinates.forEach(c => acc.push(c));
        else if (type === 'MultiLineString' || type === 'Polygon') geometry.coordinates.forEach(ring => ring.forEach(c => acc.push(c)));
        else if (type === 'MultiPolygon') geometry.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(c => acc.push(c))));
    }

    function getGeometryExtent(geometry) {
        if (!geometry) return null;
        const coords = [];
        collectCoords(geometry, coords);
        if (coords.length === 0) return null;
        const bounds = coords.reduce((b, coord) => b.extend(coord), new maplibregl.LngLatBounds(coords[0], coords[0]));
        return bounds;
    }

    function getLineColor(feature) {
        const props = feature.properties;
        const network = props.network || '';
        const name = (props.name || '') + (props['name:zh'] || '');
        const is_high_speed = props.is_high_speed;
        if (network === '珠三角城际') return '#009543';
        if (/高速|高铁|城际|客专|客运专线/.test(name) || is_high_speed) return '#175e9c';
        if (props.colour && props.colour !== '#ff2600') return props.colour;
        return '#ff2600';
    }

    map.on('load', async () => {
        // 保存完整线路/车站数据（含未分块的完整几何），供定位使用
        let allLinesData = null;
        let allStationsData = null;

        // ========== 加载铁路线路 ==========
        try {
            const linesRes = await fetch(`${API_BASE}/api/lines?source_type=railway`);
            const linesData = await linesRes.json();
            allLinesData = linesData;
            map.addSource('railway-lines', { type: 'geojson', data: linesData });
            map.addLayer({
                id: 'railway-line',
                type: 'line',
                source: 'railway-lines',
                paint: {
                    'line-color': [
                        'case',
                        ['==', ['get', 'network'], '珠三角城际'], '#009543',
                        ['any',
                            ['in', '高速', ['get', 'name']],
                            ['in', '高铁', ['get', 'name']],
                            ['in', '城际', ['get', 'name']],
                            ['in', '客专', ['get', 'name']],
                            ['in', '客运专线', ['get', 'name']],
                            ["==", ["get", "is_high_speed"], true]
                        ], '#175e9c',
                        ['!=', ['get', 'colour'], null], ['get', 'colour'],
                        '#ff2600'
                    ],
                    'line-width': 3,
                    'line-opacity': 0.9
                }
            });
        } catch (e) { console.error('加载铁路线路失败:', e); }

        // ========== 加载车站 ==========
        try {
            const stationsRes = await fetch(`${API_BASE}/api/stations`);
            const stationsData = await stationsRes.json();
            allStationsData = stationsData;
            map.addSource('railway-stations', { type: 'geojson', data: stationsData });
            map.addLayer({
                id: 'railway-stations-circle',
                type: 'circle',
                source: 'railway-stations',
                maxzoom: 12,
                paint: {
                    'circle-radius': 3,
                    'circle-color': '#ff2600',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 1
                }
            });
            const transparentPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            map.loadImage(transparentPixel, (error, image) => {
                if (!error && !map.hasImage('placeholder')) map.addImage('placeholder', image);
            });
            const defaultSVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#888" stroke="#fff" stroke-width="2"/></svg>')}`;
            map.loadImage(defaultSVG, (error, image) => {
                if (!error && !map.hasImage('default')) map.addImage('default', image);
            });
            const crLogo = new Image();
            crLogo.onload = () => {
                if (map.hasImage('中国铁路')) map.removeImage('中国铁路');
                map.addImage('中国铁路', crLogo);
            };
            crLogo.src = './assets/icons/中国铁路.svg';
            map.addLayer({
                id: 'railway-stations-icon',
                type: 'symbol',
                source: 'railway-stations',
                minzoom: 12,
                layout: {
                    'icon-image': ['coalesce', ['image', '中国铁路'], ['image', 'default']],
                    'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.1, 20, 0.15],
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true
                }
            });
            map.addLayer({
                id: 'railway-stations-label',
                type: 'symbol',
                source: 'railway-stations',
                layout: {
                    'text-field': ['coalesce', ['get', 'name:zh'], ['get', 'name']],
                    'text-font': ['Noto Sans Regular'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 14, 18, 18],
                    'text-offset': [0, 0.6],
                    'text-anchor': 'top'
                },
                paint: { 'text-color': '#333333', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }
            });
        } catch (e) { console.error('加载车站失败:', e); }

        // ========== 线路名称标签 ==========
        map.addLayer({
            id: 'railway-label',
            type: 'symbol',
            source: 'railway-lines',
            layout: {
                'symbol-placement': 'line',
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Regular'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 6, 8, 10, 10, 14, 12, 16, 18],
                'text-letter-spacing': 0.05,
                'text-optional': true
            },
            paint: {
                'text-color': [
                    'case',
                    ['==', ['get', 'network'], '珠三角城际'], '#009543',
                    ['any',
                        ['in', '高速', ['get', 'name']],
                        ['in', '高铁', ['get', 'name']],
                        ['in', '城际', ['get', 'name']],
                        ['in', '客专', ['get', 'name']],
                        ['in', '客运专线', ['get', 'name']],
                        ["==", ["get", "is_high_speed"], true]
                    ], '#175e9c',
                    ['!=', ['get', 'colour'], null], ['get', 'colour'],
                    '#ff2600'
                ],
                'text-halo-color': '#ffffff',
                'text-halo-width': 2
            }
        });

        // 添加天地图国界线（栅格瓦片）
        map.addSource('tianditu-boundary', {
            type: 'raster',
            tiles: [
                `https://t0.tianditu.gov.cn/ibo_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ibo&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`,
                `https://t1.tianditu.gov.cn/ibo_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ibo&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`,
                `https://t2.tianditu.gov.cn/ibo_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ibo&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`,
                `https://t3.tianditu.gov.cn/ibo_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ibo&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`
            ],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 18,
            attribution: '天地图'
        });

        map.addLayer({
            id: 'tianditu-boundary-layer',
            type: 'raster',
            source: 'tianditu-boundary',
            paint: {
                'raster-opacity': 1,          // 国界线透明度，可按需调整
                'raster-fade-duration': 0     // 避免加载闪烁
            }
        });

        // ========== 交互卡片 ==========
        const lineCard = document.getElementById('line-detail-card');
        const stationCard = document.getElementById('station-detail-card');
        const trainCard = document.getElementById('train-detail-card');

        const allLineLayerIds = ['railway-line'];
        const allLineLabelLayerIds = ['railway-label'];
        const allStationCircleLayerIds = ['railway-stations-circle'];
        const allStationIconLayerIds = ['railway-stations-icon'];
        const allStationLabelIds = ['railway-stations-label'];
        const allStationFeatureLayerIds = [...allStationCircleLayerIds, ...allStationIconLayerIds, ...allStationLabelIds];

        // 保存原始样式
        const originalPaints = {};
        allLineLayerIds.forEach(id => {
            originalPaints[id] = {
                'line-color': map.getPaintProperty(id, 'line-color'),
                'line-width': map.getPaintProperty(id, 'line-width'),
                'line-opacity': map.getPaintProperty(id, 'line-opacity')
            };
        });
        allLineLabelLayerIds.forEach(id => {
            const color = map.getPaintProperty(id, 'text-color');
            const opacity = map.getPaintProperty(id, 'text-opacity');
            if (color) originalPaints[id] = { 'text-color': color, 'text-opacity': opacity };
        });
        allStationCircleLayerIds.forEach(id => {
            const color = map.getPaintProperty(id, 'circle-color');
            const opacity = map.getPaintProperty(id, 'circle-opacity');
            if (color) originalPaints[id] = { 'circle-color': color, 'circle-opacity': opacity };
        });
        allStationLabelIds.forEach(id => {
            const color = map.getPaintProperty(id, 'text-color');
            const opacity = map.getPaintProperty(id, 'text-opacity');
            if (color) originalPaints[id] = { 'text-color': color, 'text-opacity': opacity };
        });
        allStationIconLayerIds.forEach(id => {
            const iconOpacity = map.getPaintProperty(id, 'icon-opacity');
            originalPaints[id] = { 'icon-opacity': iconOpacity !== undefined ? iconOpacity : 1 };
        });

        function highlightLine(network, name) {
            const matchExpr = ['==', ['get', 'name'], name];
            // 判断某车站是否属于当前高亮的线路（feature 的 line_names 含该线路名）
            const onLineExpr = ['in', name, ['coalesce', ['get', 'line_names'], ['literal', []]]];
            allLineLayerIds.forEach(id => {
                const orig = originalPaints[id];
                map.setPaintProperty(id, 'line-color', ['case', matchExpr, orig['line-color'], '#888888']);
                map.setPaintProperty(id, 'line-width', ['case', matchExpr, 5, orig['line-width']]);
                map.setPaintProperty(id, 'line-opacity', ['case', matchExpr, 1, 0.6]);
            });
            allLineLabelLayerIds.forEach(id => {
                const orig = originalPaints[id];
                try { map.setPaintProperty(id, 'text-color', ['case', matchExpr, orig['text-color'], '#888888']); } catch (e) {}
                try { map.setPaintProperty(id, 'text-opacity', ['case', matchExpr, 1, 0.7]); } catch (e) {}
            });
            allStationLabelIds.forEach(id => {
                const orig = originalPaints[id];
                try { map.setPaintProperty(id, 'text-color', ['case', onLineExpr, orig['text-color'], '#888888']); } catch (e) {}
                try { map.setPaintProperty(id, 'text-opacity', ['case', onLineExpr, 1, 0.7]); } catch (e) {}
            });
            allStationCircleLayerIds.forEach(id => {
                const orig = originalPaints[id];
                try { map.setPaintProperty(id, 'circle-color', ['case', onLineExpr, orig['circle-color'], '#888888']); } catch (e) {}
                try { map.setPaintProperty(id, 'circle-opacity', ['case', onLineExpr, 1, 0.6]); } catch (e) {}
            });
            allStationIconLayerIds.forEach(id => {
                try { map.setPaintProperty(id, 'icon-opacity', ['case', onLineExpr, 1, 0.25]); } catch (e) {}
            });
        }

        function resetHighlight() {
            allLineLayerIds.forEach(id => {
                const orig = originalPaints[id];
                if (orig) {
                    map.setPaintProperty(id, 'line-color', orig['line-color']);
                    map.setPaintProperty(id, 'line-width', orig['line-width']);
                    map.setPaintProperty(id, 'line-opacity', orig['line-opacity']);
                }
            });
            allLineLabelLayerIds.forEach(id => {
                const orig = originalPaints[id];
                if (orig) {
                    try { map.setPaintProperty(id, 'text-color', orig['text-color']); } catch(e) {}
                    try { map.setPaintProperty(id, 'text-opacity', orig['text-opacity']); } catch(e) {}
                }
            });
            allStationLabelIds.forEach(id => {
                const orig = originalPaints[id];
                if (orig) {
                    map.setPaintProperty(id, 'text-color', orig['text-color']);
                    map.setPaintProperty(id, 'text-opacity', orig['text-opacity']);
                }
            });
            allStationCircleLayerIds.forEach(id => {
                const orig = originalPaints[id];
                if (orig) {
                    map.setPaintProperty(id, 'circle-color', orig['circle-color']);
                    map.setPaintProperty(id, 'circle-opacity', orig['circle-opacity']);
                }
            });
            allStationIconLayerIds.forEach(id => {
                const iconOrig = originalPaints[id] || { 'icon-opacity': 1 };
                map.setPaintProperty(id, 'icon-opacity', iconOrig['icon-opacity']);
            });
        }

        function renderTrainDetail(detailData) {
            const body = document.getElementById('train-detail-body');
            if (!body) return;
            const data = detailData;
            const trainDetail = data.trainDetail || {};
            const stopTime = trainDetail.stopTime || [];
            const trainCode = trainDetail.stationTrainCodeAll || trainDetail.trainCode || data.trainNo || '';
            const trainStyle = stopTime.length > 0 ? (stopTime[0].train_style || stopTime[0].jiaolu_train_style || '') : '';
            const deptTrain = stopTime.length > 0 ? (stopTime[0].jiaolu_dept_train || '') : '';
            const corporation = stopTime.length > 0 ? (stopTime[0].jiaolu_corporation_code || '') : '';
            const corporationCode = stopTime.length > 0 ? (stopTime[0].corporation_code || '') : '';

            let html = `
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 22px; font-weight: bold; color: #333;">${trainCode}</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; font-size: 13px; margin-top: 6px; color: #555;">
                        <div><span style="font-weight: 500;">车型：</span>${trainStyle}</div>
                        <div><span style="font-weight: 500;">配属：</span>${deptTrain}</div>
                        <div><span style="font-weight: 500;">客运段：</span>${corporation}</div>
                        <div><span style="font-weight: 500;">路局：</span>${getCorporationName(corporationCode)}</div>
                    </div>
                </div>
                <div style="font-size: 14px; font-weight: bold; margin-bottom: 6px;">时刻表</div>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead><tr style="background:#f5f5f5;">
                        <th style="padding:6px;border-bottom:1px solid #ddd;text-align:center;">站序</th>
                        <th style="padding:6px;border-bottom:1px solid #ddd;text-align:left;">站名</th>
                        <th style="padding:6px;border-bottom:1px solid #ddd;text-align:center;">到达</th>
                        <th style="padding:6px;border-bottom:1px solid #ddd;text-align:center;">出发</th>
                        <th style="padding:6px;border-bottom:1px solid #ddd;text-align:center;">停时</th>
                        <th style="padding:6px;border-bottom:1px solid #ddd;text-align:left;">候车室/检票口</th>
                    </tr></thead>
                    <tbody>
            `;
            stopTime.forEach(stop => {
                const arrive = stop.arriveTime === '----' ? '----' : (stop.arriveTime.slice(0,2) + ':' + stop.arriveTime.slice(2,4) || '--');
                const depart = stop.startTime === '----' ? '----' : (stop.startTime.slice(0,2) + ':' + stop.startTime.slice(2,4) || '--');
                const stopover = stop.stopover_time ? `${stop.stopover_time}分` : '-';
                const waitArea = [stop.waitingRoom, stop.wicket].filter(Boolean).join(' / ');
                html += `
                    <tr>
                        <td style="padding:4px;border-bottom:1px solid #eee;text-align:center;">${stop.stationNo || ''}</td>
                        <td style="padding:4px;border-bottom:1px solid #eee;">${stop.stationName || ''}</td>
                        <td style="padding:4px;border-bottom:1px solid #eee;text-align:center;">${arrive}</td>
                        <td style="padding:4px;border-bottom:1px solid #eee;text-align:center;">${depart}</td>
                        <td style="padding:4px;border-bottom:1px solid #eee;text-align:center;">${stopover}</td>
                        <td style="padding:4px;border-bottom:1px solid #eee;">${waitArea || '--'}</td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
            body.innerHTML = html;
        }

        // ========== 请求管理（可取消） ==========
        let activeControllers = [];
        function trackedFetch(url, options = {}) {
            const controller = new AbortController();
            activeControllers.push(controller);
            const opts = { ...options, signal: controller.signal };
            return fetch(url, opts).finally(() => {
                const idx = activeControllers.indexOf(controller);
                if (idx !== -1) activeControllers.splice(idx, 1);
            });
        }
        function cancelAllRequests() {
            const controllers = activeControllers;
            activeControllers = [];
            controllers.forEach(c => c.abort());
        }
        function isAbortError(err) {
            return err && err.name === 'AbortError';
        }

        // ========== 定位（统一供卡片与搜索使用；用完整数据，避免分块裁剪） ==========
        function focusOnLine(lineName) {
            // 从完整线路数据里按名称匹配所有同名段，合并展示整条线路
            if (!allLinesData || !allLinesData.features) return;
            const coords = [];
            allLinesData.features.forEach(f => {
                if ((f.properties.name || '') === lineName && f.geometry) {
                    collectCoords(f.geometry, coords);
                }
            });
            if (coords.length === 0) return;
            const bounds = coords.reduce((b, coord) => b.extend(coord), new maplibregl.LngLatBounds(coords[0], coords[0]));
            map.fitBounds(bounds, { padding: 60, maxZoom: 16 });
        }
        function focusOnStation(stationId) {
            if (!allStationsData || !allStationsData.features) return;
            const feat = allStationsData.features.find(f => f.properties.id === stationId);
            if (feat && feat.geometry) {
                map.flyTo({ center: feat.geometry.coordinates, zoom: 15 });
            }
        }

        map.on('mousemove', (e) => {
            const isOverLine = map.queryRenderedFeatures(e.point, { layers: ['railway-label'] }).length > 0;
            const isOverStation = map.queryRenderedFeatures(e.point, { layers: allStationFeatureLayerIds }).length > 0;
            map.getCanvas().style.cursor = (isOverLine || isOverStation) ? 'pointer' : '';
        });

        // 点击事件：如果 edit.js 定义了 onMapClick，则优先执行
        map.on('click', (e) => {
            if (typeof window.onMapClick === 'function' && window.onMapClick(e)) {
                return;  // 编辑模式已处理
            }

            const lineFeatures = map.queryRenderedFeatures(e.point, { layers: ['railway-label'] });
            const stationFeatures = map.queryRenderedFeatures(e.point, { layers: allStationFeatureLayerIds });

            if (lineFeatures.length > 0) {
                const props = lineFeatures[0].properties;
                const name = props.name || props['name:zh'] || '未知线路';
                const network = props.network || props.operator || '中国铁路';
                const colour = getLineColor({ properties: props });
                document.getElementById('card-color-bar').style.backgroundColor = colour;
                document.getElementById('card-line-name').textContent = name;
                document.getElementById('card-network').textContent = network;
                document.getElementById('card-type').textContent = '铁路';
                const logoImg = document.getElementById('card-network-logo-img');
                logoImg.src = './assets/icons/中国铁路.svg';
                logoImg.onerror = () => { logoImg.style.display = 'none'; };
                logoImg.style.display = 'inline-block';
                const lineBadge = document.getElementById('card-line-badge');
                lineBadge.style.display = 'inline-block';
                lineBadge.style.padding = '0 7px 2px 7px';
                lineBadge.style.borderRadius = '8px';
                lineBadge.style.color = '#fff';
                lineBadge.style.fontSize = '14px';
                lineBadge.style.fontWeight = 'bold';
                lineBadge.textContent = props.abbreviation || props.name.slice(0, 2) || '';
                lineBadge.style.backgroundColor = colour;
                lineCard.style.display = 'block';
                stationCard.style.display = 'none';
                trainCard.style.display = 'none';
                highlightLine(network, name);
                cancelAllRequests();
                // 加载途经车站
                const lineStationsList = document.getElementById('line-stations-list');
                lineStationsList.innerHTML = '加载中...';
                trackedFetch(`${API_BASE}/api/line_stations?line_id=${props.id}`)
                    .then(res => res.json())
                    .then(data => {
                        if (!data.success) {
                            lineStationsList.innerHTML = `<span style="color:#c00;">加载失败：${data.message}</span>`;
                            return;
                        }
                        const stations = data.stations || [];
                        if (stations.length === 0) {
                            lineStationsList.innerHTML = '<span style="color:#999;">暂无途经车站数据</span>';
                            return;
                        }
                        lineStationsList.innerHTML = '';
                            stations.forEach(s => {
                                const chip = document.createElement('span');
                                chip.textContent = s.name;

                                // ===== Grid 父级下的纯文字修复方案 =====
                                chip.style.setProperty('display', 'inline', 'important');        // 改为行内元素
                                chip.style.setProperty('width', 'fit-content', 'important');     // 宽度自适应内容（关键）
                                chip.style.setProperty('justify-self', 'start', 'important');    // 水平靠左，不拉伸
                                chip.style.setProperty('align-self', 'start', 'important');      // 垂直靠上，不拉伸
                                chip.style.setProperty('padding', '1px', 'important');
                                chip.style.setProperty('margin', '0', 'important');      // 保留文字间距
                                chip.style.setProperty('cursor', 'pointer', 'important');

                                chip.addEventListener('click', (ev) => {
                                    ev.stopPropagation();
                                    focusOnStation(s.id);
                                });
                                lineStationsList.appendChild(chip);
                            });
                    })
                    .catch((err) => { if (!isAbortError(err)) lineStationsList.innerHTML = '<span style="color:#c00;">网络错误</span>'; });
                e.preventDefault();
            }
            else if (stationFeatures.length > 0) {
                const props = stationFeatures[0].properties;
                const stationName = props.name || '未知车站';
                const network = props.network || '中国铁路';
                const bureau = "";
                const belong = "";
                document.getElementById('station-color-bar').style.backgroundColor = '#ff2600';
                document.getElementById('station-name').textContent = stationName;
                document.getElementById('station-network').textContent = network;
                document.getElementById('station-type').textContent = '火车站';
                document.getElementById('station-network-logo-img').src = './assets/icons/中国铁路.svg';
                fetch(`/api/station_belong_and_bureau?station=${encodeURIComponent(stationName)}`)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error('网络响应异常');
                        }
                        return response.json();
                    })
                    .then(data => {
                        if (data.success) {
                            console.log('所属路局:', data.bureau);
                            console.log('车务段:', data.belong);
                            // 你可以在这里更新页面上的显示
                            document.getElementById('station-bureau').textContent = data.bureau || '未知';
                            document.getElementById('station-belong').textContent = data.belong || '未知';
                        } else {
                            console.error('获取失败:', data.message);
                            // 显示错误信息
                            document.getElementById('station-bureau').textContent = '加载失败';
                            document.getElementById('station-belong').textContent = '加载失败';
                        }
                    })
                    .catch(error => {
                        console.error('请求错误:', error);
                        document.getElementById('station-bureau').textContent = '网络错误';
                        document.getElementById('station-belong').textContent = '网络错误';
                    });
                cancelAllRequests();
                // 加载关联线路
                const stationLinesList = document.getElementById('station-lines-list');
                stationLinesList.innerHTML = '加载中...';
                trackedFetch(`${API_BASE}/api/station_lines?station_id=${props.id}`)
                    .then(res => res.json())
                    .then(data => {
                        if (!data.success) {
                            stationLinesList.innerHTML = `<span style="color:#c00;">加载失败：${data.message}</span>`;
                            return;
                        }
                        const lines = data.lines || [];
                        if (lines.length === 0) {
                            stationLinesList.innerHTML = '<span style="color:#999;">暂无关联线路</span>';
                            return;
                        }
                        stationLinesList.innerHTML = '';
                        lines.forEach(l => {
                            const colour = getLineColor({ properties: l });
                            const chip = document.createElement('span');
                            chip.textContent = l.name;
                            chip.style.cssText = `display:inline-block; margin:2px 4px 2px 0; padding:0 7px 2px 7px; background:${colour}; color:#fff; border-radius:8px; font-size:14px; font-weight:bold; cursor:pointer;`;
                            chip.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                resetHighlight();
                                highlightLine(l.network || '', l.name);
                                focusOnLine(l.name);
                            });
                            stationLinesList.appendChild(chip);
                        });
                    })
                    .catch((err) => { if (!isAbortError(err)) stationLinesList.innerHTML = '<span style="color:#c00;">网络错误</span>'; });
                const tbody = document.getElementById('station-departures-tbody');
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:8px;">加载中...</td></tr>';
                const queryDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
                trackedFetch(`${API_BASE}/api/station_board?station=${encodeURIComponent(stationName)}`)
                    .then(res => res.json())
                    .then(data => {
                        tbody.innerHTML = '';
                        if (!data.success) {
                            tbody.innerHTML = `<tr><td colspan="6" style="padding:8px;color:#c00;">查询失败：${data.message}</td></tr>`;
                            return;
                        }
                        const trains = data.trains || [];
                        if (trains.length === 0) {
                            tbody.innerHTML = '<tr><td colspan="6" style="padding:8px;">暂无车次信息</td></tr>';
                            return;
                        }
                        trains.sort((a, b) => {
                            const getSortTime = (train) => {
                                const arrive = train.arrive_time;
                                if (!arrive || arrive === '----' || arrive.trim() === '') return train.start_time || '';
                                return arrive;
                            };
                            return getSortTime(a).localeCompare(getSortTime(b));
                        });
                        const now = new Date();
                        trains.forEach(train => {
                            const tr = document.createElement('tr');
                            tr.innerHTML = `
                                <td style="width:110px;padding:4px;">${train.train_code}</td>
                                <td style="width:100px;padding:4px;">${train.from_station}</td>
                                <td style="width:100px;padding:4px;">${train.to_station}</td>
                                <td style="width:80px;padding:4px;">${train.arrive_time || '----'}</td>
                                <td style="width:80px;padding:4px;">${train.start_time}</td>
                                <td style="width:90px;padding:4px;">查询中...</td>
                            `;
                            const tdDelay = tr.lastElementChild;
                            tr.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                trackedFetch(`${API_BASE}/api/train_detail?train_code=${encodeURIComponent(train.train_code)}&date=${queryDate}`)
                                    .then(res => res.json())
                                    .then(detailData => {
                                        if (detailData.success) {
                                            document.getElementById('train-detail-title').textContent = train.train_code + ' 详细信息';
                                            renderTrainDetail(detailData.data);
                                            trainCard.style.display = 'block';
                                            stationCard.style.display = 'none';
                                        } else {
                                            alert('查询车次详情失败');
                                        }
                                    });
                            });
                            trackedFetch(`${API_BASE}/api/train_detail?train_code=${encodeURIComponent(train.train_code)}&date=${queryDate}`)
                                .then(res => res.json())
                                .then(detailData => {
                                    if (!detailData.success) { tdDelay.textContent = '查询失败'; return; }
                                    const stops = detailData.data?.trainDetail?.stopTime;
                                    if (!stops || !Array.isArray(stops)) { tdDelay.textContent = '无数据'; return; }
                                    const stop = stops.find(s => s.stationName === stationName);
                                    if (!stop) { tdDelay.textContent = '未匹配'; return; }
                                    const ticketEarly = stop.ticketEarly;
                                    const ticketDelay = stop.ticketDelay;
                                    let delayMinutes = 0;
                                    if (ticketEarly !== undefined && ticketEarly !== null && ticketEarly !== '') delayMinutes = -Math.abs(parseInt(ticketEarly, 10));
                                    else if (ticketDelay !== undefined && ticketDelay !== null) delayMinutes = parseInt(ticketDelay, 10) || 0;
                                    else { tdDelay.textContent = '无状态'; return; }
                                    const planArriveStr = stop.arriveTime;
                                    if (!planArriveStr || planArriveStr === '----' || planArriveStr === '') { tdDelay.textContent = '无到达时间'; return; }
                                    const year = parseInt(queryDate.substring(0,4)), month = parseInt(queryDate.substring(4,6))-1, day = parseInt(queryDate.substring(6,8));
                                    const arrHour = parseInt(planArriveStr.substring(0,2)), arrMinute = parseInt(planArriveStr.substring(2,4));
                                    const planDate = new Date(year, month, day, arrHour, arrMinute);
                                    const actualDate = new Date(planDate.getTime() + delayMinutes*60000);
                                    const isPast = actualDate < now;
                                    const absDelay = Math.abs(delayMinutes);
                                    if (delayMinutes < 0) {
                                        tdDelay.textContent = isPast ? `早到${absDelay}分钟` : `预计早到${absDelay}分钟`;
                                        tdDelay.style.color = '#009543';
                                    } else if (delayMinutes > 0) {
                                        tdDelay.textContent = isPast ? `晚点${absDelay}分钟` : `预计晚点${absDelay}分钟`;
                                        tdDelay.style.color = '#ff2600';
                                    } else {
                                        tdDelay.textContent = isPast ? '正点' : '预计正点';
                                        tdDelay.style.color = '';
                                    }
                                })
                                .catch((err) => { if (!isAbortError(err)) tdDelay.textContent = '网络错误'; });
                            tbody.appendChild(tr);
                        });
                    }).catch((err) => { if (!isAbortError(err)) tbody.innerHTML = '<tr><td colspan="6">网络错误</td></tr>'; });
                stationCard.style.display = 'block';
                lineCard.style.display = 'none';
                trainCard.style.display = 'none';
                e.preventDefault();
            }
            else {
                resetHighlight();
                cancelAllRequests();
                lineCard.style.display = 'none';
                stationCard.style.display = 'none';
                trainCard.style.display = 'none';
            }
        });

        // ========== 搜索 ==========
        const searchInput = document.getElementById('search-input');
        const searchResults = document.getElementById('search-results');
        let debounceTimer;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            const keyword = searchInput.value.trim();
            if (!keyword) { searchResults.style.display = 'none'; return; }
            debounceTimer = setTimeout(() => {
                const results = [];
                const kw = keyword.toLowerCase();
                const seen = new Set();
                // 从完整数据（非分块）搜索线路，避免只搜当前视口 / 重复
                if (allLinesData && allLinesData.features) {
                    allLinesData.features.forEach(f => {
                        const p = f.properties || {};
                        const name = (p.name || '');
                        const ref = (p.ref || '');
                        if (name.toLowerCase().includes(kw) || ref.toLowerCase().includes(kw)) {
                            const key = 'line:' + p.id;
                            if (!seen.has(key)) {
                                seen.add(key);
                                results.push({ type: 'line', properties: p, geometry: f.geometry });
                            }
                        }
                    });
                }
                // 从完整数据搜索车站
                if (allStationsData && allStationsData.features) {
                    allStationsData.features.forEach(f => {
                        const p = f.properties || {};
                        const name = (p.name || '');
                        if (name.toLowerCase().includes(kw)) {
                            const key = 'station:' + p.id;
                            if (!seen.has(key)) {
                                seen.add(key);
                                results.push({ type: 'station', properties: p, geometry: f.geometry });
                            }
                        }
                    });
                }
                searchResults.innerHTML = '';
                if (results.length === 0) {
                    searchResults.innerHTML = '<div style="padding:12px;text-align:center;">无结果</div>';
                } else {
                    results.slice(0,15).forEach(item => {
                        const div = document.createElement('div');
                        div.style.padding = '8px 12px';
                        div.style.cursor = 'pointer';
                        div.style.borderBottom = '1px solid #f0f0f0';
                        if (item.type === 'line') {
                            const colour = item.properties.colour || '#ff2600';
                            div.innerHTML = `<span style="width:12px;height:12px;border-radius:50%;background:${colour};display:inline-block;margin-right:8px;"></span>${item.properties.name}`;
                            div.addEventListener('click', () => {
                                searchResults.style.display = 'none';
                                searchInput.value = '';
                                resetHighlight();
                                highlightLine(item.properties.network || '', item.properties.name);
                                focusOnLine(item.properties.name);
                            });
                        } else {
                            div.innerHTML = `🚉 ${item.properties.name}`;
                            div.addEventListener('click', () => {
                                searchResults.style.display = 'none';
                                searchInput.value = '';
                                focusOnStation(item.properties.id);
                            });
                        }
                        searchResults.appendChild(div);
                    });
                }
                searchResults.style.display = 'block';
            }, 300);
        });
        map.on('click', () => { searchResults.style.display = 'none'; });
        searchInput.addEventListener('blur', () => setTimeout(() => { searchResults.style.display = 'none'; }, 200));

        // 暴露给 edit.js 使用
        window.map = map;
        window.API_BASE = API_BASE;

        console.log('✅ 全国铁路地图已加载');
    });
})();
