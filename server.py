#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re
import json
import requests
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from contextlib import contextmanager
import psycopg2
from psycopg2 import pool
from dotenv import load_dotenv
import os
from flask import send_from_directory

load_dotenv()

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
    加载车站数据。优先从本地文件读取，若不存在则从 12306 获取。
    返回 (name_to_code, code_to_name, code_set)
    """
    local_file = "station_name.js"  # 本地文件路径（与 server.py 同目录）
    if os.path.exists(local_file):
        print("从本地文件加载车站数据...")
        content = open(local_file, encoding='utf-8').read()
        match = re.search(r"'([^']*)'", content)
        if not match:
            raise ValueError("本地 station_name.js 格式错误")
        data_str = match.group(1)
    else:
        print("尝试从 12306 获取车站数据...")
        url = "https://kyfw.12306.cn/otn/resources/js/framework/station_name.js"
        try:
            resp = requests.get(url, timeout=10)
            resp.encoding = "utf-8"
            match = re.search(r"'([^']*)'", resp.text)
            if not match:
                raise ValueError("12306 返回数据格式错误")
            data_str = match.group(1)
        except Exception as e:
            print(f"从 12306 获取失败: {e}")
            return {}, {}, set()  # 返回空，避免崩溃

    records = data_str.split("@")[1:]
    name_to_code = {}
    code_to_name = {}
    code_set = set()
    for record in records:
        fields = record.split("|")
        if len(fields) >= 7:
            name = fields[1]
            code = fields[2]
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
        resp = requests.post(url, data=params, headers=headers, timeout=10)
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
        response = requests.post(url, data=data, headers=headers, timeout=10)
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
app = Flask(__name__)
init_pool()
CORS(app)

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
                SELECT id, name, source_type, network,
                       ST_AsGeoJSON(geometry)::json AS geometry
                FROM stations
                WHERE source_type = 'railway'
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
                        "network": row[3]
                    },
                    "geometry": row[4]
                })
            return jsonify({"type": "FeatureCollection", "features": features})

@app.route('/api/station_board')
def station_board():
    station = request.args.get('station', '').strip()
    date = request.args.get('date', '')
    if not station:
        return jsonify({"success": False, "message": "缺少 station 参数"}), 400
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
    data = query_train_info(train_code, date if date else None)
    if data:
        return jsonify({"success": True, "data": data})
    else:
        return jsonify({"success": False, "message": "查询失败"})

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
            cur.execute("DELETE FROM transport_lines WHERE id = %s", (line_id,))
            conn.commit()
            return jsonify({"success": True, "message": "线路已删除"})

@app.route('/api/delete_station', methods=['POST'])
def delete_station():
    data = request.get_json()
    station_id = data.get('id')
    if not station_id:
        return jsonify({"success": False, "message": "缺少 id"}), 400

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM stations WHERE id = %s", (station_id,))
            conn.commit()
            return jsonify({"success": True, "message": "车站已删除"})

if __name__ == '__main__':
    init_pool()
    load_station_data()
    app.run(host='0.0.0.0', port=5000, debug=True)