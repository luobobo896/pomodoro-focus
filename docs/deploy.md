# 番茄时钟 · 部署前置核查与发布方案（Ops）

- 目标 URL：`https://hk.hsddns.com/pomodoro-focus`
- 服务器：`hk`（Debian 13，nginx 1.26.3，master PID 1648，自 7 月 27 日运行至今未 reload）
- 核查时间：2026-10-22 15:56
- 结论：**Arch 方案 A 的前提不成立，改走方案 B（显式 location，root 不 alias，不用 try_files）**
- 状态：**只读核查 + 备份已完成，未改任何配置、未 reload。等 leader/用户放行后执行**

---

## 1. 事实核查（都有命令输出为证）

| 项 | 结论 | 证据 |
|---|---|---|
| 站点配置文件 | `/etc/nginx/sites-enabled/whatsapp-ai-hk`（443 + 80 两个 server 块） | `ls -la /etc/nginx/sites-enabled/` |
| `location /` 是不是静态 root | **不是**。443 块里只有 `location = / { return 301 /whtasapp/; }`，**没有前缀 `location /`，也没有 server 级 `root`** | `cat -n` 全文；`nginx -T` 逐行确认 |
| 未匹配路径落到哪 | nginx 编译默认 root `/usr/share/nginx/html` | error.log 原文：`open() "/usr/share/nginx/html/pomodoro-focus" failed`；`GET /index.html` 返回 nginx 欢迎页 |
| `/pomodoro-focus` 是否被占用 | 未占用（路径空闲，404） | `/var/www`、`/opt`、`/usr/share/nginx/html` 三处均无该目录；`grep -rn pomodoro /etc/nginx/` 无结果 |
| 有无正则 location 拦 .css/.js | 无。所有 include（xui/sub/subs/clash）都是各自前缀的 `= ` / `^~`，不覆盖本站路径 | 逐个 grep snippets |
| 目录写权限 | `/var/www` 可写；`/usr/share/nginx/html` 可写（实测 touch 后即删） | `WRITABLE` 输出 |
| 根路径现状 | `GET /` → **301** `https://hk.hsddns.com/whtasapp/` | 上线前后必须一致 |
| 磁盘 | `/` 已用 **97%（可用 1.7G）** | 本静态站 ≤ 1MB，不阻塞，但需知悉 |
| 既有异常（非本项目） | `/clash/` 现在就是 **404** | 上线前后对比请忽略，属既有状态 |

**基线存档**（回滚和验收的对照标准）：
`/etc/nginx/backups/pre-pomodoro-20261022-155651/baseline-curl-20261022-155655.txt`

---

## 2. 为什么方案 A 不能直接用

Arch 方案 A 假设"现有 `location /` 是静态 root，把文件放进 root 子目录即可零改动"。实际这个站点**根路径是 301 跳转到 `/whtasapp/`（反代 127.0.0.1:8790）**，没有任何静态 document root。

- **A′（利用默认 root `/usr/share/nginx/html`）技术上可行**：把文件放进去，无需改 nginx。但**不推荐**——那是 Debian nginx 包管理目录（现放欢迎页），依赖"没人显式设 root"这一隐式行为，且全站所有未匹配路径都会落到这个目录，属于把风险留给以后。
- **B（显式 location）推荐**：与本文件中 `/json`、`/asset` 的既有写法同类，语义明确，回滚干净。

## 3. 方案 B 的变更面：1 行 include + 1 个新文件

**仓库内制品（已备好，未装到服务器）**
- 片段：[ops/nginx/pomodoro-focus.conf](/Users/hanson/work/个人文档/pomodoro-focus/ops/nginx/pomodoro-focus.conf)
- 发布脚本：[ops/release.sh](/Users/hanson/work/个人文档/pomodoro-focus/ops/release.sh)（默认 `--dry-run`，`--yes` 才真正执行，失败自动回滚）

**片段内容（按 leader 执行条件收敛为两条 location）**

```nginx
# ① 无尾斜杠 → 301 补斜杠，保证 ./assets/... 相对路径解析正确
location = /pomodoro-focus {
    return 301 /pomodoro-focus/;
}

# ② 前缀匹配；^~ 优先于正则 location
location ^~ /pomodoro-focus/ {
    root /var/www;          # 显式指定，不依赖继承
    index index.html;
    add_header Cache-Control "no-cache";
    add_header X-Content-Type-Options nosniff;

    # ③ assets 分缓存：内嵌规则，只作用于 /pomodoro-focus/assets/，不新增对外路径
    location ^~ /pomodoro-focus/assets/ {
        root /var/www;
        add_header Cache-Control "public, max-age=300";
        add_header X-Content-Type-Options nosniff;
    }
}
```

**改动** `sites-enabled/whatsapp-ai-hk`：只在 443 块 `listen 443 ssl;` 之前插入一行
`include /etc/nginx/snippets/pomodoro-focus.conf; # pomodoro-focus`。
**不改动**任何已有 location、不改 301、不碰证书、不改 80 块。

文件落地位置：`/var/www/pomodoro-focus/{index.html, assets/...}`

### 权限要求（16:29 首次上线 403 的根因，必须遵守）

nginx 以 `user www-data;` 运行，而 `mktemp -d` 建的暂存目录是 **`0700`**，`rsync -a` 会原样带到服务器。结果：

```
drwx------ root root /var/www/pomodoro-focus        ← www-data 无法穿越
-rw-r--r-- root root .../index.html                ← 文件本身没问题
error.log: ".../index.html" is forbidden (13: Permission denied)
```

要求：**目录 `755`、文件 `644`、属主 `root:root`**，与服务器上可正常访问的 `/var/www/json-tool` 保持一致。脚本已做三层保护：

1. 打包阶段把暂存目录统一成 `755`/`644`（`chmod 755` + `find -type d -exec chmod 755`）；
2. 落地后 `chmod -R a+rX` 兜底；
3. reload **之前**两道门禁：目录权限必须是 `755` 且 `www-data` 可 `test -x`；然后 `runuser -u www-data -- test -r` **逐个文件**实测可读，任一不可读即整体回滚、**不 reload**。

诊断命令（出问题先跑这四条的只读版）：

```bash
namei -l /var/www/pomodoro-focus/index.html        # 哪一级缺 x
stat -c '%a %U:%G  %n' /var/www /var/www/pomodoro-focus
runuser -u www-data -- test -r /var/www/pomodoro-focus/index.html && echo 可读 || echo 不可读
# 对照能正常访问的目录
namei -l /var/www/json-tool/index.html; stat -c '%a %U:%G' /var/www/json-tool
```

### 三处刻意的写法
1. **`root` 不用 `alias`**：`/pomodoro-focus/x` → `/var/www/pomodoro-focus/x` 是路径同构拼接，不会出现 alias 拼接陷阱。
2. **不用 `try_files`、不开 `autoindex`**：本站无 SPA 路由，不需要回退，404 就该是 404；目录列表不暴露。
3. **assets 规则内嵌而非平铺**：`add_header` 在子块声明后会**取代**父块的设置（不是叠加），所以子块必须重新声明 `nosniff`，否则 assets 会掉这个头；实测确认没有出现两个 `Cache-Control`（用 `expires` + `add_header` 会产生重复头，已避开）。

### 已做隔离实测（不是推断）
用绑定 `127.0.0.1:18443` 的临时 nginx 实例跑**仓库里这份最终片段**，实测结果：

| 请求 | 结果 |
|---|---|
| `/pomodoro-focus` | **301** → `/pomodoro-focus/` |
| `/pomodoro-focus/` | **200** |
| `/pomodoro-focus/assets/styles.css` | **200** |
| `/pomodoro-focus/assets/js/app.js` | **200**，`Cache-Control: public, max-age=300` |
| `/pomodoro-focus/missing-page` | **404**（无 SPA 回退，符合预期） |
| `/` | **301** → `/whtasapp/`（未受影响） |
| index 响应头 | 只一个 `Cache-Control: no-cache`，带 `X-Content-Type-Options: nosniff` |
| assets 响应头 | 只一个 `Cache-Control: public, max-age=300`（无重复头） |

临时实例已关闭；生产 master PID 与配置文件 mtime 全程未变。

---

## 4. 放行后的执行步骤（每一步都有校验）

**推荐：一条命令（脚本默认 dry-run，`--yes` 才执行）**

```bash
cd /Users/hanson/work/个人文档/pomodoro-focus
./ops/release.sh --dry-run   # 只体检、打印计划
./ops/release.sh --yes       # 用户确认后执行；失败自动回滚
```

脚本按顺序做：备份 → 装片段 → 幂等注入 include → `nginx -t`（失败还原）→ **白名单打包**（只发 `index.html` + `assets/`）→ 原子切换目录（旧目录留 `.bak-<ts>`）→ reload → 9 条 curl 断言 → 任一不符自动整体回滚。

> **为什么必须白名单**：仓库里有 `qa/`（21 个 spec、截图、日志）、`docs/`、`ops/`。若用 `rsync --delete` 整目录同步，这些会一起发到 `/var/www/pomodoro-focus/` 下被公网访问。脚本改为**只复制 `index.html` + `assets/` 到本地暂存目录**，并对打包内容做硬校验（出现非预期条目即中止）。
>
> **7b 步会在服务器上再核一次**：切目录后 `find` 实际落盘清单并打印，凡不属于 `index.html` 或 `assets/**` 的一律拦截（`README.md`、`qa/`、`docs/` 都在拦截范围内），命中即整体回滚。清单随发布日志一起输出，可直接贴给 leader 核对。

**发布内容（6 个文件，实测 `rsync --dry-run` 清单）**

```
index.html
assets/styles.css
assets/js/app.js
assets/js/storage.js
assets/js/timer.js
assets/js/ui.js
```

**目录形状说明**：实际布局是扁平 `assets/styles.css` + `assets/js/*.js`，**没有 `assets/css/` 子目录**。所以前置检查按「`assets/` 下至少一个 `.css`、`assets/js/` 下至少一个 `.js`、`index.html` 的引用全部可解析」判定，而不是写死 `assets/css/*.css`；将来样式真挪进 `assets/css/`，检查照样通过。

**前置检查项（脚本第 1 步，任一不满足即中止）**
- `index.html` / `assets/` 存在
- `nginx` 片段存在
- **逐个确认发布文件存在**：`index.html`、`assets/` 下至少一个 `.css`、`assets/js/` 下至少一个 `.js`
- **引用完整性**：`index.html` 里写到的每个 `./assets/...` 必须真实存在，断链当场中止（不是只查 `index.html` 在不在）
- **`index.html` + `assets/` 全部文件无绝对路径引用**（`src=""`、`href=""`、`from ''`、`import('')`、`url()` 五种写法，含不加引号的 `src=/x`；已用 4 种正例 + 2 种反例自测）
- 发布清单逐条打印，不只报个数

**手工等价步骤（脚本不可用时）**

```bash
# 0) 备份
TS=$(date +%Y%m%d-%H%M%S); BK=/etc/nginx/backups/pre-pomodoro-$TS; mkdir -p "$BK"
cp -a /etc/nginx/nginx.conf /etc/nginx/sites-enabled /etc/nginx/sites-available /etc/nginx/snippets /etc/nginx/conf.d "$BK"/
nginx -T > "$BK/nginx-T-$TS.conf" 2>/dev/null

# 1) 白名单打包后上传（先落暂存目录，避免半截文件被访问）
STAGE=$(mktemp -d); cp -a index.html assets "$STAGE/"
(cd "$STAGE" && find . -mindepth 1 -maxdepth 1 ! -name index.html ! -name assets)   # 必须无输出
rsync -a --delete "$STAGE/" hk:/tmp/pomodoro-focus-staging/
ls -R /tmp/pomodoro-focus-staging   # 只应看到 index.html 与 assets/

# 2) 上片段 + 插入 include
scp ops/nginx/pomodoro-focus.conf hk:/etc/nginx/snippets/pomodoro-focus.conf
python3 - <<'PY'
p='/etc/nginx/sites-enabled/whatsapp-ai-hk'; s=open(p).read()
a='    listen 443 ssl; # managed by Certbot'
assert s.count(a)==1 and 'pomodoro-focus.conf' not in s
open(p,'w').write(s.replace(a,'    include /etc/nginx/snippets/pomodoro-focus.conf; # pomodoro-focus\n\n'+a))
PY

# 3) 必须校验通过才 reload
nginx -t

# 4) 原子切换目录（已存在旧版则先挪走）
[ -e /var/www/pomodoro-focus ] && mv /var/www/pomodoro-focus /var/www/pomodoro-focus.bak-$TS
mv /tmp/pomodoro-focus-staging /var/www/pomodoro-focus

# 5) reload 并复验
nginx -s reload
```

**复验清单（curl 证据，逐条对基线）**

```bash
C='curl -s -o /dev/null -w %{http_code}\n -k --resolve hk.hsddns.com:443:127.0.0.1'
$C https://hk.hsddns.com/                     # 必须 301 → /whtasapp/
$C https://hk.hsddns.com/whtasapp/            # 必须 200
$C https://hk.hsddns.com/json/                # 必须 200
$C https://hk.hsddns.com/asset/               # 必须 200
$C https://hk.hsddns.com/frostfall/           # 必须 200
$C https://hk.hsddns.com/pomodoro-focus       # 必须 301
$C https://hk.hsddns.com/pomodoro-focus/      # 必须 200
$C https://hk.hsddns.com/pomodoro-focus/assets/js/app.js  # 必须 200
```
另外用**外网**（不经 --resolve）访问一次 `https://hk.hsddns.com/pomodoro-focus/`，确认证书与真实链路正常。

---

## 5. 回滚（两级，都是一条命令）

**5.1 只回滚本站（推荐，最快）**
```bash
mv /var/www/pomodoro-focus /var/www/pomodoro-focus.rollback-$(date +%Y%m%d-%H%M%S)   # 或直接 rm -rf
sed -i '/include \/etc\/nginx\/snippets\/pomodoro-focus.conf;/d' /etc/nginx/sites-enabled/whatsapp-ai-hk
rm -f /etc/nginx/snippets/pomodoro-focus.conf
nginx -t && nginx -s reload
```

**5.2 整体回滚到 2026-10-22 15:56 的配置**
```bash
BK=/etc/nginx/backups/pre-pomodoro-20261022-155651
cp -a "$BK/nginx.conf" /etc/nginx/nginx.conf
cp -a "$BK/sites-enabled/." /etc/nginx/sites-enabled/
cp -a "$BK/snippets/." /etc/nginx/snippets/
cp -a "$BK/conf.d/." /etc/nginx/conf.d/
rm -f /etc/nginx/snippets/pomodoro-focus.conf
nginx -t && nginx -s reload
```

回滚后同样跑一遍 §4 复验清单。

---

## 6. 门禁与待确认

- [x] 只读核查（root 形态 / 路径占用 / 正则拦截 / 写权限 / 基线）
- [x] 配置备份 + md5 一致性校验 + `nginx -T` 全量快照（623 行）
- [x] 隔离实例实测路由与缓存头
- [x] 线上配置零漂移（`diff -r` 四项全部一致，mtime 未变）
- [ ] **用户确认后**才动生产配置（改 nginx = 生产变更，红线）
- [ ] Dev 交付代码后先过 QA，再按 §4 发布

**需 leader 拍板**：确认走方案 B（`root /var/www` + include 单行改动）。若坚持"零 nginx 改动"，唯一路径是 A′（文件放 `/usr/share/nginx/html`），我给出但不推荐。
