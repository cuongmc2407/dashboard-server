# Dashboard Server

Trang web theo dõi CPU, RAM, nhiệt độ, ổ đĩa, mạng và tiến trình cho máy Linux, chạy bằng Node.js trên cổng **3334**, expose ra internet qua **Cloudflare Tunnel**.

## 1. Cài đặt trên máy Linux

Copy toàn bộ thư mục này lên server (scp / git / rsync), sau đó:

```bash
cd dashboard_server
npm install
cp .env.example .env
nano .env   # dat DASHBOARD_USER / DASHBOARD_PASS de bao ve dashboard
node server.js
```

Mở `http://<ip-server>:3334` để kiểm tra (nếu firewall cho phép cổng này).

Nếu muốn đọc được nhiệt độ CPU trên Linux, cài thêm `lm-sensors`:

```bash
sudo apt install lm-sensors
sudo sensors-detect --auto
```

## 2. Chạy nền bằng systemd (khuyên dùng)

Tạo file `/etc/systemd/system/dashboard.service`:

```ini
[Unit]
Description=System Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/duong/dan/toi/dashboard_server
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=youruser

[Install]
WantedBy=multi-user.target
```

Kích hoạt:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dashboard
sudo systemctl status dashboard
```

## 3. Expose qua Cloudflare Tunnel (cổng 3334)

### Cách nhanh (quick tunnel, không cần domain, có URL tạm thời)

```bash
# cai cloudflared neu chua co
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

cloudflared tunnel --url http://localhost:3334
```

Cloudflared sẽ in ra một URL dạng `https://xxxx.trycloudflare.com` — dùng ngay để truy cập dashboard. URL này đổi mỗi lần chạy lại nên chỉ phù hợp để test nhanh.

### Cách ổn định (named tunnel gắn với domain riêng của bạn)

```bash
cloudflared tunnel login
cloudflared tunnel create dashboard
```

Tạo file `~/.cloudflared/config.yml`:

```yaml
tunnel: dashboard
credentials-file: /home/youruser/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: dashboard.tenmiencuaban.com
    service: http://localhost:3334
  - service: http_status:404
```

Trỏ DNS về tunnel rồi chạy:

```bash
cloudflared tunnel route dns dashboard dashboard.tenmiencuaban.com
cloudflared tunnel run dashboard
```

Chạy nền bằng systemd luôn cho cloudflared:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

**Lưu ý bảo mật:** vì dashboard sẽ có thể truy cập công khai qua internet, hãy chắc chắn đã đặt `DASHBOARD_USER`/`DASHBOARD_PASS` trong `.env` (Basic Auth), hoặc bật thêm Cloudflare Access trước tunnel để giới hạn theo email/SSO.

## 3b. Cách của bạn: mở thẳng cổng 3334 (không dùng cloudflared)

Nếu bạn không muốn cài `cloudflared` mà chỉ muốn expose cổng 3334 trực tiếp: mở cổng 3334 trên firewall/router rồi truy cập `http://<ip-hoac-domain>:3334`. Cách này đơn giản hơn nhưng kém an toàn hơn Cloudflare Tunnel (không có TLS/DDoS protection của Cloudflare) — nếu dùng cách này, bắt buộc phải đặt `DASHBOARD_USER`/`DASHBOARD_PASS`.

## Cấu trúc dự án

```
server.js          # Express + WebSocket, thu thap so lieu bang systeminformation
public/index.html  # Giao dien dashboard
public/app.js       # Ket noi WebSocket, ve bieu do
public/style.css    # Giao dien toi (dark theme)
.env.example        # Mau file cau hinh
```
