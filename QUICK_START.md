# WhatsApp API Gateway - Phase 1 Quick Start

## ✅ Setup Complete!

All files have been created and dependencies installed in:
```
~/Whatsapp API
```

### Project Structure
```
Whatsapp API/
├── src/
│   ├── config/config.ts           ← Configuration
│   ├── whatsapp/WhatsAppManager.ts ← Baileys integration
│   ├── utils/logger.ts            ← Logging
│   └── server.ts                  ← Express app
├── dist/                          ← Compiled JavaScript
├── data/sessions/                 ← WhatsApp auth data
├── package.json
├── tsconfig.json
├── .env                           ← Environment config
├── .gitignore
└── README.md
```

---

## 🚀 How to Run

### Option 1: Development Mode (Recommended - with auto-reload)

```bash
cd ~/Whatsapp API
npm run dev
```

**Expected Output:**
```
Server running on http://localhost:3000
Health check: http://localhost:3000/api/v1/health
Status: http://localhost:3000/api/v1/status
QR Code: http://localhost:3000/api/v1/qr
Connecting to WhatsApp...
```

### Option 2: Production Mode

```bash
cd ~/Whatsapp API
npm run build     # Compile TypeScript
npm start         # Run compiled JavaScript
```

---

## ✅ Verification - 7 Tests (Do These in Order!)

### Test 1: Health Check (Express is working)
```bash
curl http://localhost:3000/api/v1/health
```
**Expected:** `{"success":true,"service":"whatsapp-api","status":"running"}`

### Test 2: Status Check (WhatsApp state)
```bash
curl http://localhost:3000/api/v1/status
```
**Expected (first run):** `{"success":true,"whatsapp":{"status":"connecting","phone":null}}`

### Test 3: QR Code Generation (Wait ~10 seconds after starting)
```bash
curl http://localhost:3000/api/v1/qr
```
**Expected:** JSON with `"qr":"data:image/png;base64,..."` (base64 PNG image)

### Test 4: View QR in Browser
Open: `http://localhost:3000/api/v1/qr`

Or create `qr.html`:
```html
<!DOCTYPE html>
<html>
<head><title>WhatsApp QR</title></head>
<body style="text-align:center; padding:20px;">
  <h1>WhatsApp QR Code</h1>
  <img id="qr" style="width:300px;" />
  <script>
    fetch('http://localhost:3000/api/v1/qr')
      .then(r => r.json())
      .then(d => d.qr && (document.getElementById('qr').src = d.qr));
  </script>
</body>
</html>
```

### Test 5: Scan QR with Your Phone
1. Open WhatsApp on your phone
2. **Settings → Linked Devices → Link a Device**
3. **Scan the QR code** from your browser
4. **Wait for connection confirmation**

Server log should show:
```
WhatsApp connected! Phone: 254712345678
```

### Test 6: Check Connected Status
```bash
curl http://localhost:3000/api/v1/status
```
**Expected (after scan):** `{"success":true,"whatsapp":{"status":"connected","phone":"254712345678"}}`

### Test 7: Restart and Verify Persistence
1. Stop server: `Ctrl+C`
2. Restart: `npm run dev`
3. Run: `curl http://localhost:3000/api/v1/status`
4. **Expected:** Reconnects without QR re-scan ✅

---

## 📝 Important Files

| File | Purpose |
|------|---------|
| `.env` | Configuration (PORT, LOG_LEVEL, etc) |
| `src/server.ts` | Express app with 4 API routes |
| `src/whatsapp/WhatsAppManager.ts` | Baileys WhatsApp client |
| `data/sessions/` | Persistent auth data (git-ignored) |
| `dist/` | Compiled JavaScript (git-ignored) |

---

## ⚙️ Configuration (.env)

```env
NODE_ENV=development    # development or production
PORT=3000              # Server port
LOG_LEVEL=info         # Log level: debug, info, warn, error
WHATSAPP_DATA_PATH=./data/sessions  # Where to store WhatsApp auth
```

To change port:
```env
PORT=3001
```

Then start: `npm run dev`

---

## 🔍 Troubleshooting

### "Port 3000 already in use"
```bash
# Option 1: Change port in .env to 3001
PORT=3001

# Option 2: Kill existing process
lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9
```

### "QR Code not appearing"
- Wait 10 seconds and try again
- The QR code takes a moment to generate after startup
```bash
sleep 10 && curl http://localhost:3000/api/v1/qr
```

### "Session not persisting"
Check that auth files were created:
```bash
ls -la data/sessions/auth_info/
```

You should see: `creds.json`, `keys/` directory

### "WhatsApp keeps disconnecting"
- Ensure internet connection is stable
- Check your WhatsApp account is active on your phone
- Restart the server and re-scan the QR code

### "TypeScript errors when running"
```bash
# Rebuild TypeScript
npm run build

# Then run
npm start
```

---

## 📱 API Endpoints (Phase 1)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | API info |
| `/api/v1/health` | GET | Health check |
| `/api/v1/status` | GET | WhatsApp connection status |
| `/api/v1/qr` | GET | Current QR code as data URL |

---

## 🔐 Security Notes

✅ **Implemented:**
- Environment variables for secrets
- `.env` excluded from Git
- No hardcoded credentials
- Pino logging (never logs passwords)
- Graceful error handling

⚠️ **Coming in Phase 2:**
- API key authentication
- Rate limiting
- HTTPS/TLS
- CORS configuration

---

## 📊 Logs

### Development (Pretty-printed)
```bash
npm run dev
```

Logs are colorized and readable:
```
INFO WhatsApp connected! Phone: 254712345678
WARN WhatsApp disconnected. Attempting to reconnect...
```

### Production (JSON)
Set in `.env`:
```env
NODE_ENV=production
```

Logs output as JSON (suitable for log aggregation):
```json
{"level":30,"service":"whatsapp-api","msg":"WhatsApp connected!"}
```

### Debug Logs
```bash
LOG_LEVEL=debug npm run dev
```

---

## 🚨 Stop the Server

Press: **`Ctrl+C`**

The server will gracefully shutdown:
```
Received SIGINT, shutting down gracefully...
WhatsApp connection closed
```

---

## 📚 Next: Phase 2

Once all 7 tests pass ✅, you're ready for **Phase 2** which adds:

- 🔐 API key authentication
- 📱 Application registration
- 💾 PostgreSQL database
- 📝 Message logging
- 🚦 Rate limiting
- 📊 Swagger documentation

---

## ✨ What You Have

✅ Working WhatsApp connection via Baileys  
✅ REST API with 4 endpoints  
✅ QR code authentication  
✅ Persistent sessions (survives restart)  
✅ Structured logging with Pino  
✅ TypeScript with strict mode  
✅ Environment configuration  
✅ Graceful shutdown  

All ready to extend! 🚀
