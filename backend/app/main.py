from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Project Management MVP API")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@app.get("/api/health")
def read_health() -> dict[str, str]:
    return {"status": "ok"}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
