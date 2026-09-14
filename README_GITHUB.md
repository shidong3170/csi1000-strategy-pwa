# 中证1000策略助手 V1.0.7｜GitHub Pages + GitHub Actions 版

## 架构

```text
GitHub Repository
├─ PWA 静态程序
├─ A股年度交易日历
├─ data/csi1000-history.json
└─ GitHub Actions
   ├─ 每个工作日 18:30（北京时间附近）更新公开行情
   └─ 自动部署 GitHub Pages

手机 PWA
├─ 手动直连东方财富公开行情
└─ IndexedDB：保存你的私人数据和公开行情缓存
```

GitHub仓库不需要保存任何个人投资数据。

## 手机手动更新行情

在“分析”页点击“更新行情”后，程序分别更新两套互不混用的数据：

1. 实时观察数据：直连东方财富中证1000（000852）实时/准实时接口，仅显示点位、涨跌和时间；
2. 策略计算数据：直连东方财富日K，失败时读取 GitHub Pages 同源静态行情，再失败时读取设备缓存。

实时指数绝不写入日K、MA200或三因素。界面分别显示实时行情和正式收盘基准。开盘前及盘中用上一完整交易日收盘维持建议；15:00至18:30等待今日完整收盘但不清空建议；18:30后仍缺少当日收盘时标记延迟，只暂缓新的市场因素加码。全部时点按 Asia/Shanghai 判断。

## 首次部署步骤

1. 在 GitHub 新建一个仓库，例如 `csi1000-strategy-pwa`。
2. 把本目录全部文件上传到仓库 `main` 分支。
3. 打开仓库 `Settings → Pages`。
4. 在 `Build and deployment` 中选择 **GitHub Actions**。
5. 进入 `Actions` 页面，手动运行一次：
   - `Update CSI 1000 market data`
   - `Deploy GitHub Pages`
6. 部署成功后，GitHub Pages 会提供 HTTPS 地址，例如：
   `https://<username>.github.io/csi1000-strategy-pwa/`
7. 手机打开该地址并“添加到主屏幕”。

## 自动行情

`.github/workflows/update-market-data.yml`

默认周一至周五 UTC 10:30 运行（约北京时间18:30）。

它会：

1. 抓取中证1000 `000852` 日K；
2. 验证至少200条历史数据；
3. 写入 `data/csi1000-history.json`；
4. 只有数据变化时才自动提交；
5. 提交后触发 Pages 重新部署。

> GitHub Actions 的 schedule 不是严格实时任务，可能存在一定排队延迟。对本项目的日频策略不构成实质影响。

## 本地回归检查

在项目目录执行：

```bash
node tests/strategy-core.test.js
node tests/market-data-core.test.js
node tests/calibration-core.test.js
node tests/check-project.js
python -m py_compile scripts/update_market_data.py
python scripts/update_market_data.py
```

前四项验证 Frozen 关键边界、校准快照一致性、本金变化记录、三级行情通道、新鲜度、PWA 静态资源、交易日历与行情文件结构；最后一项需要联网并只更新公开指数行情。

## 本地隐私

以下内容仅存在手机 IndexedDB：

- 初始化本金；
- 定投记录；
- 手动追加；
- 未执行记录；
- 人工校准；
- 现金池；
- 策略XIRR；
- 策略版本和建议历史。
- 初始化基线修订、投入事实修订和修改原因。

GitHub Pages 只提供程序和公开市场数据。

## PWA 更新

程序文件通过 GitHub Pages 发布；Service Worker负责离线缓存。
数据升级不得清除 IndexedDB。

V1.0.7 将本地数据库升级为 V3，只为旧投入记录补充执行状态、修订状态和计划日期字段；不会删除私人数据。事实修正会保留原值和逐字段修订日志，策略规则版本仍坚持“改未来、不改历史”。

## 注意

- 2026年度交易日历已内置。
- 未来年度必须新增对应 `trading-calendar-YYYY.json` 后，程序才会自动判断该年度交易日。
- 无可靠交易日历时，程序按Frozen规则“不猜交易日、不自动补录”。
