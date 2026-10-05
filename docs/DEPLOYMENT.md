# SatQuery AI — Deployment Guide

This guide covers production deployment of SatQuery AI across **Vercel** (Frontend) and **Render** (Backend).

---

## 1. Frontend Deployment (Vercel)

1. Root Directory: `frontend`
2. Framework Preset: **Vite**
3. Build Command: `npm run build`
4. Output Directory: `dist`
5. Environment Variables:
   - `VITE_API_BASE_URL`: `https://satquery-backend.onrender.com/api/v1`

---

## 2. Backend Deployment (Render)

1. Root Directory: `backend`
2. Environment: **Python 3.11** or **Docker**
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Environment Variables:
   - `CORS_ORIGINS`: `https://satquery-ai.vercel.app,http://localhost:3000`
   - `GEMINI_API_KEY`: *(Optional API Key for VQA synthesis)*
   - `DEVICE`: `auto`
