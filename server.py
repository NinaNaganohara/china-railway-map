#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re
import json
import os
import math
import socket
import requests
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from contextlib import contextmanager
import psycopg2
from psycopg2 import pool
from dotenv import load_dotenv
from flask import send_from_directory

load_dotenv()

# ========== 坐标转换：GCJ-02（火星坐标）→ WGS-84 ==========
_EARTH_A = 6378245.0
_EARTH_EE = 0.00669342162296594323


def _out_of_china(lng, lat):
    return not (72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271)


def _transform_lat(x, y):
    ret = (-100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y
           + 0.2 * math.sqrt(abs(x)))
    ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (160.0 * math.sin(y / 12.0 * math.pi) + 320.0 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
    return ret


def _transform_lng(x, y):
    ret = (300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x)))
    ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
    return ret


def _gcj_to_wgs_exact(lng, lat):
    """单次 GCJ-02 → WGS-84 近似（正向偏移求反），配合迭代收敛。"""
    if _out_of_china(lng, lat):
        return lng, lat
    dlat = _transform_lat(lng - 105.0, lat - 35.0)
    dlng = _transform_lng(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * math.pi
    magic = math.sin(radlat)
    magic = 1 - _EARTH_EE * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((_EARTH_A * (1 - _EARTH_EE)) / (magic * sqrtmagic) * math.pi)
    dlng = (dlng * 180.0) / (_EARTH_A / sqrtmagic * math.cos(radlat) * math.pi)
    return lng - dlng, lat - dlat


def gcj02_to_wgs84(lng, lat):
    """GCJ-02 → WGS-84，迭代两次收敛，精度可优于 1 米。"""
    if _out_of_china(lng, lat):
        return lng, lat
    wlng, wlat = _gcj_to_wgs_exact(lng, lat)
    for _ in range(3):
        # 用当前估计值算正向偏移，反推更精确的 WGS-84
        glng, glat = wgs84_to_gcj02(wlng, wlat)
        wlng += lng - glng
        wlat += lat - glat
    return wlng, wlat


def wgs84_to_gcj02(lng, lat):
    """WGS-84 → GCJ-02 正向转换（供迭代反推使用）。"""
    if _out_of_china(lng, lat):
        return lng, lat
    dlat = _transform_lat(lng - 105.0, lat - 35.0)
    dlng = _transform_lng(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * math.pi
    magic = math.sin(radlat)
    magic = 1 - _EARTH_EE * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((_EARTH_A * (1 - _EARTH_EE)) / (magic * sqrtmagic) * math.pi)
    dlng = (dlng * 180.0) / (_EARTH_A / sqrtmagic * math.cos(radlat) * math.pi)
    return lng + dlng, lat + dlat


db_host = os.getenv('DB_HOST')
db_port = os.getenv('DB_PORT')
db_user = os.getenv('DB_USER')
db_password = os.getenv('DB_PASSWORD')

# ========== 数据库配置 ==========
DB_CONFIG = {
    "host": db_host,
    "port": db_port,
    "database": "transport",      # 请替换为实际数据库名
    "user": db_user,        # 请替换为实际用户名
    "password": db_password # 请替换为实际密码
}

# ========== 连接池 ==========
connection_pool = None

def init_pool():
    global connection_pool
    connection_pool = pool.ThreadedConnectionPool(1, 10, **DB_CONFIG)

def get_connection():
    return connection_pool.getconn()

def release_connection(conn):
    connection_pool.putconn(conn)

@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
    finally:
        release_connection(conn)

# ========== 12306 车站数据加载 ==========
NAME_TO_CODE = {}
CODE_TO_NAME = {}
CODE_SET = set()

def load_station_data():
    """
    加载车站数据：优先从本地 station_name.js 读取，失败则尝试 12306。
    返回 (name_to_code, code_to_name, code_set)
    """
    local_file = "station_name.js"  # 与 server.py 同目录

    # 1. 尝试本地文件
    if os.path.exists(local_file):
        try:
            with open(local_file, 'r', encoding='utf-8') as f:
                content = f.read()
            match = re.search(r"'([^']*)'", content)
            if match:
                data_str = match.group(1)
                print("✅ 使用本地 station_name.js")
            else:
                print("❌ 本地 station_name.js 格式错误")
                return {}, {}, set()
        except Exception as e:
            print(f"❌ 读取本地文件失败: {e}")
            return {}, {}, set()
    else:
        # 2. 尝试从 12306 获取
        print("尝试从 12306 获取车站数据...")
        url = "https://kyfw.12306.cn/otn/resources/js/framework/station_name.js"
        try:
            resp = requests.get(url, timeout=10)
            resp.encoding = "utf-8"
            match = re.search(r"'([^']*)'", resp.text)
            if not match:
                print("12306 响应格式异常")
                return {}, {}, set()
            data_str = match.group(1)
        except Exception as e:
            print(f"从 12306 获取失败: {e}")
            return {}, {}, set()

    # 解析数据
    records = data_str.split("@")[1:]
    name_to_code = {}
    code_to_name = {}
    code_set = set()
    for record in records:
        fields = record.split("|")
        if len(fields) >= 7:
            name = fields[1]   # 中文站名
            code = fields[2]   # 三字码
            name_to_code[name] = code
            code_to_name[code] = name
            code_set.add(code)
    return name_to_code, code_to_name, code_set

def get_station_code(input_str):
    if not input_str:
        return None
    key = input_str.strip()
    if key in NAME_TO_CODE:
        return NAME_TO_CODE[key]
    code_upper = key.upper()
    if code_upper in CODE_SET:
        return code_upper
    return None

def search_stations(keyword, limit=10):
    keyword = keyword.strip()
    if not keyword:
        return []
    if keyword in NAME_TO_CODE:
        code = NAME_TO_CODE[keyword]
        return [{"name": keyword, "code": code}]
    code_upper = keyword.upper()
    if code_upper in CODE_SET:
        name = CODE_TO_NAME[code_upper]
        return [{"name": name, "code": code_upper}]
    results = []
    for name, code in NAME_TO_CODE.items():
        if keyword in name or keyword in code:
            results.append({"name": name, "code": code})
            if len(results) >= limit:
                break
    return results

# ========== 12306 查询 ==========
def query_station_board(station_input, date_str=None):
    if date_str:
        date_str = date_str.replace("-", "")
        if not re.match(r"^\d{8}$", date_str):
            return {"success": False, "message": "日期格式错误"}
    else:
        date_str = datetime.now().strftime("%Y%m%d")

    station_code = get_station_code(station_input)
    if not station_code:
        suggestions = search_stations(station_input, 5)
        return {"success": False, "message": f"无法识别车站: {station_input}", "suggestions": suggestions}

    url = "https://mobile.12306.cn/wxxcx/wechat/bigScreen/queryTrainByStation"
    params = {"train_start_date": date_str, "train_station_code": station_code}
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://mobile.12306.cn/wxxcx/wechat/bigScreen/init",
        "Host": "mobile.12306.cn",
        "Origin": "https://mobile.12306.cn",
        "X-Requested-With": "XMLHttpRequest"
    }
    try:
        resp = requests.post(url, data=params, headers=headers, timeout=4)
        resp.encoding = "utf-8"
        if resp.status_code != 200:
            return {"success": False, "message": f"请求失败，状态码: {resp.status_code}"}
        data = resp.json()
        if data.get("status") is False:
            return {"success": False, "message": data.get("msg", "查询失败")}
        trains = data.get("data", [])
        result = []
        for train in trains:
            train_code = train.get("station_train_code") or train.get("train_code") or ""
            from_station = train.get("from_station_name") or train.get("start_station_name") or ""
            to_station = train.get("to_station_name") or train.get("end_station_name") or ""
            start_time = train.get("start_time") or ""
            arrive_time = train.get("arrive_time") or ""
            result.append({
                "train_code": train_code,
                "from_station": from_station,
                "to_station": to_station,
                "start_time": start_time,
                "arrive_time": arrive_time,
                "status": train.get("status", ""),
                "gate": train.get("gate_no", ""),
                "train_type": train.get("train_type_name", "")
            })
        return {
            "success": True,
            "station": station_code,
            "station_name": CODE_TO_NAME.get(station_code, station_code),
            "date": date_str,
            "count": len(result),
            "trains": result
        }
    except Exception as e:
        return {"success": False, "message": f"请求异常: {str(e)}"}

def query_train_info(train_code, start_day=None):
    if start_day is None:
        start_day = datetime.now().strftime('%Y%m%d')
    url = "https://mobile.12306.cn/wxxcx/wechat/main/travelServiceQrcodeTrainInfo"
    data = {"trainCode": train_code, "startDay": start_day, "startTime": "", "endDay": "", "endTime": ""}
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://mobile.12306.cn/wxxcx/",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept": "application/json",
        "Origin": "https://mobile.12306.cn",
        "X-Requested-With": "XMLHttpRequest"
    }
    try:
        response = requests.post(url, data=data, headers=headers, timeout=4)
        response.raise_for_status()
        result = response.json()
        if result.get("status") is True:
            return result.get("data", None)
        else:
            print(f"API错误: {result.get('errorMsg', '未知错误')}")
            return None
    except Exception as e:
        print(f"查询车次详情异常: {e}")
        return None

# ========== Flask 应用 ==========
NAME_TO_CODE, CODE_TO_NAME, CODE_SET = load_station_data()
app = Flask(__name__)
init_pool()
CORS(app)


def client_disconnected():
    """检测当前 HTTP 请求的客户端是否已断开连接。

    前端 abort() 会关闭底层 TCP 连接。这里通过 Werkzeug 开发服务器写入
    environ 的底层 socket（'werkzeug.socket'）做非阻塞探测：
    若 socket 可读且读到的为空（对端已关闭），说明客户端已断开。

    仅对 GET 等无请求体的接口安全（请求体已读尽）。
    """
    try:
        sock = request.environ.get('werkzeug.socket')
        if sock is None:
            return False
        # 非阻塞探测：socket 可读且 recv 返回 b'' 表示对端已关闭连接
        sock.setblocking(False)
        try:
            data = sock.recv(1, socket.MSG_PEEK)
        except BlockingIOError:
            # 无数据可读，连接仍活着
            return False
        except (ConnectionResetError, ConnectionAbortedError, OSError):
            return True
        finally:
            sock.setblocking(True)
        if data == b'':
            return True
        return False
    except Exception:
        return False


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/edit')
def edit_page():
    return send_from_directory('.', 'edit/index.html')

@app.route('/api/lines')
def get_lines():
    source_type = request.args.get('source_type', 'railway')
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, name, ref, network, operator, colour, abbreviation, source_type, is_high_speed,
                       ST_AsGeoJSON(geometry)::json AS geometry
                FROM transport_lines
                WHERE source_type = %s
                    AND ((is_only_freight IS NULL OR is_only_freight = false) AND (is_abandoned IS NULL OR is_abandoned =false))
                    AND (deleted IS NULL OR deleted = false)
            """, (source_type,))
            rows = cur.fetchall()
            features = []
            for row in rows:
                features.append({
                    "type": "Feature",
                    "properties": {
                        "id": row[0],
                        "name": row[1],
                        "ref": row[2],
                        "network": row[3],
                        "operator": row[4],
                        "colour": row[5] if row[5] else None,
                        "abbreviation": row[6],
                        "source_type": row[7],
                        "is_high_speed": row[8]
                    },
                    "geometry": row[9]
                })
            return jsonify({"type": "FeatureCollection", "features": features})

@app.route('/api/stations')
def get_stations():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.id, s.name, s.source_type, s.network,
                       ST_AsGeoJSON(s.geometry)::json AS geometry,
                       COALESCE(
                           (SELECT json_agg(l.name ORDER BY l.name)
                            FROM station_line sl
                            JOIN transport_lines l ON l.id = sl.line_id
                            WHERE sl.station_id = s.id
                              AND (l.deleted IS NULL OR l.deleted = false)
                           ),
                           '[]'::json
                       ) AS line_names
                FROM stations s
                WHERE s.source_type = 'railway'
                    AND (s.deleted IS NULL OR s.deleted = false)
            """)
            rows = cur.fetchall()
            features = []
            for row in rows:
                features.append({
                    "type": "Feature",
                    "properties": {
                        "id": row[0],
                        "name": row[1],
                        "source_type": row[2],
                        "network": row[3],
                        "line_names": row[5]
                    },
                    "geometry": row[4]
                })
            return jsonify({"type": "FeatureCollection", "features": features})

@app.route('/api/line_stations')
def line_stations():
    """返回某线路途经的车站列表（按 station_line 的 seq 顺序，未排序的按名称兜底）"""
    line_id = request.args.get('line_id', '').strip()
    if not line_id:
        return jsonify({"success": False, "message": "缺少 line_id 参数"}), 400

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.id, s.name, s.source_type, s.network
                FROM station_line sl
                JOIN stations s ON s.id = sl.station_id
                WHERE sl.line_id = %s
                    AND (s.deleted IS NULL OR s.deleted = false)
                ORDER BY sl.seq ASC NULLS LAST, s.name
            """, (line_id,))
            rows = cur.fetchall()
            stations = [{"id": r[0], "name": r[1], "source_type": r[2], "network": r[3]} for r in rows]
            return jsonify({"success": True, "count": len(stations), "stations": stations})

@app.route('/api/station_belong_and_bureau')
def station_belong_and_bureau():
    # 1. 获取前端传过来的车站名
    station = request.args.get('station', '').strip()
    if not station:
        return jsonify({"success": False, "message": "缺少 station 参数"}), 400

    # 2. 这里需要你已有的转换函数，将中文站名转为电报码
    #    如果还没有，可以先用一个简单的映射或调用其他接口
    #    此处假设你有 get_station_code(station) 函数
    #    如果没有，可以暂时用硬编码测试，但必须实现真实转换
    station_code = get_station_code(station)   # 请自行实现
    if not station_code:
        return jsonify({
            "success": False,
            "message": f"无法识别车站: {station}"
        }), 200

    # 3. 调用第三方 API
    url = f"https://data.railgo.zenglingkun.cn/api/station/query?telecode={station_code}"
    try:
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return jsonify({
            "success": False,
            "message": f"请求第三方服务失败: {str(e)}"
        }), 500

    # 4. 提取目标字段
    station_info = data.get('data', {})
    belong = station_info.get('belong', '')
    bureau = station_info.get('bureau', '')

    # 5. 返回前端期望格式
    return jsonify({
        "success": True,
        "belong": belong,
        "bureau": bureau
    })

@app.route('/api/station_lines')
def station_lines():
    """返回某车站关联的线路列表（按 station_line 关联表）"""
    station_id = request.args.get('station_id', '').strip()
    if not station_id:
        return jsonify({"success": False, "message": "缺少 station_id 参数"}), 400

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT l.id, l.name, l.ref, l.network, l.colour, l.abbreviation
                FROM station_line sl
                JOIN transport_lines l ON l.id = sl.line_id
                WHERE sl.station_id = %s
                    AND (l.deleted IS NULL OR l.deleted = false)
                    AND (l.is_only_freight IS NULL OR l.is_only_freight = false)
                    AND (l.is_abandoned IS NULL OR l.is_abandoned = false)
                    AND l.source_type = 'railway'
                ORDER BY l.name
            """, (station_id,))
            rows = cur.fetchall()
            lines = [{"id": r[0], "name": r[1], "ref": r[2], "network": r[3],
                      "colour": r[4], "abbreviation": r[5]} for r in rows]
            return jsonify({"success": True, "count": len(lines), "lines": lines})

# ========== 线路车站顺序（几何投影排序） ==========

def _reconnect_line_geometry(geometry):
    """把 MultiLineString 的多段按「双向最近端点」贪心重连成一条连续折线。

    OSM 的 route relation 成员分段方向随机、排列乱序，直接展平会错乱。
    这里用双端扩展的贪心重连：链从两端分别找端点最近的未用段接上（自动判定方向）。
    返回按顺序展平的坐标列表 [(lon, lat), ...]；非 MultiLineString 直接展平。
    """
    if not geometry:
        return []
    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if gtype == "LineString":
        return coords
    if gtype != "MultiLineString":
        return []

    segments = [list(seg) for seg in coords if seg]
    if not segments:
        return []
    if len(segments) == 1:
        return segments[0]

    dist = lambda p, q: math.hypot(p[0] - q[0], p[1] - q[1])

    remaining = segments[:]
    chain = list(remaining.pop(0))
    left_end = chain[0]
    right_end = chain[-1]

    while remaining:
        best = None  # (dist, index, reverse, attach_to_left)
        for j, seg in enumerate(remaining):
            s, e = seg[0], seg[-1]
            # 接到左端（链的起点方向）
            d = dist(left_end, e)
            if best is None or d < best[0]:
                best = (d, j, False, True)
            d = dist(left_end, s)
            if d < best[0]:
                best = (d, j, True, True)
            # 接到右端（链的终点方向）
            d = dist(right_end, s)
            if best is None or d < best[0]:
                best = (d, j, False, False)
            d = dist(right_end, e)
            if d < best[0]:
                best = (d, j, True, False)

        d, j, reverse, to_left = best
        seg = remaining[j]
        coords = list(reversed(seg)) if reverse else list(seg)
        if to_left:
            chain = coords + chain
            left_end = coords[0]
        else:
            chain = chain + coords
            right_end = coords[-1]
        remaining.pop(j)

    return chain


def _point_segment_distance(px, py, ax, ay, bx, by):
    """点到线段 ab 的最近距离；返回 (dist, 投影点在段上的比例 t)"""
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay), 0.0
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy), t


def _project_station_along_line(lon, lat, flat_coords):
    """计算 (lon,lat) 在折线上的投影位置，返回沿线累计长度（度，近似）。"""
    if not flat_coords:
        return 0.0
    best_dist = float('inf')
    best_along = 0.0
    cum = 0.0
    for i in range(len(flat_coords) - 1):
        ax, ay = flat_coords[i][0], flat_coords[i][1]
        bx, by = flat_coords[i + 1][0], flat_coords[i + 1][1]
        seg_len = math.hypot(bx - ax, by - ay)
        d, t = _point_segment_distance(lon, lat, ax, ay, bx, by)
        along = cum + t * seg_len
        if d < best_dist:
            best_dist = d
            best_along = along
        cum += seg_len
    return best_along


@app.route('/api/line_station_order')
def line_station_order():
    """返回某线路的车站列表，并附上几何投影预排的顺序（不含 seq，用于拖拽面板初始化）。"""
    line_id = request.args.get('line_id', '').strip()
    if not line_id:
        return jsonify({"success": False, "message": "缺少 line_id 参数"}), 400

    with get_db() as conn:
        with conn.cursor() as cur:
            # 线路几何
            cur.execute("""
                SELECT ST_AsGeoJSON(geometry)::json
                FROM transport_lines WHERE id = %s
            """, (line_id,))
            g = cur.fetchone()
            line_geom = g[0] if g else None

            # 该线路的车站（含坐标、已有 seq）
            cur.execute("""
                SELECT s.id, s.name, sl.seq,
                       ST_X(s.geometry::geometry) AS lon,
                       ST_Y(s.geometry::geometry) AS lat
                FROM station_line sl
                JOIN stations s ON s.id = sl.station_id
                WHERE sl.line_id = %s
                    AND (s.deleted IS NULL OR s.deleted = false)
            """, (line_id,))
            rows = cur.fetchall()

    stations = [{"id": r[0], "name": r[1], "seq": r[2], "lon": r[3], "lat": r[4]} for r in rows]

    # 几何投影预排：重连线路几何，算每个车站的沿线位置
    flat_coords = _reconnect_line_geometry(line_geom)
    has_geometry = bool(flat_coords)
    for st in stations:
        if st["lon"] is not None and st["lat"] is not None and has_geometry:
            st["geo_order"] = _project_station_along_line(st["lon"], st["lat"], flat_coords)
        else:
            st["geo_order"] = None

    # 返回时：若已有 seq，按 seq 排；否则按几何投影排（预排初值）
    def sort_key(st):
        if st["seq"] is not None:
            return (0, st["seq"], '')
        if st["geo_order"] is not None:
            return (1, st["geo_order"], '')
        return (2, 0, st["name"] or '')

    stations.sort(key=sort_key)

    return jsonify({
        "success": True,
        "count": len(stations),
        "has_geometry": has_geometry,
        "stations": [{"id": s["id"], "name": s["name"], "seq": s["seq"]} for s in stations]
    })


@app.route('/api/save_line_station_order', methods=['POST'])
def save_line_station_order():
    """接收 line_id + 有序的 station_ids，批量写入 station_line.seq"""
    data = request.get_json()
    line_id = data.get('line_id')
    station_ids = data.get('station_ids')
    if not line_id or not isinstance(station_ids, list):
        return jsonify({"success": False, "message": "参数错误：需要 line_id 和 station_ids 数组"}), 400

    with get_db() as conn:
        with conn.cursor() as cur:
            # 先清空该线路所有 seq
            cur.execute("UPDATE station_line SET seq = NULL WHERE line_id = %s", (line_id,))
            # 按顺序写入
            for idx, sid in enumerate(station_ids, start=1):
                cur.execute("""
                    UPDATE station_line SET seq = %s
                    WHERE line_id = %s AND station_id = %s
                """, (idx, line_id, sid))
            conn.commit()
    return jsonify({"success": True, "message": "顺序已保存", "count": len(station_ids)})


@app.route('/api/station_board')
def station_board():
    station = request.args.get('station', '').strip()
    station = request.args.get('station', '').strip()
    print(f"[DEBUG] 收到 station 参数: '{station}'")
    print(f"[DEBUG] 站名映射表大小: {len(NAME_TO_CODE)}")
    code = get_station_code(station)
    print(f"[DEBUG] 查询到的三字码: {code}")
    if not code:
        suggestions = search_stations(station, 5)
        print(f"[DEBUG] 建议车站: {suggestions}")
        return jsonify({"success": False, "message": f"无法识别车站: {station}", "suggestions": suggestions})

    date = request.args.get('date', '')
    if not station:
        return jsonify({"success": False, "message": "缺少 station 参数"}), 400
    # 发起 12306 请求前检测客户端是否已断开，断开则不再查询
    if client_disconnected():
        return jsonify({"success": False, "message": "客户端已断开"})
    result = query_station_board(station, date)
    return jsonify(result)

@app.route('/api/search_station')
def search_station():
    keyword = request.args.get('keyword') or request.args.get('station') or ''
    limit = int(request.args.get('limit', 10))
    results = search_stations(keyword, limit)
    return jsonify(results)

@app.route('/api/train_detail')
def train_detail():
    train_code = request.args.get('train_code', '').strip()
    date = request.args.get('date', '')
    if not train_code:
        return jsonify({"success": False, "message": "缺少 train_code 参数"}), 400
    # 发起 12306 请求前检测客户端是否已断开，断开则不再查询
    if client_disconnected():
        return jsonify({"success": False, "message": "客户端已断开"})
    data = query_train_info(train_code, date if date else None)
    if data:
        return jsonify({"success": True, "data": data})
    else:
        return jsonify({"success": False, "message": "查询失败"})

@app.route('/api/train_map_line')
def train_map_line():
    """代理 RailGo 列车运行线路点接口（/api/v2/mapLine），返回该车次行驶路径。

    返回结构与 RailGo 一致：data.stations（车站坐标）+ data.train（分段折线，按 index 排序）。
    原始坐标为 GCJ-02（火星坐标系），此处统一转换为 WGS-84 以对齐地图底图。
    """
    train = request.args.get('train', '').strip()
    if not train:
        return jsonify({"success": False, "message": "缺少 train 参数"}), 400
    if client_disconnected():
        return jsonify({"success": False, "message": "客户端已断开"})
    url = f"https://rg-api.zenglingkun.cn/api/v2/mapLine"
    try:
        resp = requests.get(url, params={"train": train}, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return jsonify({"success": False, "message": f"请求 RailGo mapLine 失败: {str(e)}"}), 502

    # 坐标转换 GCJ-02 → WGS-84
    d = data.get("data")
    if isinstance(d, dict):
        # stations: [{ "站名": [lng, lat] }, ...]
        stations = d.get("stations")
        if isinstance(stations, list):
            for st in stations:
                if isinstance(st, dict):
                    for name, coord in st.items():
                        if isinstance(coord, list) and len(coord) >= 2:
                            try:
                                coord[0], coord[1] = gcj02_to_wgs84(float(coord[0]), float(coord[1]))
                            except (TypeError, ValueError):
                                pass
        # train: { "分段名": { "index": n, "line": [[lng, lat], ...] }, ... }
        train_segs = d.get("train")
        if isinstance(train_segs, dict):
            for seg_name, seg in train_segs.items():
                line = seg.get("line") if isinstance(seg, dict) else None
                if isinstance(line, list):
                    for pt in line:
                        if isinstance(pt, list) and len(pt) >= 2:
                            try:
                                pt[0], pt[1] = gcj02_to_wgs84(float(pt[0]), float(pt[1]))
                            except (TypeError, ValueError):
                                pass
    return jsonify(data)

@app.route('/api/update_line', methods=['POST'])
def update_line():
    data = request.get_json()
    line_id = data.get('id')
    if not line_id:
        return jsonify({"success": False, "message": "缺少 id"}), 400

    # 允许更新的字段（新增 is_high_speed）
    fields = ['name', 'network', 'colour', 'abbreviation', 'ref', 'operator', 'is_only_freight', 'is_high_speed', 'is_abandoned']
    updates = []
    values = []
    for field in fields:
        if field in data:
            updates.append(f"{field} = %s")
            values.append(data[field])
    if not updates:
        return jsonify({"success": False, "message": "没有要更新的字段"}), 400

    values.append(line_id)
    sql = f"UPDATE transport_lines SET {', '.join(updates)} WHERE id = %s"
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, values)
            conn.commit()
            return jsonify({"success": True, "message": "更新成功"})

@app.route('/api/update_station', methods=['POST'])
def update_station():
    data = request.get_json()
    station_id = data.get('id')
    if not station_id:
        return jsonify({"success": False, "message": "缺少 id"}), 400

    fields = ['name', 'network']
    updates = []
    values = []
    for field in fields:
        if field in data:
            updates.append(f"{field} = %s")
            values.append(data[field])
    if not updates:
        return jsonify({"success": False, "message": "没有要更新的字段"}), 400

    values.append(station_id)
    sql = f"UPDATE stations SET {', '.join(updates)} WHERE id = %s"
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, values)
            conn.commit()
            return jsonify({"success": True, "message": "更新成功"})

@app.route('/api/delete_line', methods=['POST'])
def delete_line():
    data = request.get_json()
    line_id = data.get('id')
    if not line_id:
        return jsonify({"success": False, "message": "缺少 id"}), 400

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE transport_lines SET deleted = true WHERE id = %s", (line_id,))
            conn.commit()
            return jsonify({"success": True, "message": "线路已删除"})

@app.route('/api/delete_station', methods=['POST'])
def delete_station():
    data = request.get_json()
    station_id = data.get('id')
    if not station_id:
        return jsonify({"success": False, "message": "缺少 id"}), 400

    # 软删除：标记 deleted = true，保留记录以阻止后续导入重新加入同名车站
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE stations SET deleted = true WHERE id = %s", (station_id,))
            conn.commit()
            return jsonify({"success": True, "message": "车站已删除"})

if __name__ == '__main__':
    init_pool()
    load_station_data()
    app.run(host='0.0.0.0', port=5000, debug=True)
