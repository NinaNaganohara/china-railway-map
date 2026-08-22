# 中国铁路地图 China Railway Map

一个基于 [MapLibre GL JS](https://maplibre.org/) 与 Flask 的中国铁路线路 / 车站交互式地图，支持线路与车站查询展示、12306 实时班次查询以及地图数据的在线编辑。

## 功能特性

- 🗺️ **交互式铁路地图**：展示全国铁路线路（含高铁 / 高速、城际、客专等）及客运车站，按路网（运营局集团）着色。
- 🔍 **线路 / 车站搜索**：支持按中文站名或三字码搜索，点击结果定位到地图。
- 🚉 **实时班次查询**：选中车站后展示当日出发 / 到达班次，并可通过 12306 查询车次详情。
- ✏️ **在线编辑**：编辑线路 / 车站的名称、路网、颜色、编号、运营商、货运 / 高铁 / 废弃标记等属性，支持删除。
- 🏢 **路网标识**：展示各铁路局集团名称与 Logo（中国铁路、上海地铁、珠三角城际等）。

## 技术栈

- **前端**：原生 HTML / CSS / JavaScript + [MapLibre GL JS 4.6](https://maplibre.org/maplibre-gl-js/docs/)
- **后端**：Python 3 + Flask + Flask-CORS
- **数据库**：PostgreSQL + PostGIS
- **数据源**：GeoJSON 线路 / 车站数据、12306 车站码表与实时查询接口

## 项目结构

```
china-railway-map/
├── index.html            # 主页面（地图 + 线路 / 车站 / 车次卡片）
├── map.js                # 前端核心逻辑：加载地图、渲染线路与车站、点击交互
├── style.json            # MapLibre 自定义样式（底图）
├── config.js             # 密钥配置（MapTiler / 天地图）
├── server.py             # Flask 后端：数据库查询、12306 接口代理、编辑 API
├── station_name.js       # 12306 车站名称 / 三字码码表
├── requirements.txt      # Python 依赖
├── .env                  # 数据库连接配置（不入库）
├── edit/                 # 在线编辑模块
│   ├── index.html
│   └── edit.js
└── assets/
    ├── geojson/          # 源数据与导入脚本
    │   ├── china_railway.geojson                     # 铁路线路
    │   ├── china_stations.geojson                    # 全部车站
    │   ├── china_railway_passenger_stations.geojson  # 客运车站
    │   ├── import_data.py                            # 线路导入脚本
    │   ├── import_stations.py                        # 车站导入脚本
    │   ├── extract_station.py                        # 提取客运车站
    │   └── is_freight.py                             # 标记客运线路
    └── icons/            # 路网 / 站点 Logo 图标
```

## 环境要求

- Python 3.8+
- PostgreSQL 12+（需启用 PostGIS 扩展）
- 可访问外网（用于 12306 接口与 MapLibre / 底图 CDN）

## 安装与配置

### 1. 克隆项目并安装依赖

```bash
git clone <仓库地址>
cd china-railway-map
python -m venv venv
# Windows
venv\Scripts\activate
# Linux / macOS
source venv/bin/activate

pip install -r requirements.txt
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`（或直接编辑 `.env`），填写数据库连接信息：

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=你的密码
```

数据库名默认为 `transport`（可在 `server.py` 的 `DB_CONFIG` 中修改）。

### 3. 准备数据库

```sql
CREATE DATABASE transport;
CREATE EXTENSION postgis;
```

创建 `transport_lines` 表（含 `id` 自增主键、`geometry` 几何列以及 `name`、`ref`、`network`、`operator`、`colour`、`abbreviation`、`source_type`、`is_high_speed`、`is_only_freight`、`is_abandoned` 等列），并创建 `stations` 表（`import_stations.py` 会自动建表）。

### 4. 导入数据

线路导入（GeoJSON → PostGIS）：

```bash
cd assets/geojson
python import_data.py china_railway.geojson --source-type railway
```

车站导入（自动建表）：

```bash
python import_stations.py
```

> 导入脚本默认数据库连接参数在脚本顶部，如与 `.env` 不同请先修改。

### 5. 运行服务

```bash
python server.py
```

服务默认运行于 `http://localhost:5000`。

- 主地图页面：`http://localhost:5000/`
- 编辑页面：`http://localhost:5000/edit`

## 使用说明

1. 打开主页面后地图会加载全国铁路线路与车站。
2. 顶部搜索框输入线路名 / 车站名 / 三字码，选择结果定位。
3. 点击车站卡片可查看当日班次，点击车次可查看车次详情。
4. 点击右上角「✏️ 编辑模式」进入编辑，点击线路 / 车站可修改属性或删除。

## 后端 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/lines` | 获取线路（GeoJSON），参数 `source_type`（默认 `railway`） |
| GET | `/api/stations` | 获取车站（GeoJSON） |
| GET | `/api/station_board` | 查询车站当日班次，参数 `station`、`date` |
| GET | `/api/search_station` | 车站搜索，参数 `keyword`、`limit` |
| GET | `/api/train_detail` | 车次详情，参数 `train_code`、`date` |
| POST | `/api/update_line` | 更新线路，JSON 含 `id` 及需更新字段 |
| POST | `/api/update_station` | 更新车站，JSON 含 `id` 及需更新字段 |
| POST | `/api/delete_line` | 删除线路，JSON 含 `id` |
| POST | `/api/delete_station` | 删除车站，JSON 含 `id` |

## 数据说明

- 线路 / 车站基础数据来源于 `assets/geojson/` 下的 GeoJSON 文件，导入到 PostgreSQL / PostGIS 供前端查询。
- 车站三字码与实时班次数据来自 12306 官方接口（`mobile.12306.cn`），本站不保证其可用性与实时性。
- 12306 车站码表优先读取本地 `station_name.js`，缺失时自动从 12306 下载。

## 许可证

本项目仅供学习交流使用，数据版权归原始权利人所有。
