"""
Root-level entrypoint for SatQuery AI FastAPI backend.
Enables running either `uvicorn main:app` or `uvicorn app.main:app` seamlessly on Render and local environments.
"""

import os
from app.main import app

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=False)
